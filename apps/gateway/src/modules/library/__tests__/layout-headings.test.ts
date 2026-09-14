import { describe, expect, test } from 'bun:test';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { collectLayoutCandidates } from '../application/pdf-import/layout-headings.js';

/**
 * M8-6：纯规则单测已迁入 `@study-studio/content`（src/pdf）；
 * 本文件只保留 collectLayoutCandidates 的异常降级、空结果与运行时收窄行为。
 */

/** 原生层无类型保证：假实现故意返回脏数据，断言采集侧能收窄（仅测试用转型）。 */
function fakeInspector(methods: Record<string, unknown>): PdfInspectorLike {
  return {
    processPdf: () => ({}),
    processPdfWithOcr: async () => ({}),
    ...methods,
  } as unknown as PdfInspectorLike;
}

describe('collectLayoutCandidates', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  test('无版式接口时返回空（老实现静默降级）', () => {
    const inspector = fakeInspector({});
    expect(collectLayoutCandidates(inspector, pdf, [1])).toEqual([]);
  });

  test('接口抛错时返回空（不影响主流程）', () => {
    const inspector = fakeInspector({
      extractTextWithPositions: () => {
        throw new Error('native boom');
      },
    });
    expect(collectLayoutCandidates(inspector, pdf, [1])).toEqual([]);
  });

  test('脏条目被收窄丢弃，好条目成候选', () => {
    const body = 'これはとてもながいほんぶんのぎょうですよ';
    const inspector = fakeInspector({
      extractTextWithPositions: () => [
        { text: '第3課', page: 5, x: 200, y: 80, width: 60, height: 18, fontSize: 18, isBold: true },
        { text: body, page: 5, x: 60, y: 200, width: 400, height: 10, fontSize: 10, isBold: false },
        { text: body, page: 5, x: 60, y: 214, width: 400, height: 10, fontSize: 10, isBold: false },
        { text: body, page: 5, x: 60, y: 228, width: 400, height: 10, fontSize: 10, isBold: false },
        null,
        { text: '坏条目', page: 'x' },
        'string junk',
      ],
    });
    const cands = collectLayoutCandidates(inspector, pdf, [5]);
    expect(cands.length).toBe(1);
    expect(cands[0]).toMatchObject({ page: 5, text: '第3課', bold: true });
  });
});
