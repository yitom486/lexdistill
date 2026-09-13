import type { Result, BusinessError } from '@study-studio/shared';
import type {
  GeneratedQuestion,
  LearnerLevel,
  PracticeCollection,
  PracticeItem,
} from '@study-studio/protocol';
import type { MistakeEntry, TargetLanguage } from '@study-studio/learner-core';
import type { PersistableQuestion } from './persistence/questions.js';
import type { PlacementExam, PlacementFinishResult } from './persistence/placement.js';

/**
 * M1-2 学习（learning）领域仓储能力契约。
 *
 * 宿主说明：learning 域横跨 practice / learning-progress / review 三个现模块，
 * 本契约暂宿于 practice 模块（所需类型全部同模块，零跨模块自引用），M6 合并为
 * learning 包时随代码整体迁移，届时改一处 import 前缀即可。
 *
 * - 方法签名与 DrizzleLearnerRepository 实现逐字对齐（`implements` 编译期锁定）；
 * - 画像/计划/卡片/错题基础能力复用 learner-core `LearnerRepository`，此处不重复声明；
 * - 只收上层实际消费的高层方法，不含 raw 句柄与 drizzle 直连。
 */
export interface LearningRepository {
  getQuestions(
    userId: string,
    limit?: number,
    langOverride?: string,
    filter?: {
      types?: string[] | undefined;
      difficulty?: number | undefined;
      skillIds?: string[] | undefined;
    }
  ): Promise<Result<PersistableQuestion[], BusinessError>>;
  saveQuestions(questions: PersistableQuestion[]): Promise<Result<void, BusinessError>>;
  isPlacementRun(runId: string): boolean;
  startPlacementExam(
    userId: string,
    track: TargetLanguage,
    targetLevel: LearnerLevel
  ): Promise<Result<{ exam: PlacementExam; runId: string }, BusinessError>>;
  finishPlacementExam(
    userId: string,
    examId: string
  ): Promise<Result<PlacementFinishResult, BusinessError>>;
  getPlacementByRunId(runId: string): Promise<PlacementExam | null>;
  listContentTemplates(options: {
    action: string;
    language: string;
    skillId?: string | undefined;
    format?: string | undefined;
    genre?: string | undefined;
    limit?: number | undefined;
  }): Promise<
    Result<
      Array<{
        id: string;
        language: string;
        action: string;
        format: string | null;
        skillId: string | null;
        difficulty: number;
        topic: string | null;
        genre: string | null;
        sortOrder: number;
        payload: Record<string, unknown>;
      }>,
      BusinessError
    >
  >;
  listPracticeCollections(
    userId: string,
    limit?: number
  ): Promise<Result<PracticeCollection[], BusinessError>>;
  listPracticeItems(
    userId: string,
    collectionId: string
  ): Promise<Result<PracticeItem[], BusinessError>>;
  convertPracticeItemsToCards(
    userId: string,
    itemIds: string[]
  ): Promise<
    Result<{ createdCount: number; cardIds: string[]; skippedItemIds: string[] }, BusinessError>
  >;
  collectPracticeQuestions(input: {
    userId: string;
    title: string;
    intent?: string;
    layoutHint?: string | undefined;
    sourceRef?: string | undefined;
    questions: GeneratedQuestion[];
    planRunId?: string | undefined;
    blockId?: string | undefined;
    gradingMode?: string | undefined;
  }): Promise<Result<{ collection: PracticeCollection; items: PracticeItem[] }, BusinessError>>;
  resolveMistake(mistakeId: string): Promise<Result<void, BusinessError>>;
  retryMistake(
    userId: string,
    mistakeId: string,
    isCorrect: boolean
  ): Promise<Result<Pick<MistakeEntry, 'consecutiveCorrect' | 'isResolved' | 'retryCount'>, BusinessError>>;
  countPlacementAttempts(userId: string, targetLevel: string): Promise<number>;
}
