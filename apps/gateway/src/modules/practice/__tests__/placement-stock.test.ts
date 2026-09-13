import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { blueprintFor } from '@study-studio/learning';

/**
 * 蓝图库存覆盖：每个目标档的每组，去重可用题数必须 ≥ 应考题数。
 * 覆盖不足的考试会被阻断晋级——本测试锁住“能开考”的底线；
 * 新增蓝图组/提高题数时，先补题再改蓝图，否则此处变红。
 */
describe('assessment stock coverage（蓝图现货）', () => {
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  async function distinctFor(
    language: 'ja' | 'en' | 'ko',
    skillIds: string[]
  ): Promise<number> {
    const seen = new Set<string>();
    const pool = await repo.getQuestions('stock_user', 200, language, { skillIds });
    if (isOk(pool)) {
      for (const q of pool.value ?? []) {
        const content = String((q as { content?: unknown }).content ?? '');
        const answer = String((q as { correctAnswer?: unknown }).correctAnswer ?? '');
        if (content) seen.add(`${content}||${answer}`);
      }
    }
    for (const skill of skillIds) {
      const tpls = await repo.listContentTemplates({ action: 'generate_quiz', language, skillId: skill });
      if (!isOk(tpls)) continue;
      for (const row of tpls.value ?? []) {
        const base = ((row.payload ?? {}) as { question?: Record<string, unknown> }).question;
        if (!base || typeof base !== 'object') continue;
        const content = String(base.content ?? '');
        const answer = String(base.correctAnswer ?? '');
        if (content) seen.add(`${content}||${answer}`);
      }
    }
    return seen.size;
  }

  it('ja BEGINNER 三组全覆盖且有余量（重考可换面）', async () => {
    const bp = blueprintFor('ja', 'BEGINNER')!;
    for (const g of bp.groups) {
      const n = await distinctFor('ja', g.skillIds);
      expect(n).toBeGreaterThanOrEqual(g.items);
    }
    // 余量：particle/tara/karakeigo 至少一组有 surplus（重考换面才成立）
    const counts = await Promise.all(bp.groups.map((g) => distinctFor('ja', g.skillIds)));
    expect(Math.max(...counts.map((n, i) => n - bp.groups[i]!.items))).toBeGreaterThan(0);
  });

  it('ja INTERMEDIATE 使役组可考（曾零库存永砖）', async () => {
    const bp = blueprintFor('ja', 'INTERMEDIATE')!;
    const caus = bp.groups.find((g) => g.key === 'causative')!;
    expect(await distinctFor('ja', caus.skillIds)).toBeGreaterThanOrEqual(caus.items);
  });

  it('en BEGINNER/INTERMEDIATE 组全覆盖', async () => {
    for (const level of ['BEGINNER', 'INTERMEDIATE'] as const) {
      const bp = blueprintFor('en', level)!;
      for (const g of bp.groups) {
        expect(await distinctFor('en', g.skillIds)).toBeGreaterThanOrEqual(g.items);
      }
    }
  });

  it('ko BEGINNER 组全覆盖 + 机动不再全靠复读', async () => {
    const bp = blueprintFor('ko', 'BEGINNER')!;
    const eseo = bp.groups[0]!;
    expect(await distinctFor('ko', eseo.skillIds)).toBeGreaterThanOrEqual(eseo.items);
    // 机动池：除 eseo 外至少 8 道去重题（iga/ege 新面）
    const flexSeen = new Set<string>();
    for (const skill of ['ko.grammar.particle_iga', 'ko.grammar.particle_ege']) {
      const tpls = await repo.listContentTemplates({ action: 'generate_quiz', language: 'ko', skillId: skill });
      if (!isOk(tpls)) continue;
      for (const row of tpls.value ?? []) {
        const base = ((row.payload ?? {}) as { question?: Record<string, unknown> }).question;
        if (base && typeof base === 'object' && base.content) {
          flexSeen.add(String(base.content));
        }
      }
    }
    expect(flexSeen.size).toBeGreaterThanOrEqual(8);
  });
});
