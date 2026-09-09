import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import type { DocumentItem } from '@study-studio/protocol';

/**
 * v14 教材 shred 表：只验表结构与约束（shred 写逻辑下一轮）。
 * - 四张行表 + FTS + 知识映射表存在，主键/唯一约束生效；
 * - map 表 skill_id/entry_id 可空（未映射≠脏数据，可统计覆盖率）。
 */
describe('textbook shred schema（v14）', () => {
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  it('迁移 v14 已登记', () => {
    const rows = repo
      .getRawDb()
      .query<{ version: number }, []>('SELECT version AS version FROM schema_migrations ORDER BY version')
      .all();
    expect(rows.map((r) => r.version)).toContain(14);
  });

  it('迁移 v16 已登记：习题表 + 文法例句列', () => {
    const db = repo.getRawDb();
    const rows = db
      .query<{ version: number }, []>('SELECT version AS version FROM schema_migrations ORDER BY version')
      .all();
    expect(rows.map((r) => r.version)).toContain(16);
    // 习题表主键防重
    db.query(
      `INSERT INTO textbook_exercises (document_id, lesson_id, ord, type, prompt, answer)
       VALUES ('d1', 'l1', 0, 'CHOICE', '选读音', 'たべる')`
    ).run();
    expect(() =>
      db.query(
        `INSERT INTO textbook_exercises (document_id, lesson_id, ord, type, prompt, answer)
         VALUES ('d1', 'l1', 0, 'CHOICE', '选读音', 'たべる')`
      ).run()
    ).toThrow();
    // 存量文法行例句列默认空数组（v16 只建结构，数据随下次 shred 回填）
    db.query(
      `INSERT INTO textbook_grammar (document_id, lesson_id, ord, title) VALUES ('d1', 'l1', 0, '〜ます')`
    ).run();
    const g = db
      .query('SELECT examples_json AS examplesJson FROM textbook_grammar WHERE document_id = ?')
      .get('d1') as { examplesJson: string };
    expect(JSON.parse(g.examplesJson)).toEqual([]);
  });

  it('行表主键防重（同文档同课同序只存一行）', () => {
    const db = repo.getRawDb();
    db.query(
      `INSERT INTO textbook_lessons (document_id, lesson_id, lesson_number, title)
       VALUES ('d1', 'l1', 1, '第 1 課')`
    ).run();
    db.query(
      `INSERT INTO textbook_vocab (document_id, lesson_id, ord, surface, reading, gloss_zh)
       VALUES ('d1', 'l1', 0, '食べる', 'たべる', '吃')`
    ).run();
    expect(() =>
      db.query(
        `INSERT INTO textbook_vocab (document_id, lesson_id, ord, surface)
         VALUES ('d1', 'l1', 0, '食べる')`
      ).run()
    ).toThrow();
  });

  it('FTS 虚表可写可查', () => {
    const db = repo.getRawDb();
    db.query(
      `INSERT INTO textbook_fts (surface, reading, gloss, ja, zh, document_id, lesson_id, kind, ref)
       VALUES ('食べる', 'たべる', '吃', '', '', 'd1', 'l1', 'vocab', '食べる')`
    ).run();
    const rows = db
      .query('SELECT lesson_id AS lessonId FROM textbook_fts WHERE textbook_fts MATCH ?')
      .all('たべる') as Array<{ lessonId: string }>;
    expect(rows.map((r) => r.lessonId)).toContain('l1');
  });

  it('map 表允许空映射（未映射可统计，不算脏数据）', () => {
    const db = repo.getRawDb();
    db.query(
      `INSERT INTO textbook_term_map (document_id, lesson_id, kind, ref_text, skill_id, entry_id)
       VALUES ('d1', 'l1', 'grammar', '某文法', NULL, NULL),
              ('d1', 'l1', 'vocab', '食べる', NULL, 'n5_ja_taberu')`
    ).run();
    const unmapped = db
      .query('SELECT COUNT(*) AS n FROM textbook_term_map WHERE skill_id IS NULL AND entry_id IS NULL')
      .get() as { n: number };
    expect(unmapped.n).toBe(1);
  });

  it('结构分类存取往返（一文档一行，别人的文档拒绝）', async () => {
    const doc: DocumentItem = {
      id: 'doc_struct_1',
      userId: 'u_struct',
      title: '测试书',
      sourceKind: 'user_import',
      language: 'ja',
      content: '测试书',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await repo.saveDocument(doc);
    expect(isOk(saved)).toBe(true);
    const write = await repo.saveDocumentStructure('u_struct', 'doc_struct_1', {
      headings: [{ page: 3, text: '第3課' }],
      classes: [{ text: '第3課', page: 3, kind: 'lesson', lessonNo: '3', skillId: null }],
      model: 'mini-test',
      effort: 'low',
      dropped: 0,
    });
    expect(isOk(write)).toBe(true);
    const read = await repo.getDocumentStructure('u_struct', 'doc_struct_1');
    expect(isOk(read)).toBe(true);
    if (!isOk(read)) return;
    expect(read.value?.classes.length).toBe(1);
    expect(read.value?.model).toBe('mini-test');
    // 别人的文档拒绝
    const denied = await repo.saveDocumentStructure('intruder', 'doc_struct_1', {
      headings: [],
      classes: [],
      model: '',
      effort: '',
      dropped: 0,
    });
    expect(isOk(denied)).toBe(false);
    // 无记录返回 null
    const miss = await repo.getDocumentStructure('u_struct', 'no-such-doc');
    expect(isOk(miss)).toBe(true);
    if (!isOk(miss)) return;
    expect(miss.value).toBeNull();
  });
});
