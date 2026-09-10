import { describe, expect, test } from 'bun:test';
import { resolvePdfPageRange } from '../pdf-page-range.js';

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
