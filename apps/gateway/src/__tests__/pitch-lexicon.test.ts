import { describe, expect, it } from 'bun:test';
import {
  PITCH_LEXICON,
  extractPitchQueryTokens,
  lookupPitchEntries,
  tryPitchLexiconCoachReply,
} from '@study-studio/storage-sqlite';
import { buildOjadSearchUrl } from '../modules/dictionary/application/dictionary-external-links.js';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { DictionaryLookupTool } from '../modules/dictionary/tools/dictionary-lookup-tool.js';
import { app } from '../index.js';
import { isOk } from '@study-studio/shared';

describe('pitch lexicon coach', () => {
  it('has at least 10 benchmark entries', () => {
    expect(PITCH_LEXICON.length).toBeGreaterThanOrEqual(10);
  });

  it('looks up classic minimal pairs by kanji', () => {
    const rain = lookupPitchEntries('雨');
    expect(rain.some((e) => e.id === 'p1')).toBe(true);
    const flower = lookupPitchEntries('花');
    expect(flower.some((e) => e.kanji === '花')).toBe(true);
  });

  it('extracts quoted and kana tokens from a natural prompt', () => {
    const tokens = extractPitchQueryTokens('「橋」と はし の声调怎么读？');
    expect(tokens).toContain('橋');
    expect(tokens).toContain('はし');
  });

  it('formats a curriculum-backed reply for pitch questions', () => {
    const reply = tryPitchLexiconCoachReply('「雨」的声调怎么读？');
    expect(reply).toBeTruthy();
    expect(reply!).toContain('课程声调词表');
    expect(reply!).toContain('雨');
    expect(reply!).toContain('头高型');
  });

  it('returns null for non-pitch prompts', () => {
    expect(tryPitchLexiconCoachReply('今天天气怎么样')).toBeNull();
  });

  it('seeds curriculum entries into the local SQLite dictionary', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const result = await repo.searchLocalDictionary('ja', '雨');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value[0]?.headword).toBe('雨');
    expect(result.value[0]?.sourceLabel).toBe('Lingua Studio curriculum seed');
  });

  it('seeds dictionary glosses without circular headword echo', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const result = await repo.searchLocalDictionary('ja', '学生');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const seedEntry = result.value.find((e) => e.sourceLabel === 'Lingua Studio curriculum seed');
    expect(seedEntry).toBeDefined();
    // 「学生 (Student)」标签入库时取英文 gloss，避免头词循环定义
    expect(seedEntry?.meanings).toEqual(['Student']);
  });

  it('only provides an OJAD deep link for a Japanese local-dictionary miss', async () => {
    const hit = await app.request('/api/dictionary/ja?q=%E9%9B%A8');
    expect(hit.status).toBe(200);
    const hitBody = await hit.json();
    const hitEntries = hitBody.entries as Array<{ headword?: string; sourceLabel?: string }>;
    // N5 核心词与课程声调种子并存（不同 source，互不覆盖；排序仍声调种子优先）
    expect(hitEntries.some((e) => e.headword === '雨')).toBe(true);
    expect(hitEntries.length).toBeGreaterThanOrEqual(2);
    expect(hitBody.externalLookup).toBeUndefined();

    const miss = await app.request('/api/dictionary/ja?q=%E7%81%AB%E6%98%9F%E8%AA%9E');
    const missBody = await miss.json();
    expect(miss.status).toBe(200);
    expect(missBody.entries).toHaveLength(0);
    expect(missBody.externalLookup?.provider).toBe('OJAD');
    expect(missBody.externalLookup?.url).toBe(buildOjadSearchUrl('火星語'));

    const englishMiss = await app.request('/api/dictionary/en?q=unlisted');
    const englishBody = await englishMiss.json();
    expect(englishBody.externalLookup).toBeUndefined();
  });

  it('exposes the same compliant dictionary lookup to an Agent tool', async () => {
    const tool = new DictionaryLookupTool(new DrizzleLearnerRepository(':memory:'));
    const hit = await tool.execute(
      { language: 'ja', query: '雨' },
      { userId: 'tool_test_user', sessionId: 'tool_test_session' }
    );
    expect(isOk(hit)).toBe(true);
    if (!isOk(hit)) return;
    expect(hit.value.entries[0]?.headword).toBe('雨');
    expect(hit.value.externalLookup).toBeUndefined();

    const miss = await tool.execute(
      { language: 'ja', query: '火星語' },
      { userId: 'tool_test_user', sessionId: 'tool_test_session' }
    );
    expect(isOk(miss)).toBe(true);
    if (!isOk(miss)) return;
    expect(miss.value.entries).toHaveLength(0);
    expect(miss.value.externalLookup?.provider).toBe('OJAD');
    expect(miss.value.externalLookup?.url).toBe(buildOjadSearchUrl('火星語'));
  });

  it('lists the English dictionary as an explicit on-demand package', async () => {
    const response = await app.request('/api/dictionary/packages');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.packages).toContainEqual(
      expect.objectContaining({
        id: 'oewn-2025',
        language: 'en',
        installMode: 'on_demand',
        licenseName: 'CC BY 4.0',
      })
    );
  });

  it('collects a local dictionary entry as one deduplicated FSRS card', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const first = await repo.collectDictionaryEntry('dictionary_test_user', 'ja_pitch_p1');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.created).toBe(true);
    expect(first.value.card.front).toBe('雨');
    expect(first.value.card.fsrs.state).toBe('NEW');

    const second = await repo.collectDictionaryEntry('dictionary_test_user', 'ja_pitch_p1');
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.created).toBe(false);
    expect(second.value.card.id).toBe(first.value.card.id);
  });
});
