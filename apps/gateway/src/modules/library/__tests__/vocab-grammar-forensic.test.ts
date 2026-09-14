import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { markdownToAst } from '@study-studio/content';
import {
  groundGrammarsForTest,
  groundVocabsForTest,
} from './vocab-grammar-forensic-helpers.js';
import { appendPdfToDocument } from '../application/pdf-import/pdf-import-service.js';
import { TEXTBOOK_BOOKS } from '@study-studio/storage-sqlite';

/**
 * P1-D0 Vocab/Grammar Identity 取证（只调查不迁移）。
 * 约束：不新增 vocab_id/grammar_id/ref_id，不改 term_map/locator/lesson identity/schema，
 * 不写真实库（全 :memory:），不进 UI。
 * 结论前置（各单测分别锁定）：
 * - 唯一生成点 = enrich 接地（groundVocabularies/groundGrammarPoints），格式 `${lessonId}-v/g${kept序号}`；
 * - seed 为手写静态 `v1-1` 形，与 PDF 动态形不同源；
 * - shred 丢弃 AST id，行身份 = (document_id, lesson_id, ord)，FTS ref 亦为位置派生；
 * - term_map ref_text = 面字符串精确匹配桥，非 identity；同课同面直接整单失败；
 * - 下游 durable 资产零依赖 vocab/grammar id（见代码审计，测试只锁行身份与字符串键）。
 */

const MD_V1 = ['# 第1課', 'A：はじめまして。', '# 第2課', 'B：さようなら。'].join('\n');
const MD_V1_INSERT_FRONT = ['# 復習A', 'R：ふくしゅう。', '# 第1課', 'A：はじめまして。', '# 第2課', 'B：さようなら。'].join('\n');
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function stubInspector(markdown: string) {
  return async () => ({
    processPdf: () => ({ pdfType: 'TextBased', pageCount: 1, markdown, pagesNeedingOcr: [], confidence: 0.9 }),
    processPdfWithOcr: async () => ({ markdown: null, pagesRoutedToOcr: [], pagesRecommendingHosted: [] }),
  });
}

describe('P1-D0 取证：生成点与重复稳定性', () => {
  it('同输入重复 parse：同 bookId 则 lesson id 确定性一致，vocab 恒为空（parse 不产词 id）', () => {
    const a = markdownToAst(MD_V1, { bookId: 'doc' });
    const b = markdownToAst(MD_V1, { bookId: 'doc' });
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(a.value.lessons.map((l) => l.id)).toEqual(['doc-l1', 'doc-l2']);
    expect(b.value.lessons.map((l) => l.id)).toEqual(['doc-l1', 'doc-l2']);
    expect(a.value.lessons.every((l) => l.vocabularies.length === 0 && l.grammarPoints.length === 0)).toBe(true);
  });

  it('同输入重复 grounding：同 lessonId 则 id 完全一致；换 lessonId 则前缀整体改变', () => {
    const first = groundVocabsForTest(['食べる', '飲む'], 'l1');
    const second = groundVocabsForTest(['食べる', '飲む'], 'l1');
    expect(first.map((v) => v.id)).toEqual(['l1-v1', 'l1-v2']);
    expect(second.map((v) => v.id)).toEqual(['l1-v1', 'l1-v2']);
    const other = groundVocabsForTest(['食べる', '飲む'], 'l9');
    expect(other.map((v) => v.id)).toEqual(['l9-v1', 'l9-v2']);
    const g = groundGrammarsForTest(['〜ます'], 'l1');
    expect(g.map((x) => x.id)).toEqual(['l1-g1']);
  });

  it('课前插入：lesson id 位置性移位（后继课 id 改变，vocab 作用域随之迁移）', () => {
    const before = markdownToAst(MD_V1, { bookId: 'doc' });
    const after = markdownToAst(MD_V1_INSERT_FRONT, { bookId: 'doc' });
    expect(isOk(before) && isOk(after)).toBe(true);
    if (!isOk(before) || !isOk(after)) return;
    expect(before.value.lessons.map((l) => l.id)).toEqual(['doc-l1', 'doc-l2']);
    expect(after.value.lessons.map((l) => l.id)).toEqual(['doc-l1', 'doc-l2', 'doc-l3']);
    // 旧第1課内容被挤到 l2：positional drift，vocab id 前缀 `${lessonId}-v` 必然跟随迁移
    expect(after.value.lessons[1]?.title).toContain('第1課');
    expect(after.value.lessons[0]?.title).toContain('復習');
  });

  it('课内词条增删改序/filter-drop：id 跟 kept 位置不跟内容，模型自带 id 永不采用', () => {
    const base = groundVocabsForTest(['食べる', '飲む'], 'l1');
    expect(base.map((v) => [v.kanji, v.id])).toEqual([['食べる', 'l1-v1'], ['飲む', 'l1-v2']]);
    const frontInsert = groundVocabsForTest(['会う', '食べる', '飲む'], 'l1', 'ご飯を食べる。水を飲む。先生に会う。');
    expect(frontInsert.map((v) => [v.kanji, v.id])).toEqual([
      ['会う', 'l1-v1'],
      ['食べる', 'l1-v2'],
      ['飲む', 'l1-v3'],
    ]);
    const reordered = groundVocabsForTest(['飲む', '食べる'], 'l1');
    expect(reordered.map((v) => [v.kanji, v.id])).toEqual([['飲む', 'l1-v1'], ['食べる', 'l1-v2']]);
  });
});

