import {
  createFsrsSchedulerV1,
  FSRS_ALGORITHM_ID,
  FSRS_ALGORITHM_VERSION,
  type FsrsState,
  type SchedulerOutput,
} from '@study-studio/learning-algorithms';
import type { CardReviewRating } from '@study-studio/protocol';
import { type Result, type BusinessError } from '@study-studio/shared';

/**
 * M6-1 版本化复习排程应用入口（FSRS v1，自 learner-core 迁入；C6 起归属 learning/src/scheduling，行为不变）。
 *
 * - 调用方只给状态/评分/显式 now，版本戳由本入口锁定填入，
 *   版本门错误经 Result 原样上抛，绝不吞掉；
 * - 输出含版本戳、排程状态与确定性 trace（trace 持久化留待存储阶段，
 *   本入口不写库）；
 * - 本包只做纯排程：不触 learner-core、不触 Gateway、不触 SQLite/Drizzle、
 *   不触 Web、不触 Agent（单测锁定）。
 */
export interface FsrsReviewInput {
  state: FsrsState;
  rating: CardReviewRating;
  now: Date;
}

export function scheduleFsrsReviewV1(
  input: FsrsReviewInput
): Result<SchedulerOutput<FsrsState>, BusinessError> {
  return createFsrsSchedulerV1().schedule({
    algorithmId: FSRS_ALGORITHM_ID,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
    state: input.state,
    rating: input.rating,
    now: input.now,
  });
}
