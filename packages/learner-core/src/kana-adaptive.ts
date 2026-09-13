import { initFsrsState, type FsrsState } from './fsrs.js';
import { isOk } from '@study-studio/shared';
import {
  createFsrsSchedulerV1,
  FSRS_ALGORITHM_ID,
  FSRS_ALGORITHM_VERSION,
} from '@study-studio/learning-algorithms';
import type { CardReviewRating } from '@study-studio/protocol';

export type KanaPracticeScriptType = 'HIRAGANA' | 'KATAKANA' | 'ROMAJI';

export interface AdaptiveKanaQueueOptions {
  types?: readonly string[];
  scriptType?: KanaPracticeScriptType;
  limit?: number;
}

export interface KanaPracticeMemory {
  fsrs: FsrsState;
  consecutiveErrors: number;
}

export interface AdaptiveKanaCandidate {
  id: string;
  sortOrder: number;
  memory?: KanaPracticeMemory;
}

/**
 * 假名采用二级反馈：答对视为 GOOD，答错视为 AGAIN；错误另外保留短重学间隔，
 * 让下一轮仍能优先看到，而不是等到完整的一天后才再次出现。
 */
export function updateKanaPracticeMemory(
  current: KanaPracticeMemory | undefined,
  isCorrect: boolean,
  now: Date = new Date()
): KanaPracticeMemory {
  // 与 `@study-studio/learning` 的 scheduleFsrsReviewV1 逐行同义（同内核、
  // 同版本 pin、同入参）：kana-adaptive 留在 learner-core，直接调 learning 会
  // 形成 learner-core → learning 项目引用环（tsc TS6202 禁止），故内联此 7 行
  // 委托。版本升级时两处必须同步；行为一致性由 kana-adaptive.test.ts 锁定。
  const rating: CardReviewRating = isCorrect ? 'GOOD' : 'AGAIN';
  const scheduled = createFsrsSchedulerV1().schedule({
    algorithmId: FSRS_ALGORITHM_ID,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
    state: current?.fsrs ?? initFsrsState(),
    rating,
    now,
  });
  if (!isOk(scheduled)) {
    // 版本门失败属契约错误：同步返回形状无法承载 Result，直接抛出，
    // 绝不静默回退裸算（正常路径版本恒匹配，此分支不可达）。
    throw scheduled.error;
  }
  const nextFsrs = scheduled.value.state;

  if (!isCorrect) {
    return {
      fsrs: {
        ...nextFsrs,
        dueAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        state: nextFsrs.reps === 1 ? 'LEARNING' : 'RELEARNING',
      },
      consecutiveErrors: (current?.consecutiveErrors ?? 0) + 1,
    };
  }

  return {
    fsrs: nextFsrs,
    consecutiveErrors: 0,
  };
}

function reviewPriority(candidate: AdaptiveKanaCandidate, nowMs: number): number {
  const memory = candidate.memory;
  if (!memory || memory.fsrs.reps === 0) {
    return 4_000_000 - Math.min(candidate.sortOrder, 100_000);
  }

  const dueAtMs = Date.parse(memory.fsrs.dueAt);
  const hasDueAt = Number.isFinite(dueAtMs);
  const isDue = !hasDueAt || dueAtMs <= nowMs;
  const overdueHours = isDue && hasDueAt ? Math.max(0, (nowMs - dueAtMs) / 3_600_000) : 0;
  const dueInHours = !isDue && hasDueAt ? Math.max(0, (dueAtMs - nowMs) / 3_600_000) : 0;

  // 连错必须压过新题；历史遗忘过的题仍高于普通到期复习。
  if (memory.consecutiveErrors > 0) {
    return (
      6_000_000 +
      memory.consecutiveErrors * 100_000 +
      memory.fsrs.lapses * 10_000 +
      Math.min(overdueHours, 100_000)
    );
  }
  if (memory.fsrs.lapses > 0) {
    return 5_000_000 + (isDue ? Math.min(overdueHours, 100_000) : 100_000 / (1 + dueInHours));
  }
  if (isDue) {
    return 3_000_000 + Math.min(overdueHours, 100_000);
  }
  if (memory.fsrs.reps < 3) {
    return 2_000_000 - memory.fsrs.reps * 10_000 - Math.min(dueInHours, 100_000);
  }

  // 已连续答对且尚未到期的项目只作低优先级补位，避免每轮重复熟题。
  return 1_000_000 - Math.min(dueInHours, 100_000);
}

/**
 * 从课程候选中选择本轮题目。limit 为 0 时返回全部，但仍按自适应优先级排序。
 * 排序尾部使用课程顺序保证冷启动稳定，避免每次刷新都随机重复同一批题。
 */
export function selectAdaptiveKanaIds(
  candidates: readonly AdaptiveKanaCandidate[],
  limit = 10,
  now: Date = new Date()
): string[] {
  const nowMs = now.getTime();
  const count = limit > 0 && Number.isFinite(limit) ? Math.floor(limit) : candidates.length;

  return candidates
    .map((candidate) => ({ candidate, priority: reviewPriority(candidate, nowMs) }))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        a.candidate.sortOrder - b.candidate.sortOrder ||
        a.candidate.id.localeCompare(b.candidate.id)
    )
    .slice(0, Math.min(Math.max(count, 0), candidates.length))
    .map(({ candidate }) => candidate.id);
}
