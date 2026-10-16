import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, err, isOk, type Result, BusinessError } from '@lexdistill/shared';
import type { DailyStudyPlan, LearnerRepository } from '@lexdistill/learner-core';
import type { PracticeBlockSpec } from '@lexdistill/protocol';
import { PracticeBlockSpecSchema } from '@lexdistill/protocol';
import { buildAnalysisSnapshot } from '../../modules/learning-progress/application/learning-analysis.js';
import { createProposal, type PracticeProposal } from '../../modules/practice/application/practice-proposal.js';

export const LearningPlanInputSchema = z.object({
  action: z.enum([
    'get',
    'complete_step',
    // P5：模板与运行只读查询（AI 只读层）
    'list_templates',
    'get_template',
    'preview_template',
    'get_today_run',
    // P5-PhaseD：AI 计划建议（只建议，不保存；apply 走 UI HTTP 令牌确认）
    'propose',
  ]),
  stepId: z.string().optional(),
  date: z.string().optional(),
  // list_templates / propose
  language: z.enum(['en', 'ja', 'ko']).optional(),
  includeDisabled: z.boolean().optional(),
  // get_template
  templateId: z.string().optional(),
  // preview_template
  blocks: z.array(PracticeBlockSpecSchema).optional(),
});

export type LearningPlanInput = z.infer<typeof LearningPlanInputSchema>;

export interface LearningPlanPreview {
  totalQuestions: number;
  aiGradingCount: number;
  estimatedMinutes: number;
  blocks: PracticeBlockSpec[];
}

/**
 * 当日学习计划：读取冻结步骤顺序，或把某一步记为已完成。
 * 完成态优先由打卡/FSRS/错题实时叠加；complete_step 用于无法自动计量的步骤。
 *
 * P5 扩展：list_templates / get_template / preview_template / get_today_run 为 AI 只读层，
 * 让 Agent 理解用户当前计划与剩余任务；模板保存/删除仍走 HTTP Mutation（不在此工具）。
 */
export class LearningPlanTool implements ToolDefinition<LearningPlanInput, unknown> {
  public readonly name = 'learning.plan';
  public readonly description =
    '获取今日学习计划、标记步骤完成，或只读查询练习计划模板与当日运行。模板保存/删除走 HTTP Mutation。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = LearningPlanInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  public async execute(
    input: LearningPlanInput,
    context: ToolExecutionContext
  ): Promise<Result<unknown, BusinessError>> {
    switch (input.action) {
      case 'get':
        return this.learnerRepo.getOrCreateDailyStudyPlan(context.userId, input.date);
      case 'complete_step': {
        if (!input.stepId) {
          return err(new BusinessError('E_INVALID_INPUT', '标记完成需要 stepId', 'VALIDATION'));
        }
        return this.learnerRepo.completeDailyPlanStep(context.userId, input.stepId, input.date);
      }
      case 'list_templates':
        return this.learnerRepo.listPracticePlanTemplates(context.userId, {
          language: input.language,
          includeDisabled: input.includeDisabled,
        });
      case 'get_template': {
        if (!input.templateId) {
          return err(new BusinessError('E_INVALID_INPUT', 'get_template 需要 templateId', 'VALIDATION'));
        }
        return this.learnerRepo.getPracticePlanTemplate(context.userId, input.templateId);
      }
      case 'preview_template':
        return this.previewTemplate(input);
      case 'get_today_run': {
        const res = await this.learnerRepo.listPracticePlanRuns(context.userId, {
          status: 'IN_PROGRESS',
          language: input.language,
        });
        if (!isOk(res)) return err(res.error);
        return ok(res.value);
      }
      case 'propose':
        return this.proposeTemplate(context.userId, input.language);
      default:
        return err(new BusinessError('E_INVALID_INPUT', `未知 action: ${input.action as string}`, 'VALIDATION'));
    }
  }

  /** P5-PhaseD：从学习者快照生成计划建议草案并签发一次性令牌（不保存）。 */
  private async proposeTemplate(
    userId: string,
    language: 'en' | 'ja' | 'ko' | undefined
  ): Promise<Result<PracticeProposal, BusinessError>> {
    const snapRes = await buildAnalysisSnapshot(this.learnerRepo, userId);
    if (!isOk(snapRes)) return snapRes;
    const snapshot = snapRes.value;
    const lang: 'en' | 'ja' | 'ko' =
      language ??
      (snapshot.targetLanguage === 'en' || snapshot.targetLanguage === 'ko'
        ? snapshot.targetLanguage
        : 'ja');
    const proposal = createProposal(userId, lang, snapshot);
    return ok(proposal);
  }

  private previewTemplate(input: LearningPlanInput): Result<LearningPlanPreview, BusinessError> {
    if (!input.blocks || input.blocks.length === 0) {
      return err(new BusinessError('E_INVALID_INPUT', 'preview_template 需要 blocks', 'VALIDATION'));
    }
    const blocks = input.blocks as PracticeBlockSpec[];
    let totalQuestions = 0;
    let aiGradingCount = 0;
    let estimatedMinutes = 0;
    for (const b of blocks) {
      totalQuestions += b.count;
      if (b.gradingMode === 'AI_IMMEDIATE' || b.gradingMode === 'AI_BATCH') {
        aiGradingCount += b.count;
      }
      // 粗估：客观题 0.5 分钟/题，主观题 2 分钟/题
      const per =
        b.kind === 'TRANSLATION' || b.kind === 'WRITING' ? 2 : b.kind === 'READING' ? 1.5 : 0.5;
      estimatedMinutes += b.count * per;
    }
    return ok({
      totalQuestions,
      aiGradingCount,
      estimatedMinutes: Math.max(1, Math.round(estimatedMinutes)),
      blocks,
    });
  }
}
