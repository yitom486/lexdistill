import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, err, isOk, type Result, BusinessError } from '@lexdistill/shared';
import type { LearnerRepository } from '@lexdistill/learner-core';
import type {
  PracticePlanRun,
  PracticeItemAttempt,
  PracticeBlockSpec,
} from '@lexdistill/protocol';
import { PracticeBlockSpecSchema } from '@lexdistill/protocol';
import { summarizePracticeRun, type RunSummaryReport } from '../application/practice-summary.js';
import { submitObjectiveItem } from '../application/submit-objective-item.js';

/**
 * P5：练习计划执行会话的受控写入工具。
 *
 * 职责：仅处理 UI 已确认的结构化请求——开始运行、保存草稿、提交客观/主观题、
 * 批量提交、完成运行。批改结果（gradingResult）由调用方（learning.assess /
 * learning.assess.grade_batch 或 UI 即时判定）传入；本工具不自行调用模型，
 * 也不接受模型自由文本直接写数据库。
 *
 * 幂等：submit_objective / submit_subjective 按 (runId, itemId) upsert；
 * finalize_run 在事务内按 itemId 跳过已写入的 quiz_attempts，重复提交/完成不双计。
 */
export const LearningPracticeInputSchema = z.object({
  action: z.enum([
    'start_run',
    'get_run',
    'save_draft',
    'submit_objective',
    'submit_subjective',
    'submit_batch',
    'finalize_run',
    // P5-PhaseD：运行汇总与下次建议（只读，模型不可用回退本地规则）
    'summarize_run',
  ]),
  // start_run
  language: z.enum(['en', 'ja', 'ko']).optional(),
  templateId: z.string().optional(),
  blocks: z.array(PracticeBlockSpecSchema).optional(),
  // get_run / save_draft / submit / finalize
  runId: z.string().optional(),
  // save_draft / submit_objective / submit_subjective
  itemId: z.string().optional(),
  userAnswer: z.string().optional(),
  // submit_objective：即时自动判定结果
  isCorrect: z.boolean().optional(),
  score: z.number().optional(),
  testedSkillId: z.string().optional(),
  // submit_subjective：已由 learning.assess 产出的批改结果
  gradingResult: z.record(z.string(), z.unknown()).optional(),
  // submit_batch：批量已批改结果（按 itemId 对齐）
  items: z
    .array(
      z.object({
        itemId: z.string(),
        userAnswer: z.string(),
        gradingResult: z.record(z.string(), z.unknown()),
        timeSpentMs: z.number().optional(),
      })
    )
    .optional(),
  timeSpentMs: z.number().optional(),
});

export type LearningPracticeInput = z.infer<typeof LearningPracticeInputSchema>;

export interface LearningPracticeOutput {
  run?: PracticePlanRun | undefined;
  attempt?: PracticeItemAttempt | undefined;
  attempts?: PracticeItemAttempt[] | undefined;
  /** 批量提交的逐题结果摘要 */
  batchSummary?: { total: number; graded: number; correct: number } | undefined;
  finalized?: boolean | undefined;
  /** P5-PhaseD：运行汇总 */
  summary?: RunSummaryReport | undefined;
}

