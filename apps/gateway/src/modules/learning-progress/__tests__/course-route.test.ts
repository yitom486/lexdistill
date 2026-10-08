import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';

/** 课程路线：长期路线求值 + 新掌握写档（已记录永不收回）。 */
describe('course route', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'route_user';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  it('新人：元音可用，其余锁定；nextUp 指向元音', async () => {
    const res = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.units.length).toBe(16);
    expect(res.value.nextUpId).toBe('ja-u-vowels');
    const byId = new Map(res.value.units.map((u) => [u.unit.id, u]));
    expect(byId.get('ja-u-vowels')?.status).toBe('available');
    expect(byId.get('ja-u-kasa')?.status).toBe('locked');
  });

  it('daily plan restores old unit templates and uses matching mastery evidence', async () => {
    const date = '2026-10-07';
    const first = await repo.getOrCreateDailyStudyPlan(userId, date, 'ja');
    if (!first.ok) throw first.error;
    const old = first.value.steps.map(s => {
      const { courseUnitId, ...rest } = s;
      return { ...rest, summary: '旧冻结进度 0/5' };
    });
    repo.getRawDb().query('UPDATE daily_study_plans SET steps_json = ? WHERE id = ?').run(JSON.stringify(old), first.value.id);
    await repo.recordDailyActivity(userId, { quizzes: 50, date, language: 'ja' });
    let plan = await repo.getOrCreateDailyStudyPlan(userId, date, 'ja');
    if (!plan.ok) throw plan.error;
    const vowelStep = plan.value.steps.find(s => s.id === 'step_unit_ja-u-vowels')!;
    expect(vowelStep.courseUnitId).toBe('ja-u-vowels');
    expect(vowelStep.progressText).toBe('0/5');
    expect(vowelStep.done).toBe(false);
    expect(vowelStep.summary).not.toContain('旧冻结');
    for (const kanaId of ['kana_a', 'kana_i', 'kana_u', 'kana_e', 'kana_o']) {
      await repo.recordKanaPractice(userId, kanaId, true, 'HIRAGANA');
      await repo.recordKanaPractice(userId, kanaId, true, 'HIRAGANA');
    }
    plan = await repo.getOrCreateDailyStudyPlan(userId, date, 'ja');
    if (!plan.ok) throw plan.error;
    expect(plan.value.steps.map(s => s.id)).toEqual(first.value.steps.map(s => s.id));
    expect(plan.value.steps.find(s => s.id === vowelStep.id)?.done).toBe(true);
    expect(plan.value.steps.find(s => s.id === vowelStep.id)?.progressText).toMatch(/^已(达标|掌握)$/);
  });

  it('adaptive kana queue stays inside the requested course unit', async () => {
    const ids = ['kana_ga', 'kana_gi', 'kana_gu', 'kana_ge', 'kana_go'];
    const queue = await repo.getAdaptiveKanaQueue(userId, { kanaIds: ids, types: ['DAKUON', 'HANDAKUON'], limit: 0 });
    if (!queue.ok) throw queue.error;
    expect(queue.value.map(k => k.id).sort()).toEqual([...ids].sort());
    const empty = await repo.getAdaptiveKanaQueue(userId, { kanaIds: ['unknown'], limit: 10 });
    if (!empty.ok) throw empty.error;
    expect(empty.value).toEqual([]);
  });

  it('假名覆盖要“干净且练过两次”：5 元音达标 → 掌握写档，K 行放行', async () => {
    for (const k of ['kana_a', 'kana_i', 'kana_u', 'kana_e', 'kana_o']) {
      // 答对 1 次不够（reps=1）：仍 available
      await repo.recordKanaPractice(userId, k, true, 'HIRAGANA');
    }
    let res = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.units.find((u) => u.unit.id === 'ja-u-vowels')?.status).toBe('available');
    // 各再答对 1 次（reps=2 且干净）：掌握
    for (const k of ['kana_a', 'kana_i', 'kana_u', 'kana_e', 'kana_o']) {
      await repo.recordKanaPractice(userId, k, true, 'HIRAGANA');
    }
    res = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const byId = new Map(res.value.units.map((u) => [u.unit.id, u]));
    expect(byId.get('ja-u-vowels')?.status).toBe('mastered');
    expect(byId.get('ja-u-greet')?.status).toBe('available');
    expect(byId.get('ja-u-kasa')?.status).toBe('available');
    // 写档：下次调用仍是已掌握（证据消失也不收回，由库行保证）
    const again = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(again)).toBe(true);
    if (!isOk(again)) return;
    expect(again.value.units.find((u) => u.unit.id === 'ja-u-vowels')?.status).toBe('mastered');
    const rows = repo
      .getRawDb()
      .query('SELECT unit_id AS unitId FROM unit_progress WHERE user_id = ?')
      .all(userId) as Array<{ unitId: string }>;
    expect(rows.map((r) => r.unitId)).toContain('ja-u-vowels');
  });

  it('答错不计干净覆盖（反复练同几个也混不过去）', async () => {
    await repo.recordKanaPractice(userId, 'kana_a', true, 'HIRAGANA');
    await repo.recordKanaPractice(userId, 'kana_a', true, 'HIRAGANA');
    await repo.recordKanaPractice(userId, 'kana_i', false, 'HIRAGANA');
    const res = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const vowels = res.value.units.find((u) => u.unit.id === 'ja-u-vowels')!;
    expect(vowels.status).toBe('available');
    expect(vowels.progress).toBe('1/5');
  });

  it('近期错误只提示复习：资格保留 + needsReview', async () => {
    for (const k of ['kana_a', 'kana_i', 'kana_u', 'kana_e', 'kana_o']) {
      await repo.recordKanaPractice(userId, k, true, 'HIRAGANA');
      await repo.recordKanaPractice(userId, k, true, 'HIRAGANA');
    }
    // 先求值一次落盘掌握
    const first = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.units.find((u) => u.unit.id === 'ja-u-vowels')?.status).toBe('mastered');
    // 刚犯错一次：资格仍在（库行），但标需复习
    await repo.recordKanaPractice(userId, 'kana_a', false, 'HIRAGANA');
    const res = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const vowels = res.value.units.find((u) => u.unit.id === 'ja-u-vowels')!;
    expect(vowels.status).toBe('mastered');
    expect(vowels.needsReview).toBe(true);
  });

  it('生词要“讲透且复习两次”：光点学透不开掌握', async () => {
    for (const e of ['starter_ja_ohayou', 'n5_ja_arigatou', 'n5_ja_sumimasen']) {
      const c = await repo.collectDictionaryEntry(userId, e);
      expect(isOk(c)).toBe(true);
      if (!isOk(c)) return;
      const s = await repo.markCardStudied(userId, c.value.card.id);
      expect(isOk(s)).toBe(true);
    }
    // 问候要元音前置：先把元音打通（各 2 次干净）
    for (const k of ['kana_a', 'kana_i', 'kana_u', 'kana_e', 'kana_o']) {
      await repo.recordKanaPractice(userId, k, true, 'HIRAGANA');
      await repo.recordKanaPractice(userId, k, true, 'HIRAGANA');
    }
    let res = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 只收+标讲透（reps=0）：问候仍 available
    expect(res.value.units.find((u) => u.unit.id === 'ja-u-greet')?.status).toBe('available');
    // 每张卡再复习两次 → 掌握，开单词线
    const cards = await repo.getDueCards(userId, 50, { language: 'ja' });
    expect(isOk(cards)).toBe(true);
    if (!isOk(cards)) return;
    for (const card of cards.value.filter((c) => c.studiedAt)) {
      const saved = await repo.saveCard({
        ...card,
        fsrs: { ...card.fsrs, reps: 2 },
      });
      expect(isOk(saved)).toBe(true);
    }
    res = await repo.getCourseRoute(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const byId = new Map(res.value.units.map((u) => [u.unit.id, u]));
    expect(byId.get('ja-u-greet')?.status).toBe('mastered');
    expect(byId.get('ja-u-words1')?.status).toBe('available');
  });

  it('ko/en starter 线可用', async () => {
    const ko = await repo.getCourseRoute(userId, 'ko');
    expect(isOk(ko)).toBe(true);
    if (!isOk(ko)) return;
    expect(ko.value.nextUpId).toBe('ko-u-starter');
  });
});
