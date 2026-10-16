import { describe, expect, it } from 'bun:test';
import {
  ContextBuilder,
  deriveRecentErrorTags,
  sanitizeSnapshotReading,
} from '../runtime/context/context-builder.js';
import type { ContextSnapshot } from '@lexdistill/agent-runtime';
import type { LearnerRepository, LearnerProfile, LearnerProfileSnapshot } from '@lexdistill/learner-core';
import type { Flashcard } from '@lexdistill/protocol';
import { ok, err, BusinessError } from '@lexdistill/shared';

function mockRepo(overrides: {
  targetLanguage?: 'ja' | 'en' | 'ko';
  overallLevel?: string;
  dueCards?: Flashcard[];
  mistakes?: Array<{
    id: string;
    question: { testedSkillId: string; category?: string };
    isResolved: boolean;
  }>;
  metrics?: Array<{ id: string; name: string; proficiency: number }>;
}): LearnerRepository {
  const targetLanguage = overrides.targetLanguage ?? 'ja';
  const overallLevel = overrides.overallLevel ?? (targetLanguage === 'en' ? 'B1' : 'N5');
  const profile: LearnerProfile = {
    userId: 'u1',
    displayName: '测',
    targetLanguage,
    overallLevel,
    studyGoal: targetLanguage === 'en' ? 'KAOYAN_EN' : 'JLPT_N5',
    learnerLevel: 'BEGINNER',
    dailyGoalQuizzes: 5,
    dailyGoalCards: 10,
    streakDays: 7,
    updatedAt: new Date().toISOString(),
  } as LearnerProfile;

  const metrics = (overrides.metrics ?? []).map((m) => ({
    id: m.id,
    dimension: 'GRAMMAR' as const,
    name: m.name,
    proficiency: m.proficiency,
    totalAttempts: 10,
    correctAttempts: 5,
    consecutiveErrors: m.proficiency < 0.6 ? 2 : 0,
    status: (m.proficiency < 0.6 ? 'WEAKNESS' : 'NORMAL') as 'WEAKNESS' | 'NORMAL' | 'STRENGTH',
  }));

  const snapshot: LearnerProfileSnapshot = {
    userId: 'u1',
    targetLanguage,
    overallLevel,
    strengths: [],
    weaknesses: metrics.filter((m) => m.status === 'WEAKNESS'),
    allMetrics: metrics,
    updatedAt: new Date().toISOString(),
  };

  return {
    getLearnerProfile: async () => ok(profile),
    updateLearnerProfile: async () => ok(profile),
    getProfileSnapshot: async () => ok(snapshot),
    getDailyTaskProgress: async () => ok({} as never),
    recordDailyActivity: async () => ok({} as never),
    saveSkillMetric: async () => ok(undefined),
    getDueCards: async () => ok(overrides.dueCards ?? []),
    saveCard: async () => ok(undefined),
    recordQuizAttempt: async () => ok(undefined),
    saveMistake: async () => ok(undefined),
    getOrCreateDailyStudyPlan: async () =>
      ok({
        id: 'plan_u1',
        userId: 'u1',
        language: targetLanguage,
        planDate: '2026-09-05',
        steps: [],
        completedCount: 0,
        totalCount: 0,
        createdAt: new Date().toISOString(),
      }),
    completeDailyPlanStep: async () =>
      ok({
        id: 'plan_u1',
        userId: 'u1',
        language: targetLanguage,
        planDate: '2026-09-05',
        steps: [],
        completedCount: 0,
        totalCount: 0,
        createdAt: new Date().toISOString(),
      }),
    getMistakes: async () =>
      ok(
        (overrides.mistakes ?? []).map((m) => ({
          id: m.id,
          userId: 'u1',
          questionId: m.id,
          question: {
            id: m.id,
            type: 'MULTIPLE_CHOICE' as const,
            content: 'q',
            correctAnswer: 'a',
            explanation: '',
            testedSkillId: m.question.testedSkillId,
            category: m.question.category,
          } as never,
          lastUserSubmission: 'x',
          lastGrading: {} as never,
          recordedAt: new Date().toISOString(),
          retryCount: 0,
          consecutiveCorrect: 0,
          isResolved: m.isResolved,
        }))
      ),
    // P5 桩：context-builder 不涉及练习计划
    savePracticePlanTemplate: async () => err(new BusinessError('E_NOT_SUPPORTED', '', 'VALIDATION')) as never,
    listPracticePlanTemplates: async () => ok([]),
    getPracticePlanTemplate: async () => ok(null),
    deletePracticePlanTemplate: async () => err(new BusinessError('E_NOT_SUPPORTED', '', 'VALIDATION')) as never,
    setPracticePlanTemplateEnabled: async () => err(new BusinessError('E_NOT_SUPPORTED', '', 'VALIDATION')) as never,
    copyPracticePlanTemplate: async () => err(new BusinessError('E_NOT_SUPPORTED', '', 'VALIDATION')) as never,
    startPracticePlanRun: async () => err(new BusinessError('E_NOT_SUPPORTED', '', 'VALIDATION')) as never,
    getPracticePlanRun: async () => ok(null),
    listPracticePlanRuns: async () => ok([]),
    savePracticeItemDraft: async () => err(new BusinessError('E_NOT_SUPPORTED', '', 'VALIDATION')) as never,
    submitPracticeItem: async () => err(new BusinessError('E_NOT_SUPPORTED', '', 'VALIDATION')) as never,
    listPracticeItemAttempts: async () => ok([]),
    getPracticeRunItems: async () => ok([]),
    finalizePracticePlanRun: async () => err(new BusinessError('E_NOT_SUPPORTED', '', 'VALIDATION')) as never,
  } as LearnerRepository;
}

