import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { TextbookAST } from '@study-studio/protocol';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { tryParseTextbookAst } from '../persistence/textbook-shred.js';

/**
 * shred 写逻辑：AST 大绳拆关系行（同事务全删全插，天然幂等）。
 * - 行/词/文法/FTS 行数对齐；term_map 只记精确匹配（命中记 entry，未命中记 NULL）；
 * - skill_id v1 恒 NULL；坏 AST 由 tryParseTextbookAst 挡掉，shred 不接。
 */
const BOOK: TextbookAST = {
  id: 'book1',
  title: '测试教材',
  shortTitle: '测试',
  level: 'N5',
  language: 'JA',
  lessons: [
    {
      id: 'l1',
      lessonNumber: 1,
      title: '第1課',
      exercises: [
        {
          id: 'ex1',
          type: 'CHOICE',
          prompt: '「食べる」的正确读音是？',
          options: ['たべる', 'のむ', 'みる'],
          answer: 'たべる',
          explanation: '食べる读たべる',
        },
        { id: 'ex2', type: 'FILL_BLANK', prompt: 'ご飯を＿＿。', answer: '食べる' },
      ],
      vocabularies: [
        {
          id: 'v1',
          kanji: '食べる',
          kana: 'たべる',
          pos: '动词',
          pitchAccent: '②',
          chinese: '吃',
          example: { japanese: 'ご飯を食べる', chinese: '吃饭' },
        },
        {
          id: 'v2',
          kanji: '架空語',
          kana: 'かくうご',
          pos: '名词',
          pitchAccent: '？',
          chinese: '不存在的词',
        },
      ],
      grammarPoints: [
        { id: 'g1', title: '〜ます', connection: '动词连用形', explanation: '礼貌体', examples: [{ japanese: '食べます', chinese: '吃' }] },
      ],
      dialogues: [
        { speaker: 'A', japanese: 'おはよう', chinese: '早上好' },
        { speaker: 'B', japanese: 'おはようございます', chinese: '早上好（郑重）' },
      ],
    },
  ],
};

describe('textbook shred 写逻辑', () => {
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    // N5 种子已含 食べる（精确匹配走种子，不另插，避免 id 冲突）
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  it('拆行/FTS/精确映射一次写齐', async () => {
    const res = await repo.shredDocument('d1', BOOK);
    if (!isOk(res)) throw new Error(`shred failed: ${res.error.code}`);
    expect(res.value).toMatchObject({ lessons: 1, vocab: 2, grammar: 1, lines: 2, exercises: 2 });
    const db = repo.getRawDb();
    const fts = db
      .query('SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id = ?')
      .get('d1') as { n: number };
    expect(fts.n).toBe(4); // 2 词 + 2 行
    const hit = db
      .query("SELECT entry_id AS entryId FROM textbook_term_map WHERE ref_text = '食べる'")
      .get() as { entryId: string | null };
    expect(typeof hit.entryId).toBe('string');
    const miss = db
      .query("SELECT entry_id AS entryId FROM textbook_term_map WHERE ref_text = '架空語'")
      .get() as { entryId: string | null };
    expect(miss.entryId).toBeNull();
    expect(res.value.mappedEntries).toBe(1);
    expect(res.value.unmapped).toBe(2); // 架空語 + 〜ます
    // FTS 真能查到
    const rows = db
      .query('SELECT lesson_id AS lessonId FROM textbook_fts WHERE textbook_fts MATCH ?')
      .all('たべる') as Array<{ lessonId: string }>;
    expect(rows.map((r) => r.lessonId)).toContain('l1');
    // v16：习题拆行 + 文法例句落列
    const exRows = db
      .query(
        'SELECT type AS type, prompt AS prompt, options_json AS optionsJson, answer AS answer FROM textbook_exercises WHERE document_id = ? ORDER BY ord'
      )
      .all('d1') as Array<{ type: string; prompt: string; optionsJson: string; answer: string }>;
    expect(exRows).toHaveLength(2);
    expect(exRows[0]).toMatchObject({ type: 'CHOICE', answer: 'たべる' });
    expect(JSON.parse(exRows[0]?.optionsJson ?? '[]')).toEqual(['たべる', 'のむ', 'みる']);
    expect(exRows[1]).toMatchObject({ type: 'FILL_BLANK', answer: '食べる' });
    const gRow = db
      .query('SELECT examples_json AS examplesJson FROM textbook_grammar WHERE document_id = ?')
      .get('d1') as { examplesJson: string };
    expect(JSON.parse(gRow.examplesJson)).toEqual([{ japanese: '食べます', chinese: '吃' }]);
  });

  it('重跑全删全插（幂等，不翻倍）', async () => {
    const first = await repo.shredDocument('d1', BOOK);
    if (!isOk(first)) throw new Error('first shred failed');
    const second = await repo.shredDocument('d1', BOOK);
    if (!isOk(second)) throw new Error('second shred failed');
    const db = repo.getRawDb();
    const n = db
      .query('SELECT COUNT(*) AS n FROM textbook_vocab WHERE document_id = ?')
      .get('d1') as { n: number };
    expect(n.n).toBe(2);
    expect(second.value).toMatchObject({ lessons: 1, vocab: 2, exercises: 2 });
    const ne = db
      .query('SELECT COUNT(*) AS n FROM textbook_exercises WHERE document_id = ?')
      .get('d1') as { n: number };
    expect(ne.n).toBe(2);
  });

  it('tryParseTextbookAst 挡坏输入（读侧永不抛）', () => {
    expect(tryParseTextbookAst('not json{{')).toBeNull();
    expect(tryParseTextbookAst({ nope: 1 })).toBeNull();
    expect(tryParseTextbookAst(JSON.stringify(BOOK))?.lessons.length).toBe(1);
    expect(tryParseTextbookAst(BOOK)?.id).toBe('book1');
  });

  it('P1-B：gap AST 的 sort_order 按数组 index 连续，lesson_number 保持 legacy', async () => {
    const gapBook: TextbookAST = {
      ...BOOK,
      id: 'gap-book',
      lessons: [15, 16, 18, 20].map((n, i) => ({
        id: `g-l${i + 1}`,
        lessonNumber: n,
        title: `第${n}課`,
        vocabularies: [],
        grammarPoints: [],
        dialogues: [{ speaker: 'A', japanese: 'こんにちは。', chinese: '' }],
        exercises: [],
      })),
    };
    const res = await repo.shredDocument('gap-doc', gapBook);
    if (!isOk(res)) throw new Error(`gap shred failed: ${res.error.code}`);
    const db = repo.getRawDb();
    const rows = db
      .query(
        'SELECT lesson_id AS lessonId, lesson_number AS lessonNumber, sort_order AS sortOrder FROM textbook_lessons WHERE document_id = ? ORDER BY sort_order'
      )
      .all('gap-doc') as Array<{ lessonId: string; lessonNumber: number; sortOrder: number }>;
    // lessonNumber 有 gap 但合法保留；sort_order 必须 1-based 连续
    expect(rows.map((r) => r.lessonNumber)).toEqual([15, 16, 18, 20]);
    expect(rows.map((r) => r.sortOrder)).toEqual([1, 2, 3, 4]);
    expect(rows[2]).toMatchObject({ lessonId: 'g-l3', lessonNumber: 18, sortOrder: 3 });
  });
});
