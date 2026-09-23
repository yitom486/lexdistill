import { describe, expect, it, beforeEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningContentTool } from '../modules/learning-content/public.js';
import { isOk } from '@study-studio/shared';

function seedWord(
  repo: DrizzleLearnerRepository,
  row: { id: string; headword: string; meanings: string[] }
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
      'ko',
      row.headword,
      null,
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

describe('learning.content generate_hangul_words', () => {
  let repo: DrizzleLearnerRepository;
  let tool: LearningContentTool;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    tool = new LearningContentTool(repo);
    // 清掉自动种子，完全由本用例控制词池
    repo.getRawDb().run('DELETE FROM local_dictionary_entries');
    seedWord(repo, { id: 'hw_hello', headword: '안녕하세요', meanings: ['hello', 'greeting'] });
    seedWord(repo, { id: 'hw_school', headword: '학교', meanings: ['school'] });
    seedWord(repo, { id: 'hw_book', headword: '책', meanings: ['book'] });
    seedWord(repo, { id: 'hw_latin', headword: 'hello', meanings: ['你好'] });
  });

  it('returns Korean words with audio text and collectable entry ids', async () => {
    const res = await tool.execute(
      { action: 'generate_hangul_words', count: 5, language: 'ko' },
      { userId: 'u_hangul_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 纯拉丁 headword 被韩语表层过滤器排除，只剩 3 个韩语词
    expect(res.value.hangulWords?.length).toBe(3);
    for (const w of res.value.hangulWords ?? []) {
      expect(w.korean).toMatch(/^[\uAC00-\uD7A3\u3130-\u318F\s·・]+$/);
      expect(w.audioText).toBe(w.korean);
      expect(w.meanings.length).toBeGreaterThan(0);
      expect(w.entryId).toMatch(/^hw_/);
    }
  });

  it('rejects non-Korean with a friendly error', async () => {
    const res = await tool.execute(
      { action: 'generate_hangul_words', count: 2, language: 'ja' },
      { userId: 'u_hangul_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
  });

  it('returns E_CONTENT_EMPTY when the pool has no Korean words', async () => {
    repo.getRawDb().run('DELETE FROM local_dictionary_entries');
    const res = await tool.execute(
      { action: 'generate_hangul_words', count: 2, language: 'ko' },
      { userId: 'u_hangul_01', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_CONTENT_EMPTY');
  });
});