describe('ContextBuilder.buildTurnSnapshot', () => {
  it('fills digest from due cards, unresolved mistakes, kana mastery, and error tags', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();

    const builder = new ContextBuilder();
    const snapshot = await builder.buildTurnSnapshot(
      'u1',
      mockRepo({
        dueCards: [
          {
            id: 'c1',
            userId: 'u1',
            type: 'VOCABULARY',
            front: 'a',
            back: 'b',
            tags: [],
            fsrs: {
              stability: 1,
              difficulty: 5,
              reps: 0,
              lapses: 0,
              state: 'NEW',
              dueAt: past,
            },
          },
          {
            id: 'c2',
            userId: 'u1',
            type: 'VOCABULARY',
            front: 'c',
            back: 'd',
            tags: [],
            fsrs: {
              stability: 1,
              difficulty: 5,
              reps: 0,
              lapses: 0,
              state: 'REVIEW',
              dueAt: future,
            },
          },
        ],
        mistakes: [
          {
            id: 'm1',
            question: { testedSkillId: 'jp.particle.ni_vs_de', category: '助词' },
            isResolved: false,
          },
          {
            id: 'm2',
            question: { testedSkillId: 'jp.listening.sokuon' },
            isResolved: false,
          },
        ],
        metrics: [
          { id: 'jp.particle.ni_vs_de', name: 'に/で', proficiency: 0.4 },
          { id: 'jp.kana.hiragana', name: '平假名', proficiency: 0.72 },
          { id: 'jp.kana.katakana', name: '片假名', proficiency: 0.55 },
        ],
      }),
      {
        ui: { activeTab: 'QUIZ' },
        focus: { kind: 'QUESTION', surface: '题干' },
        userIntentHint: 'EXPLAIN',
      }
    );

    expect(snapshot.ui?.activeTab).toBe('QUIZ');
    expect(snapshot.focus?.surface).toBe('题干');
    expect(snapshot.learnerDigest?.dueCardsCount).toBe(1);
    expect(snapshot.learnerDigest?.unresolvedMistakesCount).toBe(2);
    expect(snapshot.learnerDigest?.streakDays).toBe(7);
    expect(snapshot.learnerDigest?.practiceEvidence?.attempts).toBe(30);
    expect(snapshot.learnerDigest?.practiceEvidence?.accuracy).toBe(0.5);
    expect(snapshot.learnerDigest?.kanaMastery).toBeUndefined();
    expect(snapshot.learnerDigest?.recentErrorTags?.length).toBeGreaterThan(0);
    expect(snapshot.learnerDigest?.topWeaknesses.some((w) => w.skillId.includes('particle'))).toBe(
      true
    );
    // 不以客户端假数据覆盖 digest 计数
    expect(snapshot.learnerDigest?.unresolvedMistakesCount).not.toBe(0);
    expect(snapshot.targetLanguage).toBe('ja');
    expect(snapshot.metadata?.coachTrack).toBe('ja');
    expect(Array.isArray(snapshot.metadata?.coachHints)).toBe(true);
  });

  it('fills hangul mastery on ko track and omits kana mastery', async () => {
    const builder = new ContextBuilder();
    const snapshot = await builder.buildTurnSnapshot(
      'u1',
      mockRepo({
        targetLanguage: 'ko',
        overallLevel: 'A1',
        metrics: [
          { id: 'ko.hangul.consonant', name: '자음', proficiency: 0.8 },
          { id: 'ko.hangul.vowel', name: '모음', proficiency: 0.6 },
          { id: 'ko.hangul.compound', name: '복모음·받침', proficiency: 0.4 },
        ],
      }),
      {
        targetLanguage: 'ko',
        ui: { activeTab: 'HANGUL' },
      }
    );

    expect(snapshot.targetLanguage).toBe('ko');
    expect(snapshot.learnerDigest?.practiceEvidence?.observedSkillCount).toBe(3);
    expect(snapshot.learnerDigest?.hangulMastery).toBeUndefined();
    expect(snapshot.learnerDigest?.kanaMastery).toBeUndefined();
  });

  it('omits kana mastery and filters jp skills when track is en', async () => {
    const builder = new ContextBuilder();
    const snapshot = await builder.buildTurnSnapshot(
      'u1',
      mockRepo({
        targetLanguage: 'en',
        overallLevel: 'B1',
        mistakes: [
          {
            id: 'm1',
            question: { testedSkillId: 'jp.particle.ni_vs_de', category: '助词' },
            isResolved: false,
          },
          {
            id: 'm2',
            question: { testedSkillId: 'en.grammar.subjunctive', category: '虚拟语气' },
            isResolved: false,
          },
        ],
        metrics: [
          { id: 'jp.particle.ni_vs_de', name: 'に/で', proficiency: 0.4 },
          { id: 'en.grammar.subjunctive', name: '虚拟语气', proficiency: 0.35 },
          { id: 'jp.kana.hiragana', name: '平假名', proficiency: 0.72 },
        ],
      }),
      {
        targetLanguage: 'en',
        ui: { activeTab: 'QUIZ' },
      }
    );

    expect(snapshot.targetLanguage).toBe('en');
    expect(snapshot.metadata?.coachTrack).toBe('en');
    expect(snapshot.learnerDigest?.kanaMastery).toBeUndefined();
    expect(snapshot.learnerDigest?.topWeaknesses.every((w) => w.skillId.startsWith('en.'))).toBe(
      true
    );
  });
});

