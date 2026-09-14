import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { buildTermKey } from '@study-studio/storage-sqlite';

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

describe('encountered-terms（相遇词钥匙实体）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    seedEntry(repo, { id: 'e_tab', headword: '食べる', reading: 'たべる', meanings: ['吃'] });
  });

  it('termKey 归一：去空、同形异读不同键', () => {
    expect(buildTermKey(' 食べる ', 'たべる')).toBe(buildTermKey('食べる', 'たべる'));
    expect(buildTermKey('食べる', 'たべる')).not.toBe(buildTermKey('食べる', ''));
    expect(buildTermKey('食べる')).toBe(buildTermKey('食べる', undefined));
  });

  it('收藏漏斗建相遇词：status=collected、卡已回填、审计+1', async () => {
    const collected = await repo.collectDictionaryEntry('u1', 'e_tab');
    expect(isOk(collected)).toBe(true);
    if (!isOk(collected)) return;
    const listed = await repo.listEncounteredTerms('u1', 'ja');
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.length).toBe(1);
    expect(listed.value[0]?.headword).toBe('食べる');
    expect(listed.value[0]?.status).toBe('collected');
    expect(listed.value[0]?.flashcardId).toBe(collected.value.card.id);
    expect(listed.value[0]?.exposureCount).toBe(1);
    const occ = repo
      .getRawDb()
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM term_occurrences WHERE user_id = 'u1'"
      )
      .get();
    expect(occ!.n).toBe(1);
  });

  it('重复收藏（去重分支）同样记相遇：exposure 累加、不降级', async () => {
    await repo.collectDictionaryEntry('u1', 'e_tab');
    await repo.collectDictionaryEntry('u1', 'e_tab');
    const listed = await repo.listEncounteredTerms('u1', 'ja');
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.length).toBe(1);
    expect(listed.value[0]?.exposureCount).toBe(2);
    expect(listed.value[0]?.status).toBe('collected');
  });

  it('查词弱信号：status=new；lookup 不覆盖已收藏', async () => {
    const first = await repo.recordTermExposure({
      userId: 'u1',
      language: 'ja',
      headword: '食べる',
      reading: 'たべる',
      source: 'lookup',
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.status).toBe('new');
    await repo.collectDictionaryEntry('u1', 'e_tab');
    // 收藏后 status 升级 collected；再来一次 lookup 不得降级回 new
    await repo.recordTermExposure({
      userId: 'u1',
      language: 'ja',
      headword: '食べる',
      reading: 'たべる',
      source: 'lookup',
    });
    const listed = await repo.listEncounteredTerms('u1', 'ja');
    if (!isOk(listed)) return;
    expect(listed.value[0]?.status).toBe('collected');
    expect(listed.value[0]?.exposureCount).toBe(3);
  });

  it('非法输入拒绝：坏语种/空用户/空词', async () => {
    const badLang = await repo.recordTermExposure({
      userId: 'u1',
      language: 'fr',
      headword: 'x',
      source: 'lookup',
    });
    expect(isOk(badLang)).toBe(false);
    const emptyUser = await repo.recordTermExposure({
      userId: '  ',
      language: 'ja',
      headword: 'x',
      source: 'lookup',
    });
    expect(isOk(emptyUser)).toBe(false);
    const emptyHead = await repo.recordTermExposure({
      userId: 'u1',
      language: 'ja',
      headword: '   ',
      source: 'lookup',
    });
    expect(isOk(emptyHead)).toBe(false);
    const badList = await repo.listEncounteredTerms('u1', 'xx');
    expect(isOk(badList)).toBe(false);
  });

  it('用户隔离 + 语种隔离', async () => {
    await repo.recordTermExposure({
      userId: 'u1',
      language: 'ja',
      headword: '食べる',
      source: 'lookup',
    });
    const other = await repo.listEncounteredTerms('u2', 'ja');
    expect(isOk(other)).toBe(true);
    if (!isOk(other)) return;
    expect(other.value).toEqual([]);
    const otherLang = await repo.listEncounteredTerms('u1', 'en');
    expect(isOk(otherLang)).toBe(true);
    if (!isOk(otherLang)) return;
    expect(otherLang.value).toEqual([]);
  });

  it('冷启动回填：历史聚合同词、无条目用原文', async () => {
    await repo.recordDictionarySearch('u1', 'ja', '食べる', 1, 'e_tab');
    await repo.recordDictionarySearch('u1', 'ja', '食べる', 1, 'e_tab');
    await repo.recordDictionarySearch('u1', 'ja', '手書きメモ', 0);
    const backfilled = await repo.backfillEncounteredTermsFromHistory('u1', 'ja');
    expect(isOk(backfilled)).toBe(true);
    if (!isOk(backfilled)) return;
    expect(backfilled.value.terms).toBe(2);
    const listed = await repo.listEncounteredTerms('u1', 'ja', 10);
    if (!isOk(listed)) return;
    const tab = listed.value.find((t) => t.headword === '食べる');
    expect(tab?.exposureCount).toBe(2);
    expect(tab?.reading).toBe('たべる');
    const memo = listed.value.find((t) => t.headword === '手書きメモ');
    expect(memo?.exposureCount).toBe(1);
    // 重复回填：计数不翻倍（幂等）
    await repo.backfillEncounteredTermsFromHistory('u1', 'ja');
    const relisted = await repo.listEncounteredTerms('u1', 'ja', 10);
    if (!isOk(relisted)) return;
    expect(relisted.value.find((t) => t.headword === '食べる')?.exposureCount).toBe(2);
  });

  it('迁移版本化：基线 v1 + 本轮 v2 落 schema_migrations', () => {
    const rows = repo
      .getRawDb()
      .query<{ version: number }, []>('SELECT version AS version FROM schema_migrations ORDER BY version')
      .all();
    expect(rows.map((r) => r.version).slice(0, 2)).toEqual([1, 2]);
  });

  it('reading 批量：记整课生词；同课同天跳过；已收藏不降级', async () => {
    const input = {
      userId: 'u1',
      language: 'ja',
      documentId: 'doc1',
      lessonId: 'l1',
      terms: [
        { headword: '曖昧', reading: 'あいまい' },
        { headword: '躊躇' },
      ],
    };
    const first = await repo.recordReadingExposures(input);
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value).toEqual({ recorded: 2, skipped: false });
    const second = await repo.recordReadingExposures(input);
    if (!isOk(second)) return;
    expect(second.value).toEqual({ recorded: 0, skipped: true });
    // 不同课照记
    const other = await repo.recordReadingExposures({ ...input, lessonId: 'l2' });
    if (!isOk(other)) return;
    expect(other.value.recorded).toBe(2);
    // 收藏其中一词后再批量：status 保持 collected，exposure 照累
    await repo.recordTermExposure({
      userId: 'u1',
      language: 'ja',
      headword: '曖昧',
      reading: 'あいまい',
      source: 'collect',
      markCollected: true,
      flashcardId: 'c1',
    });
    const listed = await repo.listEncounteredTerms('u1', 'ja');
    if (!isOk(listed)) return;
    expect(listed.value.find((t) => t.headword === '曖昧')?.status).toBe('collected');
  });

  it('reading 非法输入拒绝：坏语种/空课/超量', async () => {
    const base = {
      userId: 'u1',
      language: 'ja',
      documentId: 'doc1',
      lessonId: 'l1',
      terms: [{ headword: '曖昧' }],
    };
    expect(isOk(await repo.recordReadingExposures({ ...base, language: 'fr' }))).toBe(false);
    expect(isOk(await repo.recordReadingExposures({ ...base, lessonId: '  ' }))).toBe(false);
    expect(
      isOk(
        await repo.recordReadingExposures({
          ...base,
          terms: Array.from({ length: 51 }, (_, i) => ({ headword: `词${i}` })),
        })
      )
    ).toBe(false);
    expect(isOk(await repo.recordReadingExposures({ ...base, terms: [] }))).toBe(false);
  });
});
