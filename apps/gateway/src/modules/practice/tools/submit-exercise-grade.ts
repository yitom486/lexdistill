import { SubmitExerciseGradeSchema, type ExerciseGrade, type TextbookExerciseAttempt } from '@study-studio/protocol';
import { ToolLocations, ToolPermissions, type ToolDefinition, type ToolExecutionContext } from '@study-studio/tool-core';
import { BusinessError, err, type Result } from '@study-studio/shared';

export interface GradeBinding {
  userId: string; turnId?: string; active: boolean; repairs: number; repairLimit: number;
  result?: TextbookExerciseAttempt;
  save: (grade: ExerciseGrade) => Promise<Result<TextbookExerciseAttempt, BusinessError>>;
}

/**
 * 批改提交核心（校验＋保存＋修正计数），与调用通道无关：
 * - 直调分支经 execute()（先过轮次归属校验，单测 mock 适配器用）；
 * - ACP 分支经按次工具门面直接调用（实例按轮次独占，归属由实例隔离保证，无需复查）。
 */
export async function submitGradeAttempt(
  tool: Pick<SubmitExerciseGradeTool, 'schema'>,
  binding: GradeBinding,
  raw: unknown,
): Promise<Result<TextbookExerciseAttempt, BusinessError>> {
  if (binding.result) return { ok: true, value: binding.result };
  if (binding.repairs > binding.repairLimit) return err(new BusinessError('E_GRADING_REPAIR_LIMIT', '本次批改修正次数已用尽，请重试批改', 'VALIDATION', true));
  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) {
    binding.repairs++;
    return err(new BusinessError('E_LLM_SCHEMA_INVALID', '批改结果格式不正确，请修正指定字段', 'VALIDATION', true, { issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }));
  }
  const result = await binding.save({ ...parsed.data, maxScore: 100 });
  if (result.ok) binding.result = result.value;
  return result;
}

export class SubmitExerciseGradeTool implements ToolDefinition<unknown, TextbookExerciseAttempt> {
  readonly name = 'learning.submit_grade';
  readonly description = '提交当前作答的真实批改。仅填写 0–100 的 score、feedback、suggestions，可提供 revisedAnswer；合理等价表达可得分。按本题评分要求判定，不生成身份或数据库字段。修正拒绝字段后可重新提交；回执成功才代表保存完成。';
  readonly schema = SubmitExerciseGradeSchema;
  readonly location = ToolLocations.SERVER;
  readonly permission = ToolPermissions.WRITE;
  readonly bindings = new Map<string, GradeBinding>();
  async execute(raw: unknown, context: ToolExecutionContext): Promise<Result<TextbookExerciseAttempt, BusinessError>> {
    const binding = this.bindings.get(context.sessionId);
    if (!binding?.active || binding.userId !== context.userId || !binding.turnId || binding.turnId !== context.turnId) return err(new BusinessError('E_GRADING_SCOPE_INVALID', '该调用不属于当前作答的批改轮次', 'VALIDATION'));
    return submitGradeAttempt(this, binding, raw);
  }
}