describe('deriveRecentErrorTags', () => {
  it('dedupes skill segments and categories', () => {
    const tags = deriveRecentErrorTags(
      [
        { question: { testedSkillId: 'jp.particle.ni', category: '助词' } },
        { question: { testedSkillId: 'jp.particle.de' } },
      ],
      [{ skillId: 'jp.listening.sokuon' }]
    );
    expect(tags).toContain('PARTICLE');
    expect(tags).toContain('助词');
    expect(tags).toContain('LISTENING');
  });
});

it('服务端记录阶段优先于客户端及旧 N3 标签，目标单独传递', async () => {
  const snapshot = await new ContextBuilder().buildTurnSnapshot('u1', mockRepo({ overallLevel: 'N3-' }), { learnerLevel: 'C2' });
  expect(snapshot.learnerLevel).toBe('BEGINNER');
  expect(snapshot.learnerDigest?.studyGoal).toBe('JLPT_N5');
  expect(snapshot.learnerDigest?.practiceEvidence?.accuracy).toBeNull();
});
it('异语种画像不可作为当前语种等级或计划', async () => {
  const snapshot = await new ContextBuilder().buildTurnSnapshot('u1', mockRepo({ targetLanguage: 'ja' }), { targetLanguage: 'en', learnerLevel: 'B2' });
  expect(snapshot.learnerLevel).toBe('UNKNOWN');
  expect(snapshot.learnerDigest?.dailyPlanRemaining).toBeUndefined();
});