describe('P1-D0 取证：append 与 enrich 语义', () => {
  it('append：既有课 vocab ids 逐字保留（合并数组原样透传）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const baseAst = {
      id: 'doc', language: 'JA', title: 'B', shortTitle: 'B',
      lessons: [
        {
          id: 'doc-l1', lessonNumber: 1, title: '第1課',
          vocabularies: [{ id: 'doc-l1-v1', kanji: '食べる', kana: 'たべる', chinese: '吃' }],
          grammarPoints: [{ id: 'doc-l1-g1', title: '〜ます', connection: '接续', explanation: '说明', examples: [{ japanese: '食べます。', chinese: '吃。' }] }],
          dialogues: [{ speaker: 'A', japanese: 'ご飯を食べる。', chinese: '' }],
          exercises: [],
        },
      ],
    };
    const baseDoc = {
      id: 'doc1', userId: 'u1', title: 'B', sourceKind: 'user_import' as const, language: 'ja',
      content: 'Base', astJson: JSON.stringify(baseAst), createdAt: 'x', updatedAt: 'x',
    };
    let savedAst = '';
    const res = await appendPdfToDocument(
      {
        saveDocument: async (doc) => {
          const { ok } = await import('@study-studio/shared');
          return ok(doc);
        },
        saveCanonicalAst: async (docBase, book) => {
          savedAst = JSON.stringify(book);
          const { ok } = await import('@study-studio/shared');
          return ok({ ...docBase, astJson: savedAst } as typeof baseDoc);
        },
        getDocument: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ ...baseDoc });
        },
        projectLinesSegments: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ inserted: 0, skipped: 0 });
        },
        loadInspector: stubInspector('# 第2課\nB：さようなら。'),
      },
      { userId: 'u1', filename: 'p2.pdf', bytes: PDF_HEAD, documentId: 'doc1' }
    );
    expect(isOk(res)).toBe(true);
    const merged = JSON.parse(savedAst) as { lessons: Array<{ id: string; vocabularies: Array<{ id: string }>; grammarPoints: Array<{ id: string }> }> };
    expect(merged.lessons[0]?.vocabularies.map((v) => v.id)).toEqual(['doc-l1-v1']);
    expect(merged.lessons[0]?.grammarPoints.map((g) => g.id)).toEqual(['doc-l1-g1']);
  });

  it('enrich：重跑即按新 kept 顺序重编 id，同词面可变 id（无保留逻辑）', () => {
    const first = groundVocabsForTest(['食べる', '飲む'], 'l1');
    const second = groundVocabsForTest(['飲む', '行く'], 'l1', '水を飲む。学校へ行く。先生に会う。ご飯を食べる。');
    expect(first.find((v) => v.kanji === '飲む')?.id).toBe('l1-v2');
    expect(second.find((v) => v.kanji === '飲む')?.id).toBe('l1-v1');
  });
});

