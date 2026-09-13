import { describe, expect, it } from 'bun:test';
import { getMorphAnalyzer } from '../index.js';

/**
 * M5-1 三语形态注册表路由 + 门控（随 morphology.ts 从网关迁移，断言逐字保留）。
 */
describe('morphology registry', () => {
  it('三语路由 + 门控', () => {
    expect(getMorphAnalyzer('ja')?.verb).toBe('活用自');
    expect(getMorphAnalyzer('en')?.verb).toBe('还原为');
    expect(getMorphAnalyzer('ko')?.verb).toBe('活用自');
    expect(getMorphAnalyzer('ja')?.supports('食べた')).toBe(true);
    expect(getMorphAnalyzer('ja')?.supports('hello')).toBe(false);
    expect(getMorphAnalyzer('en')?.supports('runs')).toBe(true);
    expect(getMorphAnalyzer('ko')?.supports('먹어요')).toBe(true);
    expect(getMorphAnalyzer('ko')?.supports('hello')).toBe(false);
  });
});
