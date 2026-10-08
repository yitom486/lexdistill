import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../../../runtime/gateway-runtime.js';
import { createDictionaryRoutes } from '../http/dictionary-routes.js';
import { pickDailyWords, formatLockedPayload } from '../application/daily-pick.js';
import { DailyPickResponseSchema, DailyPickLockedResponseSchema } from '@study-studio/protocol';

const N4_BANK = {
  id: 'ja-n4-core',
  title: 'N4 核心',
  subtitle: '',
  words: [
    { entryId: 'n4_ja_a', headword: '約束', reading: 'やくそく', meanings: ['约定'], sourceLabel: 'N4', collected: false, studied: false },
    { entryId: 'n4_ja_b', headword: '案内', reading: 'あんない', meanings: ['向导'], sourceLabel: 'N4', collected: false, studied: false },
  ],
};

function stubDeps(words: typeof N4_BANK.words, studiedAll = false) {
  const flagged = words.map(word => ({ ...word, studied: studiedAll ? true : word.studied }));
  return {
    getLearnerProfile: async () => ({ ok: true as const, value: { learnerLevel: 'NOVICE' as const, dailyGoalNewWords: 10, wordLevelFilter: null } }),
    listWordlists: async () => ({ ok: true as const, value: [{ ...N4_BANK, words: flagged }] }),
    getVocabularyMasteryByJlpt: async () => ({ ok: true as const, value: [] as Array<{ jlpt: string; total: number; stable: number }> }),
  };
}

describe('pickDailyWords', () => {
  it('锁库返回空词＋locked；门内按序抽取；未知 bank 拒绝', async () => {
    const locked = await pickDailyWords(stubDeps(N4_BANK.words), 'u', 'ja', { count: 1, order: 'sequential', bankId: 'ja-n4-core' });
    if (!locked.ok) throw locked.error;
    expect(locked.value.words).toEqual([]);
    expect(locked.value.locked?.requiredJlpt).toBe('N4');
    const open = await pickDailyWords(
      { ...stubDeps(N4_BANK.words), getLearnerProfile: async () => ({ ok: true as const, value: { learnerLevel: 'BEGINNER' as const, dailyGoalNewWords: 10, wordLevelFilter: null } }) },
      'u', 'ja', { count: 2, order: 'sequential', bankId: 'ja-n4-core' });
    if (!open.ok) throw open.error;
    expect(open.value.words.map(word => word.headword)).toEqual(['約束', '案内']);
    expect(open.value.pick).toMatchObject({ bankId: 'ja-n4-core', requested: 2, returned: 2, unlockedJlptMax: 'N4', skippedLocked: 0 });
    expect(open.value.locked).toBeNull();
    const unknown = await pickDailyWords(stubDeps(N4_BANK.words), 'u', 'ja', { count: 1, order: 'sequential', bankId: 'nope' });
    expect(unknown.ok ? '' : unknown.error.code).toBe('E_INVALID_INPUT');
  });

  it('整库被门拦下返回 locked（空词＋需掌握率/当前率）；空级当前率按 0 显示', async () => {
    const locked = await pickDailyWords(stubDeps(N4_BANK.words), 'u', 'ja', { count: 2, order: 'random', bankId: 'ja-n4-core' });
    if (!locked.ok) throw locked.error;
    expect(locked.value.words).toEqual([]);
    expect(locked.value.locked).toEqual({ requiredJlpt: 'N4', requiredMastery: 0.8, currentMastery: 0 });
    expect(locked.value.pick.returned).toBe(0);
  });

  it('掌握率达标开锁；用户过滤只做减法不开锁', async () => {
    const base = stubDeps(N4_BANK.words);
    const withMastery = { ...base, getVocabularyMasteryByJlpt: async () => ({ ok: true as const, value: [{ jlpt: 'N5', total: 10, stable: 8 }] }) };
    const opened = await pickDailyWords(withMastery, 'u', 'ja', { count: 5, order: 'sequential', bankId: 'ja-n4-core' });
    if (!opened.ok) throw opened.error;
    expect(opened.value.words).toHaveLength(2);
    expect(opened.value.locked).toBeNull();
    const filtered = await pickDailyWords(
      { ...withMastery, getLearnerProfile: async () => ({ ok: true as const, value: { learnerLevel: 'BEGINNER' as const, dailyGoalNewWords: 10, wordLevelFilter: ['N5'] } }) },
      'u', 'ja', { count: 5, order: 'sequential', bankId: 'ja-n4-core' });
    if (!filtered.ok) throw filtered.error;
    expect(filtered.value.words).toEqual([]);
    expect(filtered.value.locked).toBeNull();
  });

  it('未学透优先；全部学透则循环；随机不丢词', async () => {    const deps = stubDeps(N4_BANK.words);
    const partial = await pickDailyWords(
      { ...deps, listWordlists: async () => ({ ok: true as const, value: [{ ...N4_BANK, words: [{ ...N4_BANK.words[0]!, studied: true }, N4_BANK.words[1]!] }] }),
        getLearnerProfile: async () => ({ ok: true as const, value: { learnerLevel: 'BEGINNER' as const, dailyGoalNewWords: 10, wordLevelFilter: null } }) },
      'u', 'ja', { count: 5, order: 'sequential', bankId: 'ja-n4-core' });
    if (!partial.ok) throw partial.error;
    expect(partial.value.words.map(word => word.headword)).toEqual(['案内']);
    const cycled = await pickDailyWords(
      { ...deps, listWordlists: async () => ({ ok: true as const, value: [{ ...N4_BANK }] }),
        getLearnerProfile: async () => ({ ok: true as const, value: { learnerLevel: 'BEGINNER' as const, dailyGoalNewWords: 10, wordLevelFilter: null } }) },
      'u', 'ja', { count: 5, order: 'random', bankId: 'ja-n4-core' });
    if (!cycled.ok) throw cycled.error;
    expect(cycled.value.words).toHaveLength(2);
    expect([...cycled.value.words.map(word => word.headword)].sort()).toEqual(['案内', '約束']);
  });

  it('混级库逐词门禁：高阶混入词被拦并计入 skippedLocked；词自带有效等级不被库等级覆盖', async () => {
    const bank = {
      ...N4_BANK,
      words: [
        { ...N4_BANK.words[0]!, jlpt: 'N1' },
        N4_BANK.words[1]!,
      ],
    };
    const deps = {
      getLearnerProfile: async () => ({ ok: true as const, value: { learnerLevel: 'BEGINNER' as const, dailyGoalNewWords: 10, wordLevelFilter: null } }),
      listWordlists: async () => ({ ok: true as const, value: [bank] }),
      getVocabularyMasteryByJlpt: async () => ({ ok: true as const, value: [{ jlpt: 'N4', total: 10, stable: 8 }] }),
    };
    const res = await pickDailyWords(deps, 'u', 'ja', { count: 5, order: 'sequential', bankId: 'ja-n4-core' });
    if (!res.ok) throw res.error;
    expect(res.value.words.map(word => word.headword)).toEqual(['案内']);
    expect(res.value.pick.skippedLocked).toBe(1);
    expect(res.value.words[0]).toMatchObject({ jlpt: 'N4' });
  });
});