describe('P1-D0 取证：AST→shred 行身份与 term_map', () => {
  it('shred 表无 vocab_id/grammar_id 列；行身份=(document_id,lesson_id,ord)', () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const vocabCols = repo.getRawDb().query('PRAGMA table_info("textbook_vocab")').all() as Array<{ name: string }>;
    const grammarCols = repo.getRawDb().query('PRAGMA table_info("textbook_grammar")').all() as Array<{ name: string }>;
    const vocabNames = vocabCols.map((c) => c.name);
    const grammarNames = grammarCols.map((c) => c.name);
    for (const banned of ['vocab_id', 'grammar_id', 'ref_id', 'vid', 'gid']) {
      expect(vocabNames).not.toContain(banned);
      expect(grammarNames).not.toContain(banned);
    }
    expect(vocabNames).toEqual(expect.arrayContaining(['document_id', 'lesson_id', 'ord', 'surface']));
    expect(grammarNames).toEqual(expect.arrayContaining(['document_id', 'lesson_id', 'ord', 'title']));
  });

  it('AST→shred 一一映射：顺序/surface 透传、id 丢弃、FTS ref 为位置派生', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const book = {
      id: 'b1', language: 'JA', title: 'B', shortTitle: 'B',
      lessons: [
        {
          id: 'l1', lessonNumber: 1, title: '第1課',
          vocabularies: [
            { id: 'l1-v1', kanji: '食べる', kana: 'たべる', chinese: '吃' },
            { id: 'l1-v2', kanji: '飲む', kana: 'のむ', chinese: '喝' },
          ],
          grammarPoints: [{ id: 'l1-g1', title: '〜ます', connection: '接续', explanation: '说明', examples: [{ japanese: '食べます。', chinese: '吃。' }] }],
          dialogues: [{ speaker: 'A', japanese: 'ご飯を食べる。', chinese: '' }],
          exercises: [],
        },
      ],
    };
    const docBase = { id: 'd1', userId: 'u1', title: 'B', sourceKind: 'user_import' as const, language: 'ja', content: 'c', createdAt: 'x', updatedAt: 'x' };
    const saved = await repo.saveCanonicalAst(docBase, book as never);
    expect(isOk(saved)).toBe(true);
    const rows = repo.getRawDb().query('SELECT lesson_id AS l, ord AS o, surface AS s FROM textbook_vocab WHERE document_id=? ORDER BY ord').all('d1') as Array<{ l: string; o: number; s: string }>;
    expect(rows).toEqual([{ l: 'l1', o: 0, s: '食べる' }, { l: 'l1', o: 1, s: '飲む' }]);
    const fts = repo.getRawDb().query("SELECT ref FROM textbook_fts WHERE document_id=? AND kind='vocab' ORDER BY ref").all('d1') as Array<{ ref: string }>;
    expect(fts.map((r) => r.ref).sort()).toEqual(['l1#v0', 'l1#v1']);
    const maps = repo.getRawDb().query('SELECT kind, ref_text AS t FROM textbook_term_map WHERE document_id=? ORDER BY ref_text').all('d1') as Array<{ kind: string; t: string }>;
    expect(maps).toContainEqual({ kind: 'vocab', t: '食べる' });
    expect(maps).toContainEqual({ kind: 'grammar', t: '〜ます' });
  });

  it('同课同面：P1-D1 去重后 shred 成功；occurrence 全保留，term_map 仅首条（best-effort 桥）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const book = {
      id: 'b1', language: 'JA', title: 'B', shortTitle: 'B',
      lessons: [
        {
          id: 'l1', lessonNumber: 1, title: 't1',
          vocabularies: [
            { id: 'l1-v1', kanji: '食べる', kana: 'たべる', chinese: '吃' },
            { id: 'l1-v2', kanji: '食べる', kana: 'たべる', chinese: '吃（重复面）' },
          ],
          grammarPoints: [],
          dialogues: [{ speaker: 'A', japanese: 'ご飯を食べる。', chinese: '' }],
          exercises: [],
        },
      ],
    };
    const docBase = { id: 'd1', userId: 'u1', title: 'B', sourceKind: 'user_import' as const, language: 'ja', content: 'c', createdAt: 'x', updatedAt: 'x' };
    const res = await repo.saveCanonicalAst(docBase, book as never);
    expect(isOk(res)).toBe(true);
    const v = repo.getRawDb().query('SELECT ord AS o, surface AS s FROM textbook_vocab WHERE document_id=? ORDER BY ord').all('d1') as Array<{ o: number; s: string }>;
    expect(v).toEqual([{ o: 0, s: '食べる' }, { o: 1, s: '食べる' }]);
    const m = repo.getRawDb().query("SELECT COUNT(*) AS n FROM textbook_term_map WHERE document_id=? AND kind='vocab'").get('d1') as { n: number };
    expect(m.n).toBe(1);
  });

  it('跨课同面：允许落库（PK 含 lesson_id），但字符串键天然歧义', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const book = {
      id: 'b1', language: 'JA', title: 'B', shortTitle: 'B',
      lessons: [
        { id: 'l1', lessonNumber: 1, title: 't1', vocabularies: [{ id: 'l1-v1', kanji: '社員', kana: 'しゃいん', chinese: '职员' }], grammarPoints: [], dialogues: [{ speaker: 'A', japanese: '社員です。', chinese: '' }], exercises: [] },
        { id: 'l2', lessonNumber: 2, title: 't2', vocabularies: [{ id: 'l2-v1', kanji: '社員', kana: 'しゃいん', chinese: '职员' }], grammarPoints: [], dialogues: [{ speaker: 'A', japanese: '社員です。', chinese: '' }], exercises: [] },
      ],
    };
    const docBase = { id: 'd1', userId: 'u1', title: 'B', sourceKind: 'user_import' as const, language: 'ja', content: 'c', createdAt: 'x', updatedAt: 'x' };
    expect(isOk(await repo.saveCanonicalAst(docBase, book as never))).toBe(true);
    const maps = repo.getRawDb().query("SELECT lesson_id AS l, ref_text AS t FROM textbook_term_map WHERE document_id=? AND kind='vocab' ORDER BY lesson_id").all('d1') as Array<{ l: string; t: string }>;
    expect(maps).toEqual([{ l: 'l1', t: '社員' }, { l: 'l2', t: '社員' }]);
  });
});

