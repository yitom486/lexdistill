import { describe, expect, it } from 'bun:test';
import { ok, err, isOk, isErr, BusinessError } from '@lexdistill/shared';
import {
  buildAnalysisSnapshot,
  type AnalysisSnapshotPorts,
} from '../index.js';
import type { LearnerProfileSnapshot } from '@lexdistill/learner-core';

/** M7-10 快照组装用例测试（port 桩，不碰 Repository/时钟）。 */
const ASSEMBLED_AT = '2026-09-07T12:00:00.000Z';

function profile(): LearnerProfileSnapshot {
  return {
    userId: 'u1',
    targetLanguage: 'en',
    overallLevel: 'B1',
    profile: {
      userId: 'u1',
      displayName: 'tester',
      targetLanguage: 'en',
      studyGoal: 'CET6',
      learnerLevel: 'INTERMEDIATE',
      overallLevel: 'B1',
      overallProficiency: 0.5,
      streakDays: 4,
      maxStreakDays: 7,
      lastActiveDate: '2026-09-07',
      retentionRate: 0.8,
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dailyGoalNewWords: 10,
      wordLevelFilter: null,
      totalStudyMinutes: 120,
      totalCardsReviewed: 30,
      totalQuizzesAnswered: 20,
      updatedAt: ASSEMBLED_AT,
    },
    strengths: [
      {
        id: 'en.vocab',
        dimension: 'VOCABULARY',
        name: '词汇',
        proficiency: 0.9,
        totalAttempts: 10,
        correctAttempts: 9,
        consecutiveErrors: 0,
        status: 'STRENGTH',
      },
    ],
    weaknesses: [
      {
        id: 'en.grammar.tense',
        dimension: 'GRAMMAR',
        name: '时态',
        proficiency: 0.3,
        totalAttempts: 10,
        correctAttempts: 3,
        consecutiveErrors: 2,
        status: 'WEAKNESS',
      },
    ],
    allMetrics: [],
    dailyTask: {
      userId: 'u1',
      activityDate: '2026-09-07',
      language: 'en',
      quizzesCount: 2,
      dailyGoalQuizzes: 5,
      cardsReviewedCount: 1,
      dailyGoalCards: 10,
      listeningMinutes: 0,
      mistakesResolvedCount: 0,
      readingCount: 3,
      isGoalCompleted: false,
      streakDays: 4,
      intensityLevel: 0,
      isOvertimeBurst: false,
      completedAt: null,
    },
    updatedAt: ASSEMBLED_AT,
  };
}

function portsWith(overrides: Partial<AnalysisSnapshotPorts> = {}): AnalysisSnapshotPorts {
  return {
    getProfileSnapshot: async () => ok(profile()),
    getDueCardsCount: async () => ok(8),
    getUnresolvedMistakesCount: async () => ok(2),
    ...overrides,
  };
}

describe('buildAnalysisSnapshot (learning use case)', () => {
  it('完整快照：证据/优劣势/每日进度/计数映射', async () => {
    const res = await buildAnalysisSnapshot(portsWith(), { userId: 'u1', assembledAt: ASSEMBLED_AT });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const s = res.value;
    expect(s.userId).toBe('u1');
    expect(s.targetLanguage).toBe('en');
    expect(s.overallLevel).toBe('未进行标准化能力评测');
    expect(s.learnerLevel).toBe('INTERMEDIATE');
    expect(s.studyGoal).toBe('CET6');
    expect(s.streakDays).toBe(4);
    expect(s.dailyGoalQuizzes).toBe(5);
    expect(s.dailyGoalCards).toBe(10);
    expect(s.strengths).toEqual([{ skillId: 'en.vocab', name: '词汇', proficiency: 0.9 }]);
    expect(s.weaknesses).toEqual([
      { skillId: 'en.grammar.tense', name: '时态', proficiency: 0.3, consecutiveErrors: 2 },
    ]);
    expect(s.dailyTask).toEqual({
      quizzesCount: 2,
      cardsReviewedCount: 1,
      readingCount: 3,
      mistakesResolvedCount: 0,
    });
    expect(s.dueCardsCount).toBe(8);
    expect(s.unresolvedMistakesCount).toBe(2);
    expect(s.assembledAt).toBe(ASSEMBLED_AT);
    expect(s.practiceEvidence?.status).toBe('unassessed');
  });

  it('profile 读取失败 → 原样返回（不回退）', async () => {
    const failure = err(new BusinessError('E_NOT_FOUND', '无画像', 'LEARNER_STATE', false));
    const res = await buildAnalysisSnapshot(
      portsWith({ getProfileSnapshot: async () => failure }),
      { userId: 'u1', assembledAt: ASSEMBLED_AT }
    );
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('E_NOT_FOUND');
  });

  it('到期卡/错题读取失败 → 计数回退 0，快照仍成功', async () => {
    const res = await buildAnalysisSnapshot(
      portsWith({
        getDueCardsCount: async () => err(new BusinessError('E_DB', '库错', 'DATABASE', true)),
        getUnresolvedMistakesCount: async () =>
          err(new BusinessError('E_DB', '库错', 'DATABASE', true)),
      }),
      { userId: 'u1', assembledAt: ASSEMBLED_AT }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.dueCardsCount).toBe(0);
    expect(res.value.unresolvedMistakesCount).toBe(0);
  });

  it('时间戳回声：assembledAt 原样采用（包内不读时钟）', async () => {
    const stamp = '2030-01-02T03:04:05.000Z';
    const res = await buildAnalysisSnapshot(portsWith(), { userId: 'u1', assembledAt: stamp });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.assembledAt).toBe(stamp);
  });
});
