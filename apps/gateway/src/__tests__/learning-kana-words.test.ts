import { describe, expect, it, beforeEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningContentTool } from '../modules/learning-content/public.js';
import { isOk } from '@study-studio/shared';

function seedWord(
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
      'test-seed',
      'test seed',
      'test',
      new Date().toISOString()
    );
}

describe('learning.content generate_kana_words', () => {
  let repo: DrizzleLearnerRepository;
  let tool: LearningContentTool;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    tool = new LearningContentTool(repo);
    // 清掉自动种子，完全由本用例控制词池
    repo.getRawDb().run('DELETE FROM local_dictionary_entries');
    seedWord(repo, { id: 'w_ame', headword: '雨', reading: 'あめ', meanings: ['下雨'] });
    seedWord(repo, { id: 'w_hashi', headword: '箸', reading: 'はし', meanings: ['筷子'] });
    seedWord(repo, { id: 'w_comp', headword: 'コンピューター', reading: 'コンピューター', meanings: ['计算机'] });
    seedWord(repo, { id: 'w_kanji', headword: '日本語', reading: '日本語', meanings: ['日语'] });
  });

  it('returns kana-reading words with audio text and collectable entry ids', async () => {
    const res = await tool.execute(
      { action: 'generate_kana_words', count: 5, language: 'ja' },
      { userId: 'u_kana_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 日本語（汉字读音）被假名过滤器排除，只剩 3 个纯假名 readings
    expect(res.value.kanaWords?.length).toBe(3);
    for (const w of res.value.kanaWords ?? []) {
      expect(w.kana).toMatch(/^[\u3040-\u30FFー・\s]+$/);
      expect(w.audioText).toBe(w.kana);
      expect(w.meanings.length).toBeGreaterThan(0);
      expect(w.entryId).toMatch(/^w_/);
      expect(w.headword.length).toBeGreaterThan(0);
    }
  });

  it('prefers the requested script and tops up with the other', async () => {
    const res = await tool.execute(
      { action: 'generate_kana_words', count: 3, language: 'ja', script: 'KATAKANA' },
      { userId: 'u_kana_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 片假名只有 1 个 → 首位必须是它，后面用平假名补齐
    expect(res.value.kanaWords?.[0]?.kana).toBe('コンピューター');
    expect(res.value.kanaWords?.length).toBe(3);
  });

  it('rejects non-Japanese with a friendly error', async () => {
    const res = await tool.execute(
      { action: 'generate_kana_words', count: 2, language: 'en' },
      { userId: 'u_kana_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
  });

  it('returns E_CONTENT_EMPTY when the pool has no kana words', async () => {
    repo.getRawDb().run('DELETE FROM local_dictionary_entries');
    const res = await tool.execute(
      { action: 'generate_kana_words', count: 2, language: 'ja' },
      { userId: 'u_kana_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_CONTENT_EMPTY');
  });
});
