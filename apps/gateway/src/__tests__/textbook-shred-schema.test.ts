import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import type { DocumentItem } from '@lexdistill/protocol';

/**
 * v14/v30 教材 shred 表：只验表结构与约束（shred 写逻辑下一轮）。
 * - 五张行表 + FTS + 知识点表存在，主键/唯一约束生效；
 * - v30：term_map 退役，knowledge_points 可悬空原文（source_refs_json 默认为空数组）。
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

  it('knowledge_points 表结构（v30 目录挂载蒸馏点，默认可悬空）', () => {
    const db = repo.getRawDb();
    db.query(
      `INSERT INTO knowledge_points (id, document_id, lesson_id, concept, created_at, updated_at)
       VALUES ('kp1', 'd1', 'l1', 'に vs で', 't', 't')`
    ).run();
    const row = db
      .query('SELECT kind AS kind, ord AS ord, explanation_md AS explanationMd, source_refs_json AS sourceRefsJson FROM knowledge_points WHERE id = ?')
      .get('kp1') as { kind: string; ord: number; explanationMd: string; sourceRefsJson: string };
    expect(row.kind).toBe('concept');
    expect(row.ord).toBe(0);
    expect(row.explanationMd).toBe('');
    expect(JSON.parse(row.sourceRefsJson)).toEqual([]);
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
