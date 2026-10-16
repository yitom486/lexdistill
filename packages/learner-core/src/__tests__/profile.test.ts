import { describe, expect, it } from 'bun:test';
import {
  recordSkillAttempt,
  buildProfileSnapshot,
  createMistakeEntry,
  recordMistakeRetry,
  type SkillMetric,
} from '../index.js';
import type { GeneratedQuestion, QuizGradingResult } from '@lexdistill/protocol';

describe('Learner Core - Profile & Mistake Logic', () => {
  const sampleMetric: SkillMetric = {
    id: 'jp.particle.ni_vs_de',
    dimension: 'GRAMMAR',
    name: '助词「に」与「で」场所区分',
    proficiency: 0.5,
    totalAttempts: 2,
    correctAttempts: 1,
    consecutiveErrors: 0,
    status: 'NORMAL',
  };

  it('should mark skill as WEAKNESS on 2 consecutive errors', () => {
    const error1 = recordSkillAttempt(sampleMetric, false);
    expect(error1.consecutiveErrors).toBe(1);

    const error2 = recordSkillAttempt(error1, false);
    expect(error2.consecutiveErrors).toBe(2);
    expect(error2.status).toBe('WEAKNESS');
  });

  it('should mark skill as STRENGTH when proficiency >= 0.85 and attempts >= 5', () => {
    let metric: SkillMetric = {
      ...sampleMetric,
      totalAttempts: 4,
      correctAttempts: 4,
      proficiency: 0.9,
      consecutiveErrors: 0,
    };

    metric = recordSkillAttempt(metric, true);
    expect(metric.totalAttempts).toBe(5);
    expect(metric.correctAttempts).toBe(5);
    expect(metric.status).toBe('STRENGTH');
  });

  it('should build profile snapshot separating strengths and weaknesses', () => {
    const metrics: SkillMetric[] = [
      { ...sampleMetric, id: 'm1', status: 'STRENGTH' },
      { ...sampleMetric, id: 'm2', status: 'WEAKNESS' },
      { ...sampleMetric, id: 'm3', status: 'NORMAL' },
    ];

    const snapshot = buildProfileSnapshot('u1', 'ja', 'N3', metrics);
    expect(snapshot.strengths.length).toBe(1);
    expect(snapshot.strengths[0]?.id).toBe('m1');
    expect(snapshot.weaknesses.length).toBe(1);
    expect(snapshot.weaknesses[0]?.id).toBe('m2');
  });

  it('should track mistake retry and resolve after 2 consecutive correct', () => {
    const mockQuestion: GeneratedQuestion = {
      id: 'q1',
      type: 'MULTIPLE_CHOICE',
      prompt: 'Prompt',
      content: 'Content',
      correctAnswer: 'A',
      explanation: 'Exp',
      testedSkillId: 'm1',
      difficultyTier: 2,
    };

    const mockGrading: QuizGradingResult = {
      questionId: 'q1',
      isCorrect: false,
      score: 0,
      correctAnswer: 'A',
      userSubmission: 'B',
      explanation: 'Exp',
      mistakeRecorded: true,
    };

    const mistake = createMistakeEntry('u1', mockQuestion, 'B', mockGrading);
    expect(mistake.isResolved).toBe(false);

    // 第一次答对，还未彻底攻克
    const retry1 = recordMistakeRetry(mistake, true, 'A', { ...mockGrading, isCorrect: true });
    expect(retry1.consecutiveCorrect).toBe(1);
    expect(retry1.isResolved).toBe(false);

    // 第二次连对，标记攻克
    const retry2 = recordMistakeRetry(retry1, true, 'A', { ...mockGrading, isCorrect: true });
    expect(retry2.consecutiveCorrect).toBe(2);
    expect(retry2.isResolved).toBe(true);
  });
});
