import type { CardReviewRating } from '@study-studio/protocol';
import { addDays, err, nowIso, ok, type Result, BusinessError } from '@study-studio/shared';
import type { ReviewScheduler, SchedulerInput, SchedulerOutput } from './contracts.js';

/**
 * M3-1 FSRS v1（从 learner-core 原样迁移，行为逐行一致；调用点不动）。
 *
 * 版本：algorithmId 'fsrs' / algorithmVersion '1.0.0'。
 * 确定性：`scheduleNextReview` 传入显式 `now` 即完全确定；
 * `initFsrsState` 保留原 wall-clock 语义（dueAt=now），调用方已有快照覆盖。
 */

export const FSRS_ALGORITHM_ID = 'fsrs';
export const FSRS_ALGORITHM_VERSION = '1.0.0';

export interface FsrsState {
  stability: number;       // 记忆稳定性 S
  difficulty: number;      // 难度 D (1 ~ 10)
  reps: number;            // 复习次数
  lapses: number;          // 遗忘次数
  lastReviewedAt?: string;
  dueAt: string;
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
}

/**
 * 创建新卡片的初始 FSRS 状态
 */
export function initFsrsState(): FsrsState {
  return {
    stability: 1.0,
    difficulty: 5.0,
    reps: 0,
    lapses: 0,
    dueAt: nowIso(),
    state: 'NEW',
  };
}

/**
 * 依据学习者评分更新 FSRS 状态并计算下次复习时间
 */
export function scheduleNextReview(
  current: FsrsState,
  rating: CardReviewRating,
  now: Date = new Date()
): FsrsState {
  let { stability, difficulty, reps, lapses, state } = current;
  reps += 1;

  switch (rating) {
    case 'AGAIN':
      lapses += 1;
      stability = Math.max(0.5, stability * 0.5);
      difficulty = Math.min(10, difficulty + 1.2);
      state = reps === 1 ? 'LEARNING' : 'RELEARNING';
      break;

    case 'HARD':
      stability = Math.max(1.0, stability * 1.2);
      difficulty = Math.min(10, difficulty + 0.4);
      state = 'REVIEW';
      break;

    case 'GOOD':
      stability = Math.max(1.5, stability * 2.2);
      difficulty = Math.max(1, difficulty - 0.2);
      state = 'REVIEW';
      break;

    case 'EASY':
      stability = Math.max(2.5, stability * 3.5);
      difficulty = Math.max(1, difficulty - 0.8);
      state = 'REVIEW';
      break;
  }

  // 间隔天数大致正比于稳定性
  const intervalDays = Math.max(1, Math.round(stability));
  const dueAtDate = addDays(now, intervalDays);

  return {
    stability: Number(stability.toFixed(2)),
    difficulty: Number(difficulty.toFixed(2)),
    reps,
    lapses,
    lastReviewedAt: now.toISOString(),
    dueAt: dueAtDate.toISOString(),
    state,
  };
}

/**
 * 版本 pinned 的 FSRS v1 排程器入口：输入版本必须为 fsrs / 1.0.0，
 * 不匹配明确拒绝；输出永远带版本戳与可追溯记录。
 */
export function createFsrsSchedulerV1(): ReviewScheduler<FsrsState, CardReviewRating> {
  return {
    algorithmId: FSRS_ALGORITHM_ID,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
    schedule(
      input: SchedulerInput<FsrsState, CardReviewRating>
    ): Result<SchedulerOutput<FsrsState>, BusinessError> {
      if (
        input.algorithmId !== FSRS_ALGORITHM_ID ||
        input.algorithmVersion !== FSRS_ALGORITHM_VERSION
      ) {
        const gotId = String(input.algorithmId).slice(0, 64);
        const gotVersion = String(input.algorithmVersion).slice(0, 64);
        return err(
          new BusinessError(
            'E_ALGORITHM_VERSION',
            `算法版本不匹配：本入口只接受 ${FSRS_ALGORITHM_ID} / ${FSRS_ALGORITHM_VERSION}，收到 ${gotId} / ${gotVersion}`,
            'VALIDATION',
            false
          )
        );
      }
      const state = scheduleNextReview(input.state, input.rating, input.now);
      return ok({
        algorithmId: FSRS_ALGORITHM_ID,
        algorithmVersion: FSRS_ALGORITHM_VERSION,
        state,
        trace: {
          algorithmId: FSRS_ALGORITHM_ID,
          algorithmVersion: FSRS_ALGORITHM_VERSION,
          inputState: input.state,
          rating: input.rating,
          evaluatedAt: input.now.toISOString(),
          outputState: state,
        },
      });
    },
  };
}
