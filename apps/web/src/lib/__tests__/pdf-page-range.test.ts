import { describe, expect, test } from 'bun:test';
import { resolveOcrOverflowWindow, resolvePdfPageRange } from '../pdf-page-range.js';

describe('resolvePdfPageRange（导入页 全部/指定 两档）', () => {
  test('全部页：不带 start/end，输入框残留也不泄漏', () => {
    expect(resolvePdfPageRange('all', '', '')).toEqual({});
    expect(resolvePdfPageRange('all', '3', '12')).toEqual({});
    expect(Object.keys(resolvePdfPageRange('all', '3', '12'))).toEqual([]);
  });

  test('指定页码：两端齐了才带上', () => {
    expect(resolvePdfPageRange('range', '3', '12')).toEqual({ startPage: 3, endPage: 12 });
    expect(resolvePdfPageRange('range', ' 3 ', '12')).toEqual({ startPage: 3, endPage: 12 });
  });

  test('指定页码：缺一端即 incomplete（调用方不得发请求）', () => {
    expect(resolvePdfPageRange('range', '', '12')).toBe('incomplete-range');
    expect(resolvePdfPageRange('range', '3', '')).toBe('incomplete-range');
    expect(resolvePdfPageRange('range', '', '')).toBe('incomplete-range');
  });

  test('指定页码：非纯数字即 incomplete', () => {
    expect(resolvePdfPageRange('range', 'a', '12')).toBe('incomplete-range');
    expect(resolvePdfPageRange('range', '3', '2.5')).toBe('incomplete-range');
    expect(resolvePdfPageRange('range', '-3', '12')).toBe('incomplete-range');
  });
});

describe('resolveOcrOverflowWindow（超限切指定页码，不重试）', () => {
  const DETAILS = { pageCount: 371, suggestedStartPage: 1, suggestedEndPage: 30 };

  test('无标题时填建议窗 1–30', () => {
    expect(resolveOcrOverflowWindow(DETAILS, [], 371)).toEqual({ startPage: 1, endPage: 30 });
    expect(resolveOcrOverflowWindow(DETAILS, undefined, 371)).toEqual({ startPage: 1, endPage: 30 });
  });

  test('有标题时从第一条 heading.page 起 30 页', () => {
    expect(
      resolveOcrOverflowWindow(DETAILS, [{ page: 12 }, { page: 40 }], 371)
    ).toEqual({ startPage: 12, endPage: 41 });
  });

  test('尾部收敛：结束页不超过全书页数', () => {
    expect(resolveOcrOverflowWindow(DETAILS, [{ page: 360 }], 371)).toEqual({
      startPage: 360,
      endPage: 371,
    });
  });

  test('形状不对不切换', () => {
    expect(resolveOcrOverflowWindow(null, [], 371)).toBeNull();
    expect(resolveOcrOverflowWindow({ pageCount: 371 }, [], 371)).toBeNull();
    expect(resolveOcrOverflowWindow('boom', [], 371)).toBeNull();
  });
});
