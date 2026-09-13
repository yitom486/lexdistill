import type { BusinessError, Result } from '@study-studio/shared';

/**
 * M3-1 学习算法版本化契约（纯类型 + 轻量工厂类型，无运行时依赖）。
 *
 * 版本策略（M3 锁定）：
 * - 每个算法有稳定 `algorithmId` + 语义化 `algorithmVersion`；
 * - 算法输入与输出必须携带版本戳，便于按历史版本重算与审计；
 * - 每次排程附带 `SchedulingTrace`（输入快照 + 输出 + 评估时刻），可序列化；
 * - 升级算法只新增版本化入口，绝不静默改变旧版本行为；
 * - 本包只做纯计算：不触存储、不触网络、不触 Agent、不引厂商 SDK（单测锁定）。
 */

/** 算法稳定标识（如 'fsrs'；算法名称不写死在业务 API 中，由调用方透传）。 */
export type AlgorithmId = string;

/** 算法语义化版本（如 '1.0.0'；精确匹配才可用于历史重算）。 */
export type AlgorithmVersion = string;

export interface Versioned<T> {
  algorithmId: AlgorithmId;
  algorithmVersion: AlgorithmVersion;
  value: T;
}

/**
 * 可追溯计算记录：输入快照 + 输出 + 评估时刻。
 * `evaluatedAt` 取自本次输入的 `now`（不是系统当前时间），因此含 trace 在内
 * 的完整输出由输入完全确定，支持按历史版本重算与审计。
 */
export interface SchedulingTrace<TState> {
  algorithmId: AlgorithmId;
  algorithmVersion: AlgorithmVersion;
  inputState: TState;
  rating: string;
  evaluatedAt: string;
  outputState: TState;
}

/**
 * 复习排程器契约（版本 pinned：工厂函数名即版本，行为冻结）。
 * - 输入与输出都必须携带版本戳；版本不匹配明确拒绝，绝不静默按本版本计算；
 * - `now` 由调用方显式传入——固定输入必得固定输出（含 trace 在内全等，单测锁定）。
 */
export interface SchedulerInput<TState, TRating extends string = string> {
  algorithmId: AlgorithmId;
  algorithmVersion: AlgorithmVersion;
  state: TState;
  rating: TRating;
  now: Date;
}

export interface SchedulerOutput<TState> {
  algorithmId: AlgorithmId;
  algorithmVersion: AlgorithmVersion;
  state: TState;
  trace: SchedulingTrace<TState>;
}

export interface ReviewScheduler<TState, TRating extends string> {
  readonly algorithmId: AlgorithmId;
  readonly algorithmVersion: AlgorithmVersion;
  schedule(input: SchedulerInput<TState, TRating>): Result<SchedulerOutput<TState>, BusinessError>;
}
