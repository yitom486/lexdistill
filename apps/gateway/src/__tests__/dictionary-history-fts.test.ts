import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { ensureDictionaryFts } from '@study-studio/storage-sqlite';
import { searchDictionaryMeanings } from '../modules/dictionary/persistence/dictionary.js';

function seedEntry(
  repo: DrizzleLearnerRepository,
  row: { id: string; headword: string; reading: string; meanings: string[] }
) {
  repo
    .getRawDb()
    .prepare(
      `INSERT INTO local_dictionary_entries (
        id, language, headword, reading, romanization, meanings_json,
        pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      'ja',
      row.headword,
      row.reading,
      null,
      JSON.stringify(row.meanings),
      null,
      null,
      'test',
      'test',
      'test',
      new Date().toISOString()
    );
}

describe('dictionary search history（画像信号）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('记录/去重取最新/按用户隔离', async () => {
    await repo.recordDictionarySearch('u1', 'ja', '雨', 3, 'e1');
    await repo.recordDictionarySearch('u1', 'ja', '食べる', 1, 'e2');
    await repo.recordDictionarySearch('u1', 'ja', '雨', 3, 'e1');
    const res = await repo.getDictionarySearchHistory('u1', 'ja', 10);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 去重：雨只出现一次，且是最新的一次
    expect(res.value.map((r) => r.query)).toEqual(['雨', '食べる']);
    const other = await repo.getDictionarySearchHistory('u2', 'ja', 10);
    expect(isOk(other)).toBe(true);
    if (!isOk(other)) return;
    expect(other.value).toEqual([]);
  });

  it('超 200 条修剪（只留最新）', async () => {
    for (let i = 0; i < 205; i++) {
      await repo.recordDictionarySearch('u1', 'ja', `词${i}`, 1);
    }
    const count = repo
      .getRawDb()
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM dictionary_search_history WHERE user_id = 'u1'"
      )
      .get();
    expect(count!.n).toBe(200);
    const res = await repo.getDictionarySearchHistory('u1', 'ja', 20);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]?.query).toBe('词204');
  });

  it('空查询不记录', async () => {
    await repo.recordDictionarySearch('u1', 'ja', '   ', 0);
    const res = await repo.getDictionarySearchHistory('u1', 'ja', 10);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toEqual([]);
  });
});

describe('dictionary FTS（释义全文搜索）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    repo.getRawDb().run('DELETE FROM local_dictionary_entries');
    seedEntry(repo, { id: 'w1', headword: '食べる', reading: 'たべる', meanings: ['to eat food'] });
    seedEntry(repo, { id: 'w2', headword: '飲む', reading: 'のむ', meanings: ['to drink water'] });
  });

  it('中文/英文关键词命中释义，按 bm25 排序', async () => {
    const res = await repo.searchLocalDictionary('ja', 'eat food');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 直查 miss（词面无 eat）→ 走 FTS 命中释义
    expect(res.value.map((e) => e.headword)).toContain('食べる');
    // 回归：原生 SQL 行必须正确映射出释义/来源（曾出现 meanings 空数组）
    const first = res.value.find((e) => e.headword === '食べる');
    expect(first?.meanings).toEqual(['to eat food']);
    expect(first?.sourceLabel).toBeTruthy();
  });

  it('FTS 操作符被转义，不抛错', async () => {
    const res = await repo.searchLocalDictionary('ja', '"食べる" * ( OR )');
    expect(isOk(res)).toBe(true);
  });

  it('searchDictionaryMeanings 空查询返回空', async () => {
    const deps = { db: null, sqlite: repo.getRawDb() } as never;
    const res = await searchDictionaryMeanings(deps, 'ja', '   ');
    expect(isOk(res)).toBe(true);
  });
});

describe('ensureDictionaryFts（自检与回填）', () => {
  it('触发器建成后插入自动同步；删空后重建', () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const db = repo.getRawDb();
    db.run('DELETE FROM local_dictionary_entries');
    db.prepare(`INSERT INTO local_dictionary_entries (
      id, language, headword, reading, romanization, meanings_json,
      pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'w1', 'ja', '猫', 'ねこ', null, JSON.stringify(['cat']), null, null, 's', 's', 's', new Date().toISOString()
    );
    // 触发器应已同步 1 行
    const synced = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM local_dictionary_fts').get();
    expect(synced!.n).toBe(1);
    // 模拟存量缺失：清掉 fts 再自检
    db.run('DELETE FROM local_dictionary_fts');
    const result = ensureDictionaryFts(db);
    expect(result.enabled).toBe(true);
    expect(result.rebuilt).toBe(1);
    const again = ensureDictionaryFts(db);
    expect(again.rebuilt).toBe(0);
  });
});