export class LearningPracticeTool
  implements ToolDefinition<LearningPracticeInput, LearningPracticeOutput>
{
  public readonly name = 'learning.practice';
  public readonly description =
    '练习计划执行会话：开始/读取运行、保存草稿、提交客观或主观题、批量提交、完成运行。批改结果由调用方传入，本工具不自行调用模型。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = LearningPracticeInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  public async execute(
    input: LearningPracticeInput,
    context: ToolExecutionContext
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    const userId = context.userId;
    switch (input.action) {
      case 'start_run':
        return this.startRun(userId, input);
      case 'get_run':
        return this.getRun(userId, input);
      case 'save_draft':
        return this.saveDraft(userId, input);
      case 'submit_objective':
        return this.submitObjective(userId, input);
      case 'submit_subjective':
        return this.submitSubjective(userId, input);
      case 'submit_batch':
        return this.submitBatch(userId, input);
      case 'finalize_run':
        return this.finalizeRun(userId, input);
      case 'summarize_run':
        return this.summarizeRun(userId, input);
      default:
        return err(new BusinessError('E_INVALID_INPUT', `未知 action: ${input.action as string}`, 'VALIDATION'));
    }
  }

  private async startRun(
    userId: string,
    input: LearningPracticeInput
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    if (!input.language) {
      return err(new BusinessError('E_INVALID_INPUT', 'start_run 需要 language', 'VALIDATION'));
    }
    const res = await this.learnerRepo.startPracticePlanRun(userId, {
      language: input.language,
      templateId: input.templateId,
      blocks: input.blocks as PracticeBlockSpec[] | undefined,
    });
    if (!isOk(res)) return err(res.error);
    return ok({ run: res.value });
  }

  private async getRun(
    userId: string,
    input: LearningPracticeInput
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    if (!input.runId) {
      return err(new BusinessError('E_INVALID_INPUT', 'get_run 需要 runId', 'VALIDATION'));
    }
    const runRes = await this.learnerRepo.getPracticePlanRun(userId, input.runId);
    if (!isOk(runRes)) return err(runRes.error);
    const attemptsRes = await this.learnerRepo.listPracticeItemAttempts(input.runId);
    if (!isOk(attemptsRes)) return err(attemptsRes.error);
    return ok({ run: runRes.value ?? undefined, attempts: attemptsRes.value });
  }

  private async saveDraft(
    userId: string,
    input: LearningPracticeInput
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    if (!input.runId || !input.itemId || input.userAnswer === undefined) {
      return err(new BusinessError('E_INVALID_INPUT', 'save_draft 需要 runId/itemId/userAnswer', 'VALIDATION'));
    }
    const res = await this.learnerRepo.savePracticeItemDraft(userId, input.runId, input.itemId, input.userAnswer);
    if (!isOk(res)) return err(res.error);
    return ok({ attempt: res.value });
  }

  private async submitObjective(
    userId: string,
    input: LearningPracticeInput
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    if (!input.runId || !input.itemId || input.userAnswer === undefined) {
      return err(new BusinessError('E_INVALID_INPUT', 'submit_objective 需要 runId/itemId/userAnswer', 'VALIDATION'));
    }
    const res = await submitObjectiveItem(this.learnerRepo, { userId, runId: input.runId, itemId: input.itemId,
      userAnswer: input.userAnswer, timeSpentMs: input.timeSpentMs });
    if (!isOk(res)) return err(res.error);
    return ok({ attempt: res.value });
  }

  private async submitSubjective(
    userId: string,
    input: LearningPracticeInput
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    if (!input.runId || !input.itemId || input.userAnswer === undefined || !input.gradingResult) {
      return err(
        new BusinessError('E_INVALID_INPUT', 'submit_subjective 需要 runId/itemId/userAnswer/gradingResult', 'VALIDATION')
      );
    }
    const res = await this.learnerRepo.submitPracticeItem(
      userId,
      input.runId,
      input.itemId,
      input.userAnswer,
      input.gradingResult,
      input.timeSpentMs
    );
    if (!isOk(res)) return err(res.error);
    return ok({ attempt: res.value });
  }

  private async submitBatch(
    userId: string,
    input: LearningPracticeInput
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    if (!input.runId || !input.items || input.items.length === 0) {
      return err(new BusinessError('E_INVALID_INPUT', 'submit_batch 需要 runId/items', 'VALIDATION'));
    }
    const attempts: PracticeItemAttempt[] = [];
    let correct = 0;
    for (const it of input.items) {
      const res = await this.learnerRepo.submitPracticeItem(
        userId,
        input.runId,
        it.itemId,
        it.userAnswer,
        it.gradingResult,
        it.timeSpentMs
      );
      if (!isOk(res)) return err(res.error);
      attempts.push(res.value);
      if ((it.gradingResult as { isCorrect?: boolean }).isCorrect) correct++;
    }
    return ok({
      attempts,
      batchSummary: { total: input.items.length, graded: attempts.length, correct },
    });
  }

  private async finalizeRun(
    userId: string,
    input: LearningPracticeInput
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    if (!input.runId) {
      return err(new BusinessError('E_INVALID_INPUT', 'finalize_run 需要 runId', 'VALIDATION'));
    }
    const res = await this.learnerRepo.finalizePracticePlanRun(userId, input.runId);
    if (!isOk(res)) return err(res.error);
    return ok({ run: res.value, finalized: true });
  }

  /** P5-PhaseD：运行汇总（只读，模型不可用回退本地规则）。 */
  private async summarizeRun(
    userId: string,
    input: LearningPracticeInput
  ): Promise<Result<LearningPracticeOutput, BusinessError>> {
    if (!input.runId) {
      return err(new BusinessError('E_INVALID_INPUT', 'summarize_run 需要 runId', 'VALIDATION'));
    }
    const res = await summarizePracticeRun({ repo: this.learnerRepo, userId, runId: input.runId });
    if (!isOk(res)) return err(res.error);
    return ok({ summary: res.value });
  }
}
