import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk, isErr } from '@lexdistill/shared';
import type { TextbookAST } from '@lexdistill/document-model';
import { runDoctor } from '@lexdistill/storage-sqlite';
import { validateTocEntries } from '@lexdistill/content';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';

/**
 * OCR+LLM 之后 فرض：底稿是格式干净的 TextbookAST。
 * 本文件测两条轨道：
 * A. 干净输入 → 派生全链一次写齐（shred 行 + FTS + 段投影 + 知识点），doctor 全绿；
 * B. 脏输入 → 在目录核对处直接报错（AST 门 / 层级门），零写。
 */
const BOOK: TextbookAST = {
  id: 'derived_book',
  title: '派生测试书',
  shortTitle: '派生',
  level: 'N5',
  language: 'JA',
  lessons: [
    {
      id: 'dl1',
      lessonNumber: 1,
      title: '第1課',
      vocabularies: [
        { id: 'dl1-v1', kanji: '食べる', kana: 'たべる', pos: '动词', pitchAccent: '②', chinese: '吃' },
      ],
      grammarPoints: [
        {
          id: 'dl1-g1',
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

function docBase(id: string) {
  return {
    id,
    userId: 'default_user',
    title: '派生测试书',
    sourceKind: 'curriculum_textbook' as const,
    language: 'ja',
    content: '派生测试书',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  };
}

describe('A. 干净输入派生全链', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('落库→shred 行→FTS→段投影→知识点→doctor 全绿', async () => {
    const saved = await repo.saveCanonicalAst(docBase('derived_doc'), BOOK);
    expect(isOk(saved)).toBe(true);
    if (!isOk(saved)) return;

    // shred 行面
    const db = repo.getRawDb();
    const count = (table: string): number =>
      (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id = ?`).get('derived_doc') as { n: number }).n;
    expect(db.query("SELECT json_array_length(chapters_json) AS n FROM documents WHERE id='derived_doc'").get()).toEqual({n:1});
    expect(count('textbook_vocabulary')).toBe(1);
    expect(count('textbook_knowledge')).toBe(1);
    expect(count('textbook_sentences')).toBe(2);

    // FTS 可查（词面 + 对话）
    const fts = db
      .query('SELECT lesson_id AS lessonId FROM textbook_fts WHERE textbook_fts MATCH ? AND document_id = ?')
      .all('たべる', 'derived_doc') as Array<{ lessonId: string }>;
    expect(fts.map((r) => r.lessonId)).toContain('dl1');

    // 段投影（2 句对话 → 2 段）
    const projected = await repo.projectLinesSegments('default_user', 'derived_doc');
    expect(isOk(projected)).toBe(true);
    if (!isOk(projected)) return;
    expect(projected.value.inserted).toBe(2);
    const segs = await repo.listContentSegments('derived_doc');
    expect(isOk(segs)).toBe(true);
    if (!isOk(segs)) return;
    expect(segs.value).toHaveLength(2);

    // 知识点挂目录（悬空合法）
    const kp = await repo.saveKnowledgePoints({
      documentId: 'derived_doc',
      lessonId: 'dl1',
      points: [{ concept: 'ます形', kind: 'grammar_ref', explanationMd: '礼貌体' }],
    });
    expect(isOk(kp)).toBe(true);
    const listed = await repo.listKnowledgePoints('derived_doc', 'dl1');
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.map((p) => p.concept)).toEqual(['ます形']);

    // doctor 全绿（派生一致，无孤儿）
    const report = runDoctor(db);
    expect(report.errors).toEqual([]);
  });
});

describe('B. 脏输入在目录核对处报错', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('AST 缺必填段 → E_INVALID_TEXTBOOK_AST，零写', async () => {
    const bad = {
      id: 'bad_book',
      title: '坏书',
      shortTitle: '坏',
      level: 'N5',
      language: 'JA',
      lessons: [{ id: 'bad_l1', lessonNumber: 1, title: '第1課', dialogues: [], exercises: [] }],
    };
    const res = await repo.saveCanonicalAst(docBase('bad_doc'), bad as never);
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_TEXTBOOK_AST');
    const got = await repo.getDocumentById('bad_doc');
    expect(isOk(got) && got.value).toBe(null);
  });

  it('目录缺层级/跳级 → issues 定位，preview 拒绝', async () => {
    const missing = validateTocEntries([
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' },
      { title: '第2課', printedPage: 30, kind: 'lesson' },
    ]);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.issues).toMatchObject([{ index: 1, field: 'level' }]);

    const jump = validateTocEntries([
      { title: '第一章', printedPage: 10, level: 0, kind: 'section' },
      { title: '第1課', printedPage: 12, level: 2, kind: 'lesson' },
    ]);
    expect(jump.ok).toBe(false);
    if (jump.ok) return;
    expect(jump.issues[0]).toMatchObject({ index: 1, field: 'level' });
  });
});
