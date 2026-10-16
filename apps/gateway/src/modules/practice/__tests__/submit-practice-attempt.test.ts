import { describe, expect, it } from 'bun:test';
import { err, ok, BusinessError } from '@lexdistill/shared';
import type {
  LearnerProfileSnapshot,
  MistakeEntry,
  SkillMetric,
} from '@lexdistill/learner-core';
import {
  submitPracticeAttempt,
  type PracticeSubmissionRepository,
  type SubmitPracticeAttemptInput,
} from '../public.js';

const input: SubmitPracticeAttemptInput = {
  userId: 'practice-test-user',
  questionId: 'practice-test-question',
  userAnswer: 'A',
  isCorrect: false,
  score: 0,
  timeSpentMs: 1200,
  testedSkillId: 'en.test.skill',
};

const metric: SkillMetric = {
  id: input.testedSkillId,
  dimension: 'GRAMMAR',
  name: 'Practice test skill',
  proficiency: 0.5,
  totalAttempts: 3,
  correctAttempts: 2,
  consecutiveErrors: 0,
  status: 'WEAKNESS',
};

const snapshot: LearnerProfileSnapshot = {
  userId: input.userId,
  targetLanguage: 'en',
  overallLevel: 'A1',
  strengths: [],
  weaknesses: [metric],
  allMetrics: [metric],
  updatedAt: '2026-09-23T00:00:00.000Z',
};

function createRepository(
  overrides: Partial<PracticeSubmissionRepository> = {}
): PracticeSubmissionRepository {
  return {
    recordQuizAttempt: async () => ok(undefined),
    getProfileSnapshot: async () => ok(snapshot),
    saveSkillMetric: async () => ok(undefined),
    saveMistake: async () => ok(undefined),
    ...overrides,
  };
}

describe('submitPracticeAttempt', () => {
  it('records the attempt, updates the skill, then stores a wrong answer as a mistake', async () => {
    const calls: string[] = [];
    let recordedAttempt:
      | Parameters<PracticeSubmissionRepository['recordQuizAttempt']>[0]
      | undefined;
    let savedMetric: SkillMetric | undefined;
    let savedMistake: MistakeEntry | undefined;
    const repo = createRepository({
      recordQuizAttempt: async (attempt) => {
        calls.push('recordQuizAttempt');
        recordedAttempt = attempt;
        return ok(undefined);
      },
      getProfileSnapshot: async () => {
        calls.push('getProfileSnapshot');
        return ok(snapshot);
      },
      saveSkillMetric: async (_userId, updatedMetric) => {
        calls.push('saveSkillMetric');
        savedMetric = updatedMetric;
        return ok(undefined);
      },
      saveMistake: async (mistake) => {
        calls.push('saveMistake');
        savedMistake = mistake;
        return ok(undefined);
      },
    });

    const result = await submitPracticeAttempt(repo, input);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'recordQuizAttempt',
      'getProfileSnapshot',
      'saveSkillMetric',
      'saveMistake',
    ]);
    expect(recordedAttempt).toMatchObject({
      userId: input.userId,
      questionId: input.questionId,
      userAnswer: input.userAnswer,
      isCorrect: false,
      score: input.score,
      timeSpentMs: input.timeSpentMs,
      testedSkillId: input.testedSkillId,
    });
    expect(recordedAttempt?.id.startsWith('att_')).toBe(true);
    expect(typeof recordedAttempt?.createdAt).toBe('string');
    expect(savedMetric).toMatchObject({
      id: input.testedSkillId,
      totalAttempts: metric.totalAttempts + 1,
      correctAttempts: metric.correctAttempts,
      consecutiveErrors: metric.consecutiveErrors + 1,
    });
    expect(savedMistake).toMatchObject({
      userId: input.userId,
      questionId: input.questionId,
      question: {
        id: input.questionId,
        type: 'MULTIPLE_CHOICE',
        prompt: '自适应客观题',
        content: '',
        correctAnswer: '',
        explanation: '',
        testedSkillId: input.testedSkillId,
        difficultyTier: 3,
      },
      lastUserSubmission: input.userAnswer,
      lastGrading: {
        isCorrect: false,
        score: 0,
        correctAnswer: '',
        userSubmission: input.userAnswer,
        explanation: '回答有误',
        mistakeRecorded: true,
      },
    });
  });

  it('returns an attempt write error and stops before reading or writing follow-up state', async () => {
    const failure = new BusinessError('E_ATTEMPT_WRITE', '记录失败', 'DATABASE');
    const calls: string[] = [];
    const repo = createRepository({
      recordQuizAttempt: async () => {
        calls.push('recordQuizAttempt');
        return err(failure);
      },
      getProfileSnapshot: async () => {
        calls.push('getProfileSnapshot');
        return ok(snapshot);
      },
      saveSkillMetric: async () => {
        calls.push('saveSkillMetric');
        return ok(undefined);
      },
      saveMistake: async () => {
        calls.push('saveMistake');
        return ok(undefined);
      },
    });

    const result = await submitPracticeAttempt(repo, input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(failure);
    expect(calls).toEqual(['recordQuizAttempt']);
  });

  it('returns a mistake write error after preserving the preceding successful writes', async () => {
    const failure = new BusinessError('E_MISTAKE_WRITE', '错题保存失败', 'DATABASE');
    const calls: string[] = [];
    const repo = createRepository({
      recordQuizAttempt: async () => {
        calls.push('recordQuizAttempt');
        return ok(undefined);
      },
      getProfileSnapshot: async () => {
        calls.push('getProfileSnapshot');
        return ok(snapshot);
      },
      saveSkillMetric: async () => {
        calls.push('saveSkillMetric');
        return ok(undefined);
      },
      saveMistake: async () => {
        calls.push('saveMistake');
        return err(failure);
      },
    });

    const result = await submitPracticeAttempt(repo, input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(failure);
    expect(calls).toEqual([
      'recordQuizAttempt',
      'getProfileSnapshot',
      'saveSkillMetric',
      'saveMistake',
    ]);
  });
});
