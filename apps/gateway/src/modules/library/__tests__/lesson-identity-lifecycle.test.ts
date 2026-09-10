import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { DocumentItem } from '@study-studio/protocol';
import { markdownToAst } from '../application/pdf-import/markdown-to-ast.js';
import { appendPdfToDocument } from '../application/pdf-import/pdf-import-service.js';

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

describe('P1-A0 lesson id 生命周期（真实路径）', () => {
  it('reparse 同一内容：id  authority = 时间戳 bookId + 位置（无复用点）', () => {
    const a = markdownToAst(MD_V1, {});
    const b = markdownToAst(MD_V1, {});
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    // id 形状即证据：bookId 来自 Date.now() ms 精度（markdown-to-ast:255），
    // 快速连调甚至可能碰撞——同一内容两次 parse 没有任何复用旧 id 的逻辑
    for (const book of [a.value, b.value]) {
      expect(book.id).toMatch(/^pdf-[a-z0-9]+$/);
      expect(book.lessons.map((l) => l.id)).toEqual([
        `${book.id}-l1`,
        `${book.id}-l2`,
      ]);
    }
    // 语义位置一致：title/number 序列相同（变的是身份，不是内容）
    expect(a.value.lessons.map((l) => l.title)).toEqual(b.value.lessons.map((l) => l.title));
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
        getDocument: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ ...baseDoc });
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
});
