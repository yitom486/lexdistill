import { describe, expect, it } from 'bun:test';
import { getWordUsageList, selectVocabularyForCard } from '../vocabulary.js';
import type { VocabularyEntry } from '@study-studio/protocol';

const entry = (id: string, word: string): VocabularyEntry => ({
  id, word, reading: '', language: 'ja', meaning: word, level: null, collected: false, sources: [],
});

describe('selectVocabularyForCard', () => {
  const list = [entry('v1', '学校'), entry('v2', '先生')];
  it('id 精确命中优先于同词', () => {
    expect(selectVocabularyForCard(list, { vocabularyId: 'v2', surface: '学校' })?.id).toBe('v2');
    expect(selectVocabularyForCard(list, { entryId: 'v1', surface: '先生' })?.id).toBe('v1');
  });
  it('无 id 时同词兜底；全 miss 返回 undefined（调用方合成）', () => {
    expect(selectVocabularyForCard(list, { surface: '先生' })?.id).toBe('v2');
    expect(selectVocabularyForCard(list, { vocabularyId: 'vx', surface: '猫' })).toBeUndefined();
    expect(selectVocabularyForCard([], { surface: '学校' })).toBeUndefined();
  });
});

describe('getWordUsageList', () => {
  it('contextNote＋usage 去重保序，空值跳过', () => {
    expect(getWordUsageList([
      { contextNote: '上学', usage: '通学' },
      { contextNote: '上学', usage: undefined },
      { contextNote: undefined, usage: '通学' },
    ])).toEqual(['上学', '通学']);
    expect(getWordUsageList([])).toEqual([]);
  });
});