describe('sanitizeSnapshotReading (P3-3)', () => {
  const base: ContextSnapshot = {
    targetLanguage: 'ja',
    learnerLevel: 'BEGINNER',
  };
  // 最小验证面 fake（结构化类型，非完整门面）。
  const fakeRepo = (
    docs: Record<string, { userId: string; sourceKind: string }>,
    segs: Record<string, string[]>
  ) => ({
    getDocumentById: async (id: string) => {
      const d = docs[id];
      return ok(d ? { userId: d.userId, sourceKind: d.sourceKind } : null);
    },
    listContentSegments: async (documentId: string) =>
      ok((segs[documentId] ?? []).map((id) => ({ id }))),
  });

  it('可见 focus 保留（含段归属一致）', async () => {
    const repo = fakeRepo({ dA: { userId: 'u1', sourceKind: 'user_import' } }, { dA: ['seg1'] });
    const out = await sanitizeSnapshotReading(repo, 'u1', {
      ...base,
      focus: { kind: 'READING_PASSAGE', surface: '第一段', documentId: 'dA', segmentId: 'seg1' },
    });
    expect(out.focus).toEqual({
      kind: 'READING_PASSAGE',
      surface: '第一段',
      documentId: 'dA',
      segmentId: 'seg1',
    });
  });

  it('不可见 focus 丢弃整段且 turn 字段其余不变', async () => {
    const repo = fakeRepo({ dA: { userId: 'uA', sourceKind: 'user_import' } }, { dA: ['seg1'] });
    const out = await sanitizeSnapshotReading(
      repo,
      'uB',
      {
        ...base,
        focus: { kind: 'READING_PASSAGE', surface: '偷看', documentId: 'dA' },
        selectedWord: 'w',
      }
    );
    expect(out.focus).toBeUndefined();
    // turn 继续：快照其余字段完整。
    expect(out.targetLanguage).toBe('ja');
    expect(out.selectedWord).toBe('w');
  });

  it('segment 缺失／无 documentId／幽灵文档一律丢弃', async () => {
    const repo = fakeRepo({ dA: { userId: 'u1', sourceKind: 'user_import' } }, { dA: ['seg1'] });
    const missSeg = await sanitizeSnapshotReading(repo, 'u1', {
      ...base,
      focus: { kind: 'READING_PASSAGE', surface: 'x', documentId: 'dA', segmentId: 'segX' },
    });
    expect(missSeg.focus).toBeUndefined();
    const noDoc = await sanitizeSnapshotReading(repo, 'u1', {
      ...base,
      focus: { kind: 'READING_PASSAGE', surface: 'x', segmentId: 'seg1' },
    });
    expect(noDoc.focus).toBeUndefined();
    const ghost = await sanitizeSnapshotReading(repo, 'u1', {
      ...base,
      focus: { kind: 'READING_PASSAGE', surface: 'x', documentId: 'ghost' },
    });
    expect(ghost.focus).toBeUndefined();
  });

  it('截断及旧请求兼容：超长截断，无 focus 原样，非归属 focus 仅截断', async () => {
    const repo = fakeRepo({}, {});
    const long = '字'.repeat(600);
    const out = await sanitizeSnapshotReading(repo, 'u1', {
      ...base,
      focus: { kind: 'QUESTION', surface: long },
      selectedWord: '词'.repeat(300),
    });
    expect(out.focus?.surface.length).toBe(500);
    expect(out.focus?.kind).toBe('QUESTION');
    expect(out.selectedWord?.length).toBe(200);
    // 旧请求（无 focus、无超长）形状不变。
    const legacy = await sanitizeSnapshotReading(repo, 'u1', { ...base });
    expect(legacy.focus).toBeUndefined();
    expect(legacy.targetLanguage).toBe('ja');
  });

  it('窄仓储回退透传（mock LearnerRepository 无验证面不断 turn）', async () => {
    const out = await sanitizeSnapshotReading(mockRepo({}), 'u1', {
      ...base,
      focus: { kind: 'READING_PASSAGE', surface: 'x', documentId: 'dA' },
    });
    expect(out.focus?.documentId).toBe('dA');
  });
});
