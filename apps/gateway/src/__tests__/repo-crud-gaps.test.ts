import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk, isErr } from '@study-studio/shared';
import type { GeneratedQuestion, QuizGradingResult } from '@study-studio/protocol';
import type { TextbookAST } from '@study-studio/document-model';
import { createMistakeEntry } from '@study-studio/learner-core';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';

/**
 * 门面 CRUD 缺口回填（覆盖映射 126 方法中 10 个无直调项）。
 * 全部 :memory: 真仓储 round-trip；断言 Result 语义与守卫拒绝，不碰网络与真实文件。
 */

function makeQuestion(id: string): GeneratedQuestion {
  return {
    id,
    type: 'MULTIPLE_CHOICE',
    prompt: 'p',
    content: 'c',
    correctAnswer: 'a',
    explanation: 'e',
    testedSkillId: 'jp.test',
    difficultyTier: 2,
  };
}

function makeGrading(questionId: string): QuizGradingResult {
  return {
    questionId,
    isCorrect: false,
    score: 20,
    correctAnswer: 'a',
    userSubmission: 'x',
    explanation: 'e',
    mistakeRecorded: false,
  };
}

describe('错题解决闭环（save→get→resolve）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('resolve 后 resolved/unresolved 两边视图一致；未知 id 报 E_NOT_FOUND', async () => {
    const mistake = createMistakeEntry('u_mst', makeQuestion('mq1'), 'sub', makeGrading('mq1'));
    expect(isOk(await repo.saveMistake(mistake))).toBe(true);

    const open = await repo.getMistakes('u_mst', { resolved: false });
    expect(isOk(open)).toBe(true);
    if (!isOk(open)) return;
    expect(open.value.map((m) => m.id)).toContain(mistake.id);

    expect(isOk(await repo.resolveMistake(mistake.id))).toBe(true);

    const stillOpen = await repo.getMistakes('u_mst', { resolved: false });
    expect(isOk(stillOpen)).toBe(true);
    if (!isOk(stillOpen)) return;
    expect(stillOpen.value.map((m) => m.id)).not.toContain(mistake.id);

    const done = await repo.getMistakes('u_mst', { resolved: true });
    expect(isOk(done)).toBe(true);
    if (!isOk(done)) return;
    expect(done.value.map((m) => m.id)).toContain(mistake.id);

    const missing = await repo.resolveMistake('mst_missing');
    expect(isErr(missing)).toBe(true);
    if (!isErr(missing)) return;
    expect(missing.error.code).toBe('E_NOT_FOUND');
  });
});

describe('定级考 run 读口（start→is/get/count）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('未交卷前 count 为 0；未知 run 返回 false/null', async () => {
    // 定级考开考有前置门（档位 + 字母量），与 level.test.ts 同口径准备。
    expect(
      isOk(await repo.updateLearnerProfile('u_place', { targetLanguage: 'ja', learnerLevel: 'NOVICE' }))
    ).toBe(true);
    for (let i = 0; i < 15; i++) {
      await repo.recordKanaPractice('u_place', `gap_kana_${i}`, true, 'HIRAGANA');
    }
    const started = await repo.startPlacementExam('u_place', 'ja', 'BEGINNER');
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;

    expect(repo.isPlacementRun(started.value.runId)).toBe(true);
    expect(repo.isPlacementRun('run_missing')).toBe(false);

    const got = await repo.getPlacementByRunId(started.value.runId);
    expect(got?.id).toBe(started.value.exam.id);
    expect(await repo.getPlacementByRunId('run_missing')).toBeNull();

    // 未交卷：终结计数为 0（交卷语义由 level.test.ts 覆盖）。
    expect(await repo.countPlacementAttempts('u_place', 'BEGINNER')).toBe(0);
  });
});

describe('活动历史回读', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('recordDailyActivity 当日行可在 getActivityHistory 中找到', async () => {
    expect(isOk(await repo.recordDailyActivity('u_hist', { quizzes: 2, cards: 3 }))).toBe(true);
    const history = await repo.getActivityHistory('u_hist', 28);
    expect(isOk(history)).toBe(true);
    if (!isOk(history)) return;
    expect(history.value.some((h) => h.quizzesCount >= 2 && h.cardsReviewedCount >= 3)).toBe(true);
  });
});

describe('题库批量写入', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('saveQuestions 批量落库后 getQuestions 可回读', async () => {
    const batch = [makeQuestion('bq1'), makeQuestion('bq2'), makeQuestion('bq3')].map((q) => ({
      ...q,
      userId: 'u_batch',
      // 防串语过滤按 skill 前缀判定语种：写读同用 ja 分区。
      language: 'ja',
    }));
    expect(isOk(await repo.saveQuestions(batch))).toBe(true);
    const got = await repo.getQuestions('u_batch', 50, 'ja');
    expect(isOk(got)).toBe(true);
    if (!isOk(got)) return;
    for (const id of ['bq1', 'bq2', 'bq3']) {
      expect(got.value.map((q) => q.id)).toContain(id);
    }
  });
});

describe('AI 运行审计（只插不改 + 用户隔离）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  const base = {
    action: 'grade',
    inputSnapshot: 'snap',
    adapter: 'codex',
    model: 'm',
    promptVersion: 'p1',
    schemaVersion: 's1',
    status: 'completed' as const,
  };

  it('写入后按 user 精确回读；他用户不可见；空 userId 双向拒绝', async () => {
    const recorded = await repo.recordAiArtifactRun({ ...base, userId: 'u_audit' });
    expect(isOk(recorded)).toBe(true);
    if (!isOk(recorded)) return;
    expect(recorded.value.action).toBe('grade');

    const mine = await repo.listAiArtifactRuns({ userId: 'u_audit' });
    expect(isOk(mine)).toBe(true);
    if (!isOk(mine)) return;
    expect(mine.value.map((r) => r.id)).toContain(recorded.value.id);

    const others = await repo.listAiArtifactRuns({ userId: 'u_other' });
    expect(isOk(others)).toBe(true);
    if (!isOk(others)) return;
    expect(others.value).toEqual([]);

    expect(isErr(await repo.recordAiArtifactRun({ ...base, userId: '  ' }))).toBe(true);
    expect(isErr(await repo.listAiArtifactRuns({ userId: '' }))).toBe(true);
  });
});

