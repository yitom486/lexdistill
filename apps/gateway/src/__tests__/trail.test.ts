import { describe, expect, it, beforeEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { app } from '../index.js';
import { isOk } from '@lexdistill/shared';

describe('Beginner Trail (learning-progress domain)', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'test_user_trail_01';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  async function seedQuizAttempts(n: number, testedSkillId = 'jp.particle.ni_vs_de') {
    for (let i = 0; i < n; i++) {
      const res = await repo.recordQuizAttempt({
        id: `trail_attempt_${i}`,
        userId,
        questionId: `q${i}`,
        userAnswer: 'に',
        isCorrect: true,
        score: 1,
        timeSpentMs: 1000,
        testedSkillId,
        createdAt: new Date().toISOString(),
      });
      expect(isOk(res)).toBe(true);
    }
  }

  async function seedCollectsToday(n: number) {
    for (let i = 0; i < n; i++) {
      const res = await repo.recordTermExposure({
        userId,
        language: 'ja',
        headword: `带路词${i}`,
        source: 'collect',
        markCollected: true,
        flashcardId: `trail_card_${i}`,
      });
      expect(isOk(res)).toBe(true);
    }
  }

  async function seedReadingToday() {
    const res = await repo.recordDailyActivity(userId, { reading: 1, language: 'ja' });
    expect(isOk(res)).toBe(true);
  }

  it('starts with only the first stage current and the rest locked', async () => {
    const res = await repo.getBeginnerTrail(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.track).toBe('ja');
    expect(res.value.complete).toBe(false);
    expect(res.value.stages.length).toBe(5);
    expect(res.value.stages[0]?.current).toBe(true);
    expect(res.value.stages[0]?.locked).toBe(false);
    expect(res.value.stages[0]?.tab).toBe('KANA');
    for (const s of res.value.stages.slice(1)) {
      expect(s.locked).toBe(true);
      expect(s.current).toBe(false);
      expect(s.done).toBe(false);
    }
  });

  it('unlocks stages sequentially as kana attempts accumulate', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await repo.recordKanaPractice(userId, `kana_${i}`, true, 'HIRAGANA');
      expect(isOk(r)).toBe(true);
    }
    const res = await repo.getBeginnerTrail(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.stages[0]?.done).toBe(true);
    expect(res.value.stages[1]?.current).toBe(true);
    expect(res.value.stages[1]?.progress).toBe(3);
  });

  it('marks complete when all five ja signals are satisfied today', async () => {
    for (let i = 0; i < 15; i++) {
      await repo.recordKanaPractice(userId, `kana_${i}`, true, 'HIRAGANA');
    }
    await seedCollectsToday(3);
    await seedQuizAttempts(3);
    await seedReadingToday();
    const res = await repo.getBeginnerTrail(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.complete).toBe(true);
    expect(res.value.stages.every((s) => s.done)).toBe(true);
  });

  it('昨天的量不算数：今天没动手就不打钩（回归：历史总量自动完成）', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    // 昨天刷了 10 次假名 + 收了 5 个词
    const act = await repo.recordDailyActivity(userId, { kanaDrills: 10, language: 'ja', date: yesterday });
    expect(isOk(act)).toBe(true);
    repo
      .getRawDb()
      .prepare(
        `INSERT INTO term_occurrences (id, user_id, language, term_key, source, document_id, quote, created_at)
         VALUES (?, ?, 'ja', ?, 'collect', NULL, NULL, ?)`
      )
      .run('tocc_y', userId, '旧词', `${yesterday}T12:00:00.000Z`);
    const res = await repo.getBeginnerTrail(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.stages[0]?.done).toBe(false);
    expect(res.value.stages[0]?.progress).toBe(0);
    expect(res.value.complete).toBe(false);
  });

  it('字母 drill 不串台到自适应做题（kana 15 次只推满前两天）', async () => {
    for (let i = 0; i < 15; i++) {
      await repo.recordKanaPractice(userId, `kana_x_${i}`, true, 'HIRAGANA');
    }
    const res = await repo.getBeginnerTrail(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.stages[0]?.done).toBe(true);
    expect(res.value.stages[1]?.done).toBe(true);
    // 第 4 天要的是 quiz_attempts 行，kana drill 不写该表
    expect(res.value.stages[3]?.done).toBe(false);
    expect(res.value.stages[3]?.progress).toBe(0);
  });

  it('serves ko and en tracks with their own stage lists', async () => {
    const ko = await repo.getBeginnerTrail(userId, 'ko');
    expect(isOk(ko)).toBe(true);
    if (!isOk(ko)) return;
    expect(ko.value.stages.length).toBe(5);
    expect(ko.value.stages[0]?.tab).toBe('HANGUL');

    const en = await repo.getBeginnerTrail(userId, 'en');
    expect(isOk(en)).toBe(true);
    if (!isOk(en)) return;
    expect(en.value.stages.length).toBe(3);
    expect(en.value.stages[0]?.tab).toBe('CARDS');
  });

  it('exposes the trail over HTTP GET /api/trail/:userId', async () => {
    const res = await app.request('/api/trail/http_trail_user_01?track=ja');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { track?: unknown; complete?: unknown; stages?: unknown[] };
    expect(data.track).toBe('ja');
    expect(data.complete).toBe(false);
    expect(Array.isArray(data.stages)).toBe(true);
    expect(data.stages?.length).toBe(5);
  });

  it('功能体验路线不覆盖零基础计划', async () => {
    await repo.updateLearnerProfile(userId, { targetLanguage: 'ja' });
    const planRes = await repo.getOrCreateDailyStudyPlan(userId);
    expect(isOk(planRes)).toBe(true);
    if (!isOk(planRes)) return;
    const ids = planRes.value.steps.map((s) => s.id);
    // 路线单元置顶：首步仍是字母跟读（元音单元→假名工作室），不是体验路线
    expect(ids[0]).toBe('step_unit_ja-u-vowels');
    expect(ids.some((id) => id.startsWith('step_trail_'))).toBe(false);
    expect(planRes.value.steps.some(s => s.kind === 'READING' || s.kind === 'QUIZ')).toBe(false);
    expect(planRes.value.steps[0]?.title).toContain('あいうえお');
  });

  it('M1：带路走完后计划回到标准步骤', async () => {
    await repo.updateLearnerProfile(userId, { targetLanguage: 'ja' });
    for (let i = 0; i < 15; i++) {
      await repo.recordKanaPractice(userId, `m1_kana_${i}`, true, 'HIRAGANA');
    }
    for (let i = 0; i < 3; i++) {
      await repo.recordTermExposure({
        userId,
        language: 'ja',
        headword: `m1词${i}`,
        source: 'collect',
        markCollected: true,
        flashcardId: `m1_card_${i}`,
      });
    }
    for (let i = 0; i < 3; i++) {
      await repo.recordQuizAttempt({
        id: `m1_q_${i}`,
        userId,
        questionId: `m1_qq_${i}`,
        userAnswer: 'に',
        isCorrect: true,
        score: 1,
        timeSpentMs: 1000,
        testedSkillId: 'jp.particle.ni_vs_de',
        createdAt: new Date().toISOString(),
      });
    }
    await repo.recordDailyActivity(userId, { reading: 1, language: 'ja' });
    const planRes = await repo.getOrCreateDailyStudyPlan(userId);
    expect(isOk(planRes)).toBe(true);
    if (!isOk(planRes)) return;
    expect(planRes.value.steps.some((s) => s.id.startsWith('step_trail_'))).toBe(false);
  });
});
