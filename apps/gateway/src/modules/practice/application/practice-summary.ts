import { ok, err, isOk, type Result, BusinessError, translateToBusinessError, nowIso } from '@study-studio/shared';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { PracticeItemAttempt, PracticePlanRun } from '@study-studio/protocol';
import { buildLocalRunSummary as buildLocalRunSummaryPure, type RunSummaryReport } from '@study-studio/learning';

/**
 * P5-PhaseD：练习运行汇总与下次建议（可审计、模型不可用回退本地规则）。
 *
 * 不变量：
 * - 只读：只读取 run + attempts，不写任何学习状态。
 * - 模型不可用不伪造：失败时回退本地规则汇总，`source` 标记为 `local`，`failureReason` 记录原因。
 * - 汇总实现已迁入 practice-core，此处只做读取/翻译/时间注入。
 */

/** 报告类型兼容出口：定义已迁入 practice-core，经 learning 转出以保持 Tool/测试链路不动。 */
export type { RunSummaryReport } from '@study-studio/learning';

export interface SummarizeOptions {
  repo: LearnerRepository;
  userId: string;
  runId: string;
}

/** 读取运行与尝试，生成汇总（本地规则；AI 增强可后续叠加，仍走同一回退）。 */
export async function summarizePracticeRun(
  opts: SummarizeOptions
): Promise<Result<RunSummaryReport, BusinessError>> {
  const { repo, userId, runId } = opts;
  try {
    const runRes = await repo.getPracticePlanRun(userId, runId);
    if (!isOk(runRes)) return runRes;
    if (!runRes.value) {
      return err(new BusinessError('E_RUN_NOT_FOUND', '练习运行未找到', 'DATABASE'));
    }
    const run = runRes.value as PracticePlanRun;

    const attemptsRes = await repo.listPracticeItemAttempts(runId);
    if (!isOk(attemptsRes)) return attemptsRes;
    const attempts = attemptsRes.value as PracticeItemAttempt[];

    return ok(buildLocalRunSummary(run, attempts));
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'summarizePracticeRun', entityId: runId })
    );
  }
}

/**
 * M7-14 兼容薄包装：实现已迁入 practice-core，此处只注入时间。
 * 既有 `buildLocalRunSummary(run, attempts)` 调用方（测试等）无需修改。
 */
export function buildLocalRunSummary(
  run: PracticePlanRun,
  attempts: PracticeItemAttempt[]
): RunSummaryReport {
  return buildLocalRunSummaryPure(run, attempts, nowIso());
}
