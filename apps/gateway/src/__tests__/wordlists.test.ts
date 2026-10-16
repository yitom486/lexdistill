import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';

/** 零基础单词表：开箱词包 + N5 核心，叠加已收/已学透态（给带路第 3 天供数）。 */
describe('wordlists（零基础单词表）', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'wordlist_user';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  it('ja 两组：假名 24 + N5 100（curated 顺序即学习顺序）', async () => {
    const res = await repo.listWordlists(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.length).toBe(2);
    expect(res.value[0]?.title).toContain('假名');
    expect(res.value[0]?.words.length).toBe(24);
    expect(res.value[1]?.title).toContain('N5');
    expect(res.value[1]?.words.length).toBe(100);
    const first = res.value[1]?.words[0];
    expect(first?.headword).toBe('私');
    expect(first?.reading).toBe('わたし');
    expect(first?.meanings).toContain('我');
    expect(first?.collected).toBe(false);
    expect(first?.studied).toBe(false);
  });

  it('ko/en 各自 starter 一组', async () => {
    const ko = await repo.listWordlists(userId, 'ko');
    expect(isOk(ko)).toBe(true);
    if (!isOk(ko)) return;
    expect(ko.value.length).toBe(1);
    expect(ko.value[0]?.words.length).toBe(24);
    const en = await repo.listWordlists(userId, 'en');
    expect(isOk(en)).toBe(true);
    if (!isOk(en)) return;
    expect(en.value.length).toBe(1);
    expect(en.value[0]?.words.length).toBe(24);
  });

  it('收藏→已收，讲透→已学透（状态实时叠加）', async () => {
    const collected = await repo.collectDictionaryEntry(userId, 'n5_ja_watashi');
    expect(isOk(collected)).toBe(true);
    if (!isOk(collected)) return;
    let list = await repo.listWordlists(userId, 'ja');
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    const word = list.value[1]?.words.find((w) => w.entryId === 'n5_ja_watashi');
    expect(word?.collected).toBe(true);
    expect(word?.studied).toBe(false);

    const studied = await repo.markCardStudied(userId, collected.value.card.id);
    expect(isOk(studied)).toBe(true);
    list = await repo.listWordlists(userId, 'ja');
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    expect(list.value[1]?.words.find((w) => w.entryId === 'n5_ja_watashi')?.studied).toBe(true);
  });
});