describe('POST /api/vocabulary/:userId/daily-pick', () => {
  it('真实库顺序抽取并校验响应契约；非法入参 400', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const deps = { repo, server: new GatewayServer(repo), port: 0 };
      const app = new Hono().route('/', createDictionaryRoutes(deps));
      const post = (body: unknown) => app.request('/api/vocabulary/u/daily-pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const okRes = await post({ lang: 'ja', count: 2, order: 'sequential', bankId: 'ja-n5-core' });
      expect(okRes.status).toBe(200);
      const parsed = DailyPickResponseSchema.safeParse(await okRes.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.words.length).toBeGreaterThan(0);
        expect(parsed.data.words.every(word => word.jlpt === 'N5')).toBe(true);
        expect(parsed.data.pick.unlockedJlptMax).toBe('N5');
      }
      expect((await post({ lang: 'ja', count: 0, order: 'sequential', bankId: 'ja-n5-core' })).status).toBe(400);
      expect((await post({ lang: 'ja', count: 2, order: 'sequential', bankId: 'nope' })).status).toBe(400);
      const greet = await post({ lang: 'ja', count: 10, order: 'sequential', bankId: 'ja-n5-core', courseUnitId: 'ja-u-greet' });
      expect(greet.status).toBe(200);
      const greetingWords = DailyPickResponseSchema.parse(await greet.json()).words;
      expect(greetingWords.map(w => w.entryId)).toEqual(['starter_ja_ohayou', 'n5_ja_arigatou', 'n5_ja_sumimasen', 'n5_ja_onegaishimasu']);
      const first20 = await post({ lang: 'ja', count: 50, order: 'random', bankId: 'ja-n5-core', courseUnitId: 'ja-u-words1' });
      const wordlist = await repo.listWordlists('u', 'ja');
      if (!wordlist.ok) throw wordlist.error;
      const allowedIds = wordlist.value.find(g => g.id === 'ja-n5-core')!.words.map(w => w.entryId).sort().slice(0, 20);
      expect(DailyPickResponseSchema.parse(await first20.json()).words.map(w => w.entryId).sort()).toEqual(allowedIds);
      expect((await post({ lang: 'ja', count: 2, order: 'sequential', bankId: 'ja-n5-core', courseUnitId: 'en-u-starter' })).status).toBe(400);
      expect((await post({ lang: 'ja', count: 2, order: 'sequential', bankId: 'ja-n5-core', courseUnitId: 'ja-u-vowels' })).status).toBe(400);
    } finally {
      repo.getRawDb().close();
    }
  });

  it('锁库 409 负载契约：状态码＋文案＋进度字段一次配齐', async () => {
    const locked = await pickDailyWords(stubDeps(N4_BANK.words), 'u', 'ja', { count: 2, order: 'sequential', bankId: 'ja-n4-core' });
    if (!locked.ok) throw locked.error;
    if (!locked.value.locked) throw new Error('expected locked payload');
    const shaped = formatLockedPayload({ words: [], pick: locked.value.pick, locked: locked.value.locked });
    expect(shaped.status).toBe(409);
    const parsed = DailyPickLockedResponseSchema.safeParse(shaped.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('E_BANK_LOCKED');
      expect(parsed.data.error.userMessage).toContain('N4');
      expect(parsed.data.data).toEqual({ requiredMastery: 0.8, currentMastery: 0 });
    }
  });
});
