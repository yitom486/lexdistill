import type { GeneratedQuestion, QuizGradingResult } from '@lexdistill/protocol';
import { generateId, nowIso } from '@lexdistill/shared';

export interface MistakeEntry {
  id: string;
  userId: string;
  questionId: string;
  question: GeneratedQuestion;
  lastUserSubmission: string;
  lastGrading: QuizGradingResult;
  recordedAt: string;
  lastRetriedAt?: string | undefined;
  retryCount: number;
  consecutiveCorrect: number;
  isResolved: boolean;
}

/**
 * 录入新的错题记录
 */
export function createMistakeEntry(
  userId: string,
  question: GeneratedQuestion,
  submission: string,
  grading: QuizGradingResult
): MistakeEntry {
  return {
    id: generateId('mst'),
    userId,
    questionId: question.id,
    question,
    lastUserSubmission: submission,
    lastGrading: grading,
    recordedAt: nowIso(),
    retryCount: 0,
    consecutiveCorrect: 0,
    isResolved: false,
  };
}

/**
 * 记录错题重做结果并流转攻克状态
 */
export function recordMistakeRetry(
  entry: MistakeEntry,
  isCorrect: boolean,
  newSubmission: string,
  newGrading: QuizGradingResult
): MistakeEntry {
  const retryCount = entry.retryCount + 1;
  const consecutiveCorrect = isCorrect ? entry.consecutiveCorrect + 1 : 0;
  // 连续重做对 2 次判定为攻克
  const isResolved = consecutiveCorrect >= 2;

  return {
    ...entry,
    lastUserSubmission: newSubmission,
    lastGrading: newGrading,
    retryCount,
    consecutiveCorrect,
    isResolved,
    lastRetriedAt: nowIso(),
  };
}
