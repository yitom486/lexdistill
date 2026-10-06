import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { buildTermKey } from '@study-studio/storage-sqlite';

/**
 * 卡片吃词典（建卡注入）：收藏时把词典读音/释义/来源带进卡，
 * 词性、例句独立保存；标签只保存来源标签，卡片关联全局词条。
 */
describe('card eats dictionary（建卡注入）', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'dict_eat_user';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  it('无例句缓存：读音/释义/来源进卡，例句保持空数组', async () => {
    const res = await repo.collectDictionaryEntry(userId, 'n5_ja_taberu');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.created).toBe(true);
    const card = res.value.card;
    expect(card.front).toBe('食べる');
    expect(card.phonetic).toBe('たべる');
    expect(card.back).toContain('吃');
    expect(card.sourceEntryId).toBe('n5_ja_taberu');
    expect(card.tags[0]).toBe('词典生词');
    expect(card.partOfSpeech).toBe('动词');
    expect(card.examples).toEqual([]);
    expect(card.tags).toEqual(['词典生词', '词典：N5 核心词']);
    expect(card.vocabularyId).toBeTruthy();
  });

  it('有例句缓存：例句独立保存，标签只有来源', async () => {
    const termKey = buildTermKey('食べる', 'たべる');
    repo
      .getRawDb()
      .query(
        `INSERT INTO term_examples (id, language, term_key, headword, sentence, translation, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('tex_test_1', 'ja', termKey, '食べる', '朝ごはんを食べる。', '吃早饭。', 'ai', new Date().toISOString());
    const res = await repo.collectDictionaryEntry(userId, 'n5_ja_taberu');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.card.examples).toEqual([{ text: '朝ごはんを食べる。', translation: '吃早饭。' }]);
    expect(res.value.card.tags).toEqual(['词典生词', '词典：N5 核心词']);
  });

  it('sourceEntryId 跟卡到复习队列（卡面弹窗精确回查凭据）', async () => {
    const collected = await repo.collectDictionaryEntry(userId, 'starter_ja_neko');
    expect(isOk(collected)).toBe(true);
    if (!isOk(collected)) return;
    const due = await repo.getDueCards(userId, 50, { language: 'ja' });
    expect(isOk(due)).toBe(true);
    if (!isOk(due)) return;
    const mine = due.value.find((c) => c.id === collected.value.card.id);
    expect(mine?.sourceEntryId).toBe('starter_ja_neko');
  });

  it('重复收藏返回同一张卡（含来源凭据，不复制）', async () => {
    const first = await repo.collectDictionaryEntry(userId, 'starter_ja_neko');
    const second = await repo.collectDictionaryEntry(userId, 'starter_ja_neko');
    expect(isOk(first) && isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;
    expect(second.value.created).toBe(false);
    expect(second.value.card.id).toBe(first.value.card.id);
    expect(second.value.card.sourceEntryId).toBe('starter_ja_neko');
  });
});