describe('P1-D0 取证：seed 与 PDF parser 差异', () => {
  it('seed 为手写静态 id（v1-1 形，不嵌入 lessonId），与 PDF 动态形不同源', () => {
    const seedBook = TEXTBOOK_BOOKS[0];
    expect(seedBook).toBeDefined();
    if (!seedBook) return;
    const firstLesson = (seedBook.lessons as unknown[])[0] as Record<string, unknown>;
    const vocabs = firstLesson.vocabularies as Array<Record<string, unknown>>;
    expect(vocabs.length).toBeGreaterThan(0);
    const seedVid = String(vocabs[0]?.id ?? '');
    const lessonId = String(firstLesson.id ?? '');
    expect(seedVid).toMatch(/^v\d+-/);
    expect(seedVid.startsWith(lessonId + '-v')).toBe(false);
    const pdfIds = groundVocabsForTest(['食べる'], 'pdf-x-l1').map((v) => v.id);
    expect(pdfIds).toEqual(['pdf-x-l1-v1']);
  });

  it('seed repair 只改文法键名不碰 vocab/grammar id（同对象 id 逐字保留）', async () => {
    const { migrateGrammarForTest } = await import('./vocab-grammar-forensic-helpers.js');
    const legacy = { id: 'g1', title: '〜ます', structure: '接续', explanation: '说明', examples: [{ ja: '食べます。', zh: '吃。' }] };
    const { item, migrated } = migrateGrammarForTest(legacy);
    expect(migrated).toBe(true);
    expect(item.id).toBe('g1');
    expect(item.connection).toBe('接续');
    expect('structure' in item).toBe(false);
  });
});