describe('练习收集入库', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('collectPracticeQuestions 落集合+条目，可经 list 回读', async () => {
    const res = await repo.collectPracticeQuestions({
      userId: 'u_collect',
      title: 't',
      questions: [makeQuestion('cq1'), makeQuestion('cq2')],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.collection.id).toBeTruthy();
    expect(res.value.items).toHaveLength(2);

    const cols = await repo.listPracticeCollections('u_collect');
    expect(isOk(cols)).toBe(true);
    if (!isOk(cols)) return;
    expect(cols.value.map((c) => c.id)).toContain(res.value.collection.id);
  });
});

const SEG_BOOK: TextbookAST = {
  id: 'seg_book',
  title: '段测试书',
  shortTitle: '段测',
  level: 'N5',
  language: 'JA',
  lessons: [
    {
      id: 'seg_l1',
      lessonNumber: 1,
      title: '第1課',
      vocabularies: [
        { id: 'seg_v1', kanji: '食べる', kana: 'たべる', pos: '动词', pitchAccent: '②', chinese: '吃' },
      ],
      grammarPoints: [
        {
          id: 'seg_g1',
          title: '〜ます',
          connection: '动词连用形',
          explanation: '礼貌体',
          examples: [{ japanese: '食べます', chinese: '吃' }],
        },
      ],
      dialogues: [
        { speaker: 'A', japanese: 'おはよう', chinese: '早上好' },
        { speaker: 'B', japanese: 'こんにちは', chinese: '中午好' },
      ],
      exercises: [],
    },
  ],
};

describe('派生表三件套（缺口查询→lines 投影→列段）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('shred 落 lines 后可投影为 segments，且幂等', async () => {
    // 标准写入路径：canonical AST 落库 + shred 同一事务（派生表永不手写）。
    const saved = await repo.saveCanonicalAst(
      {
        id: 'seg_doc',
        userId: 'default_user',
        title: '段测试书',
        sourceKind: 'curriculum_textbook',
        language: 'ja',
        content: '段测试书',
        createdAt: '2026-09-24T00:00:00.000Z',
        updatedAt: '2026-09-24T00:00:00.000Z',
      },
      SEG_BOOK
    );
    expect(isOk(saved)).toBe(true);
    if (!isOk(saved)) return;

    // 投影前：缺口查询检出本文档。
    const missingBefore = await repo.findDocumentsMissingLineSegments();
    expect(isOk(missingBefore)).toBe(true);
    if (!isOk(missingBefore)) return;
    expect(missingBefore.value.map((m) => m.id)).toContain('seg_doc');

    // 投影前列段为空（只读不触发写入）。
    const empty = await repo.listContentSegments('seg_doc');
    expect(isOk(empty)).toBe(true);
    if (!isOk(empty)) return;
    expect(empty.value).toEqual([]);

    // 投影：2 句对话落 2 段。
    const projected = await repo.projectLinesSegments('default_user', 'seg_doc');
    expect(isOk(projected)).toBe(true);
    if (!isOk(projected)) return;
    expect(projected.value.inserted).toBe(2);

    const segs = await repo.listContentSegments('seg_doc');
    expect(isOk(segs)).toBe(true);
    if (!isOk(segs)) return;
    expect(segs.value.map((s) => s.text).sort()).toEqual(['おはよう', 'こんにちは'].sort());

    // 投影后缺口消失；二次投影零重复。
    const missingAfter = await repo.findDocumentsMissingLineSegments();
    expect(isOk(missingAfter)).toBe(true);
    if (!isOk(missingAfter)) return;
    expect(missingAfter.value.map((m) => m.id)).not.toContain('seg_doc');

    const again = await repo.projectLinesSegments('default_user', 'seg_doc');
    expect(isOk(again)).toBe(true);
    if (!isOk(again)) return;
    expect(again.value.inserted).toBe(0);

    // 不可见/不存在的文档拒绝。
    expect(isErr(await repo.projectLinesSegments('default_user', 'doc_missing'))).toBe(true);
  });
});

describe('文档课引用（阅读游标派生）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('多用户游标 lessonId 去重汇总；空文档返回空；空 id 拒绝', async () => {
    expect(
      isOk(await repo.saveReadingPosition('u_lr1', 'doc_lr', { lessonId: 'l1', offset: 5 }))
    ).toBe(true);
    expect(
      isOk(await repo.saveReadingPosition('u_lr2', 'doc_lr', { lessonId: 'l2', offset: 1 }))
    ).toBe(true);
    // 同一用户重存覆盖，不重复计数。
    expect(
      isOk(await repo.saveReadingPosition('u_lr1', 'doc_lr', { lessonId: 'l1', offset: 9 }))
    ).toBe(true);

    const refs = await repo.listDocumentLessonRefs('doc_lr');
    expect(isOk(refs)).toBe(true);
    if (!isOk(refs)) return;
    expect(refs.value.sort()).toEqual(['l1', 'l2']);

    const none = await repo.listDocumentLessonRefs('doc_empty');
    expect(isOk(none)).toBe(true);
    if (!isOk(none)) return;
    expect(none.value).toEqual([]);

    expect(isErr(await repo.listDocumentLessonRefs('  '))).toBe(true);
  });
});
