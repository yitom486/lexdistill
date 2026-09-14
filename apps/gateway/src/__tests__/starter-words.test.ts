import { describe, expect, it, beforeEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningContentTool } from '../transport/tools/learning-content-tool.js';
import { STARTER_WORD_SEEDS } from '@study-studio/storage-sqlite';
import { isOk } from '@study-studio/shared';

describe('starter word pack (out-of-box vocabulary)', () => {
  let repo: DrizzleLearnerRepository;
  let tool: LearningContentTool;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    tool = new LearningContentTool(repo);
  });

  it('seeds 24 ja + 24 ko + 24 en starter words with traceable source', () => {
    expect(STARTER_WORD_SEEDS.filter((w) => w.language === 'ja').length).toBe(24);
    expect(STARTER_WORD_SEEDS.filter((w) => w.language === 'ko').length).toBe(24);
    expect(STARTER_WORD_SEEDS.filter((w) => w.language === 'en').length).toBe(24);
    const jaCount = repo
      .getRawDb()
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM local_dictionary_entries WHERE id LIKE 'starter_ja_%'"
      )
      .get()?.count;
    const koCount = repo
      .getRawDb()
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM local_dictionary_entries WHERE id LIKE 'starter_ko_%'"
      )
      .get()?.count;
    expect(jaCount).toBe(24);
    expect(koCount).toBe(24);
    const enCount = repo
      .getRawDb()
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM local_dictionary_entries WHERE id LIKE 'starter_en_%'"
      )
      .get()?.count;
    expect(enCount).toBe(24);
  });

  it('en starter words are lookable out of the box（入门可查可收）', async () => {
    const res = await repo.searchLocalDictionary('en', 'water');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.some((e) => e.id === 'starter_en_water')).toBe(true);
    const collected = await repo.collectDictionaryEntry('u_starter_en', 'starter_en_water');
    expect(isOk(collected)).toBe(true);
  });

  it('中文反查：用中文含义找英文词（释义 FTS，无需英文包之外的东西）', async () => {
    const res = await repo.searchLocalDictionary('en', '水');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.some((e) => e.id === 'starter_en_water')).toBe(true);
    // 查不到的中文如实为空，不编造
    const miss = await repo.searchLocalDictionary('en', '含糊');
    expect(isOk(miss)).toBe(true);
    if (!isOk(miss)) return;
    expect(miss.value).toEqual([]);
  });

  it('powers kana word drills without any installed package', async () => {
    const res = await tool.execute(
      { action: 'generate_kana_words', count: 5, language: 'ja' },
      { userId: 'u_starter_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.kanaWords?.length).toBeGreaterThan(0);
    // 全体合法（假名读音 + 有释义）；N5 包加入后随机抽样不再保证首屏必含开箱词，
    // “开箱词在池中”改由下面确定性断言覆盖（随机种子不可控，不做概率断言）。
    for (const w of res.value.kanaWords ?? []) {
      expect(w.kana).toMatch(/^[\u3040-\u30FFー・\s]+$/);
      expect(w.meanings.length).toBeGreaterThan(0);
    }
    const pool = await repo.sampleLocalDictionaryEntries('ja', 500);
    expect(isOk(pool)).toBe(true);
    if (!isOk(pool)) return;
    expect(pool.value.some((e) => e.id.startsWith('starter_ja_'))).toBe(true);
  });

  it('powers hangul word drills without any installed package', async () => {
    const res = await tool.execute(
      { action: 'generate_hangul_words', count: 5, language: 'ko' },
      { userId: 'u_starter_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.hangulWords?.length).toBeGreaterThan(0);
    for (const w of res.value.hangulWords ?? []) {
      expect(w.entryId.startsWith('starter_ko_')).toBe(true);
      expect(w.sourceLabel).toBe('开箱词包');
    }
  });
});
