import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { deinflectKo } from '@study-studio/dictionary-core';

describe('searchLocalDictionary 韩语回退', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    repo.getRawDb().run('DELETE FROM local_dictionary_entries');
    const now = new Date().toISOString();
    const seed = (id: string, headword: string, meanings: string[], partOfSpeech?: string) => {
      repo.getRawDb().prepare(`INSERT INTO local_dictionary_entries (
        id, language, headword, reading, romanization, meanings_json,
        pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, 'ko', headword, null, null, JSON.stringify(meanings), null, partOfSpeech ?? null, 'test', 'test', 'test', now
      );
    };
    seed('w_muk', '먹다', ['吃'], '动词');
    seed('w_chup', '춥다', ['冷'], '形容词');
    seed('w_bae_n', '배', ['梨/肚子'], '名词');
    seed('w_baeda', '배다', ['浸透'], '动词');
    seed('w_ilhada', '일하다', ['工作'], '动词');
  });

  it('먹었어요→먹다（注记含过去时）；추워요→춥다', async () => {
    const r1 = await repo.searchLocalDictionary('ko', '먹었어요');
    expect(isOk(r1)).toBe(true);
    if (!isOk(r1)) return;
    expect(r1.value.length).toBeGreaterThan(0);
    expect(r1.value[0]?.headword).toBe('먹다');
    expect(r1.value[0]?.inflectionNote).toContain('过去时');
    const r2 = await repo.searchLocalDictionary('ko', '추워요');
    expect(isOk(r2)).toBe(true);
    if (!isOk(r2)) return;
    expect(r2.value[0]?.headword).toBe('춥다');
    expect(r2.value[0]?.inflectionNote).toContain('不规则');
  });

  it('缩约链：일해요→일하다', async () => {
    const r = await repo.searchLocalDictionary('ko', '일해요');
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.some((e) => e.id === 'w_ilhada')).toBe(true);
  });

  it('名词误命中注记：안 배→배（动词路径不适用，注记存疑但保留）', async () => {
    // 排序代码与 ja 共用（かく对照已覆盖顺序）；此处验证 ko 名词误命中同样注记而不丢失。
    const r = await repo.searchLocalDictionary('ko', '안 배');
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const noun = r.value.find((e) => e.id === 'w_bae_n');
    expect(noun).toBeDefined();
    expect(noun?.inflectionNote).toContain('仅供参考');
  });
});
