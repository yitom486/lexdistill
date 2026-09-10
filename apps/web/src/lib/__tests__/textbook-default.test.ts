import { describe, expect, test } from 'bun:test';
import { pickDefaultTextbook, targetLanguageToFilter } from '../textbook-default.js';

const BOOKS = [
  { id: 'nce-primary-1', language: 'EN', title: '新概念英语' },
  { id: 'minna-1', language: 'JA', title: '大家的日语' },
  { id: 'hyojun-1', language: 'JA', title: '标准日本语' },
];

describe('pickDefaultTextbook', () => {
  test('JA 轨道默认第一本日语书（不是 EN 第一本）', () => {
    expect(pickDefaultTextbook(BOOKS, 'JA')?.id).toBe('minna-1');
  });

  test('ALL 仍是第一本', () => {
    expect(pickDefaultTextbook(BOOKS, 'ALL')?.id).toBe('nce-primary-1');
  });

  test('该语种无书时回退第一本；空单 undefined', () => {
    expect(pickDefaultTextbook(BOOKS, 'KO')?.id).toBe('nce-primary-1');
    expect(pickDefaultTextbook([], 'JA')).toBeUndefined();
  });

  test('缺 language 按 JA 计', () => {
    const books = [{ id: 'x' }, { id: 'y', language: 'EN' }];
    expect(pickDefaultTextbook(books, 'JA')?.id).toBe('x');
  });
});

describe('targetLanguageToFilter', () => {
  test('ja/en/ko 各归其档，未知回退 JA', () => {
    expect(targetLanguageToFilter('ja')).toBe('JA');
    expect(targetLanguageToFilter('en')).toBe('EN');
    expect(targetLanguageToFilter('ko')).toBe('KO');
    expect(targetLanguageToFilter('')).toBe('JA');
  });
});
