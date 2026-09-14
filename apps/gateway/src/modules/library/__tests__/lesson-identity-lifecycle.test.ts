import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { DocumentItem } from '@study-studio/protocol';
import { markdownToAst } from '@study-studio/content';
import { appendPdfToDocument } from '../application/pdf-import/pdf-import-service.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';

/**
 * P1-A0 lesson id 生命周期回归（真实代码路径，非合成复刻）。
 * 锁定事实：
 * - 每次 parse 全新 id（bookId 时间戳）；同 bookId + 同分组 → id 确定性重现；
 * - 同 bookId 下前置插入/删除 → 后续 id 移位（positional drift，真 parser）；
 * - relay append：base id 全保留，新课取新 AST id；
 * - shred：透传 id（P1-B 已覆盖，此处只锁 append→AST 段）。
 * 不修改生产 identity，只做 characterization。
 */
const MD_V1 = ['# 第1課', 'A：はじめまして。', '# 第2課', 'B：さようなら。'].join('\n');
const MD_V2_INSERT = ['# 第1課', 'A：はじめまして。', '# 復習A', 'R：ふくしゅう。', '# 第2課', 'B：さようなら。'].join('\n');
const MD_V2_DELETE = ['# 第2課', 'B：さようなら。'].join('\n');

function stubMarkdownInspector(markdown: string) {
  return async () => ({
    processPdf: () => ({ pdfType: 'TextBased', pageCount: 2, markdown, pagesNeedingOcr: [], confidence: 0.9 }),
    processPdfWithOcr: async () => ({ markdown: null, pagesRoutedToOcr: [], pagesRecommendingHosted: [] }),
  });
}
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function testDoc(astJson: string): DocumentItem {
  return {
    id: 'doc1',
    userId: 'u1',
    title: 'Base',
    sourceKind: 'user_import' as const,
    language: 'ja',
    content: 'Base',
    astJson,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

describe('P1-A0 lesson id 生命周期（真实路径）', () => {
  it('reparse 同一内容：id  authority = 时间戳 bookId + 位置（无复用点）', () => {
    const a = markdownToAst(MD_V1, {});
    const b = markdownToAst(MD_V1, {});
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    // id 形状即证据：bookId = 时间戳 + 进程计数器 + 随机（markdown-to-ast:newProvisionalBookId），
    // 同内容连续 parse 不再可能碰撞；旧 `pdf-<纯时间戳>` 形状仍被前缀兼容
    for (const book of [a.value, b.value]) {
      expect(book.id).toMatch(/^pdf-[a-z0-9-]+$/);
      expect(book.lessons.map((l) => l.id)).toEqual([
        `${book.id}-l1`,
        `${book.id}-l2`,
      ]);
    }
    expect(a.value.id).not.toBe(b.value.id);
    expect(a.value.lessons.map((l) => l.id)).not.toEqual(b.value.lessons.map((l) => l.id));
    // 语义位置一致：title/number 序列相同（变的是身份，不是内容）
    expect(a.value.lessons.map((l) => l.title)).toEqual(b.value.lessons.map((l) => l.title));
  });

  it('provisional id 永不碰撞：200 次连调 bookId/lessonId 全唯一（计数器保证）', () => {
    const bookIds = new Set<string>();
    const lessonIds = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = markdownToAst(MD_V1, {});
      expect(isOk(r)).toBe(true);
      if (!isOk(r)) return;
      bookIds.add(r.value.id);
      for (const l of r.value.lessons) lessonIds.add(l.id);
    }
    expect(bookIds.size).toBe(200);
    expect(lessonIds.size).toBe(400);
  });

  it('同 bookId + 同分组 → id 确定性重现（positional 纯函数）', () => {
    const a = markdownToAst(MD_V1, { bookId: 'doc' });
    const b = markdownToAst(MD_V1, { bookId: 'doc' });
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(a.value.lessons.map((l) => l.id)).toEqual(['doc-l1', 'doc-l2']);
    expect(b.value.lessons.map((l) => l.id)).toEqual(['doc-l1', 'doc-l2']);
  });

  it('同 bookId 前置插入復習A：l2 从第2課漂移到復習A（真 parser drift）', () => {
    const before = markdownToAst(MD_V1, { bookId: 'doc' });
    const after = markdownToAst(MD_V2_INSERT, { bookId: 'doc' });
    expect(isOk(before) && isOk(after)).toBe(true);
    if (!isOk(before) || !isOk(after)) return;
    const byId = (ls: typeof after.value.lessons, id: string) => ls.find((l) => l.id === id)?.title;
    expect(byId(before.value.lessons, 'doc-l2')).toContain('第2課');
    expect(byId(after.value.lessons, 'doc-l2')).toContain('復習A');
    expect(byId(after.value.lessons, 'doc-l3')).toContain('第2課');
  });

  it('同 bookId 删除前置课：第2課从 l2 前移到 l1', () => {
    const before = markdownToAst(MD_V1, { bookId: 'doc' });
    const after = markdownToAst(MD_V2_DELETE, { bookId: 'doc' });
    expect(isOk(before) && isOk(after)).toBe(true);
    if (!isOk(before) || !isOk(after)) return;
    expect(after.value.lessons.map((l) => l.id)).toEqual(['doc-l1']);
    expect(after.value.lessons[0]?.title).toContain('第2課');
  });

  it('relay append：base id 全保留，新课 id 来自新 AST 且不撞', async () => {
    const base = markdownToAst(MD_V1, { bookId: 'doc' });
    expect(isOk(base)).toBe(true);
    if (!isOk(base)) return;
    const baseDoc: DocumentItem = {
      id: 'doc1',
      userId: 'u1',
      title: 'Base',
      sourceKind: 'user_import' as const,
      language: 'ja',
      content: 'Base',
      astJson: JSON.stringify(base.value),
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    let saved = baseDoc;
    const res = await appendPdfToDocument(
      {
        saveDocument: async (doc: typeof baseDoc) => {
          saved = doc;
          const { ok } = await import('@study-studio/shared');
          return ok(doc);
        },
        // 显式 atomic fake（内存实现：与 canonical 写同语义，astJson 内部生成）
        saveCanonicalAst: async (docBase, book) => {
          saved = { ...docBase, astJson: JSON.stringify(book) } as typeof baseDoc;
          const { ok } = await import('@study-studio/shared');
          return ok(saved);
        },
        getDocument: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ ...baseDoc });
        },
        projectLinesSegments: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ inserted: 0, skipped: 0 });
        },
        loadInspector: stubMarkdownInspector(MD_V2_DELETE),
      },
      { userId: 'u1', filename: 'part2.pdf', bytes: PDF_HEAD, documentId: 'doc1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const merged = JSON.parse(saved.astJson as string) as { lessons: Array<{ id: string; title: string }> };
    // base 两课 id 原样保留
    expect(merged.lessons[0]?.id).toBe('doc-l1');
    expect(merged.lessons[1]?.id).toBe('doc-l2');
    // 新课 id 来自新 parse（时间戳前缀），与旧 id 不撞
    expect(merged.lessons[2]?.id).not.toBe('doc-l3');
    expect(merged.lessons[2]?.id).toMatch(/^pdf-/);
  });

  it('原子 append：AST 与 shred 同成功，derived sort_order 连续', async () => {
    const base = markdownToAst(MD_V1, { bookId: 'doc' });
    expect(isOk(base)).toBe(true);
    if (!isOk(base)) return;
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const baseDoc = testDoc(JSON.stringify(base.value));
    expect(isOk(await repo.saveDocument(baseDoc))).toBe(true);
    expect(isOk(await repo.shredDocument('doc1', base.value))).toBe(true);
    const res = await appendPdfToDocument(
      {
        saveDocument: (doc) => repo.saveDocument(doc),
        saveCanonicalAst: (docBase, book) => repo.saveCanonicalAst(docBase, book),
        getDocument: (id) => repo.getDocumentById(id),
        projectLinesSegments: (userId, documentId) => repo.projectLinesSegments(userId, documentId),
        loadInspector: stubMarkdownInspector(MD_V2_DELETE),
      },
      { userId: 'u1', filename: 'part2.pdf', bytes: PDF_HEAD, documentId: 'doc1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.totalLessons).toBe(3);
    const rows = repo.getRawDb().query(
      'SELECT sort_order AS s FROM textbook_lessons WHERE document_id = ? ORDER BY sort_order'
    ).all('doc1') as Array<{ s: number }>;
    expect(rows.map((r) => r.s)).toEqual([1, 2, 3]);
  });

  it('原子回滚：shred 失败则 AST 也不更新（无双源漂移）', async () => {
    const base = markdownToAst(MD_V1, { bookId: 'doc' });
    expect(isOk(base)).toBe(true);
    if (!isOk(base)) return;
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const before = testDoc(JSON.stringify(base.value));
    expect(isOk(await repo.saveDocument(before))).toBe(true);
    expect(isOk(await repo.shredDocument('doc1', base.value))).toBe(true);
    // 破坏 shred 必经表，模拟 shred 失败
    repo.getRawDb().run('DROP TABLE textbook_lines');
    const next = markdownToAst(MD_V2_INSERT, { bookId: 'doc' });
    expect(isOk(next)).toBe(true);
    if (!isOk(next)) return;
    const { astJson: _beforeJson, ...beforeBase } = before;
    void _beforeJson;
    const res = await repo.saveCanonicalAst(beforeBase, next.value);
    expect(isOk(res)).toBe(false);
    // AST 原样 + derived 原样：没有任何部分写入
    const got = await repo.getDocumentById('doc1');
    expect(isOk(got)).toBe(true);
    if (!isOk(got) || !got.value?.astJson) return;
    expect(JSON.parse(got.value?.astJson as string)).toMatchObject({ id: 'doc' });
    expect((JSON.parse(got.value?.astJson as string) as { lessons: unknown[] }).lessons).toHaveLength(2);
    const n = repo.getRawDb().query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get('doc1') as { n: number };
    expect(n.n).toBe(2);
  });

  it('大声失败：原子保存 err 则 append 直接 err，不吞成 WARN', async () => {    const base = markdownToAst(MD_V1, { bookId: 'doc' });
    expect(isOk(base)).toBe(true);
    if (!isOk(base)) return;
    const baseDoc = testDoc(JSON.stringify(base.value));
    const { err, BusinessError } = await import('@study-studio/shared');
    const res = await appendPdfToDocument(
      {
        saveDocument: async (doc) => {
          const { ok } = await import('@study-studio/shared');
          return ok(doc);
        },
        saveCanonicalAst: async () =>
          err(new BusinessError('E_INTERNAL', 'shred 失败（测试注入）', 'DATABASE', true)),
        getDocument: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ ...baseDoc });
        },
        projectLinesSegments: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ inserted: 0, skipped: 0 });
        },
        loadInspector: stubMarkdownInspector(MD_V2_DELETE),
      },
      { userId: 'u1', filename: 'part2.pdf', bytes: PDF_HEAD, documentId: 'doc1' }
    );
    expect(isOk(res)).toBe(false);
  });

  it('无退化：append 只走 saveCanonicalAst，旧 saveDocument 不被调用', async () => {
    const base = markdownToAst(MD_V1, { bookId: 'doc' });
    expect(isOk(base)).toBe(true);
    if (!isOk(base)) return;
    const baseDoc = testDoc(JSON.stringify(base.value));
    let plainSaves = 0;
    const res = await appendPdfToDocument(
      {
        saveDocument: async (doc) => {
          plainSaves++;
          const { ok } = await import('@study-studio/shared');
          return ok(doc);
        },
        saveCanonicalAst: async (docBase, book) => {
          const { ok } = await import('@study-studio/shared');
          return ok({ ...docBase, astJson: JSON.stringify(book) } as typeof baseDoc);
        },
        getDocument: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ ...baseDoc });
        },
        projectLinesSegments: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ inserted: 0, skipped: 0 });
        },
        loadInspector: stubMarkdownInspector(MD_V2_DELETE),
      },
      { userId: 'u1', filename: 'part2.pdf', bytes: PDF_HEAD, documentId: 'doc1' }
    );
    expect(isOk(res)).toBe(true);
    expect(plainSaves).toBe(0);
  });

  it('单源：落库存的 astJson 必等于内部验证后的 book（调用方无第二份 canonical）', async () => {
    const book = markdownToAst(MD_V1, { bookId: 'doc' });
    expect(isOk(book)).toBe(true);
    if (!isOk(book)) return;
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const { astJson: _drop, ...noAst } = testDoc('{}');
    void _drop;
    const res = await repo.saveCanonicalAst(noAst, book.value);
    expect(isOk(res)).toBe(true);
    const got = await repo.getDocumentById('doc1');
    expect(isOk(got)).toBe(true);
    if (!isOk(got)) return;
    const stored = JSON.parse(got.value?.astJson as string) as { lessons: Array<{ id: string }> };
    expect(stored.lessons.map((l) => l.id)).toEqual(['doc-l1', 'doc-l2']);
  });
});
