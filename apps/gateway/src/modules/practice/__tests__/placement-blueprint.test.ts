import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { assemblePracticeRun } from '../application/practice-assembly.js';
import {
  ASSESSMENT_BLUEPRINT_VERSION,
  attributeGroup,
  blueprintFor,
} from '@study-studio/learning';

/** 阶段测评蓝图 v1：先定义考什么，再组卷；分项计分；覆盖不足只报告不判线。 */
describe('assessment blueprint', () => {
  it('三轨道 BEGINNER 蓝图总题 20，组题数吻合', () => {
    for (const track of ['ja', 'en', 'ko'] as const) {
      const bp = blueprintFor(track, 'BEGINNER');
      expect(bp).not.toBeNull();
      const sum = bp!.groups.reduce((s, g) => s + g.items, 0) + bp!.flexItems;
      expect(sum).toBe(20);
      expect(bp!.version).toBe(ASSESSMENT_BLUEPRINT_VERSION);
      expect(bp!.overallPass).toBe(0.8);
    }
    expect(blueprintFor('ja', 'NOVICE')).toBeNull();
    expect(blueprintFor('ja', 'INTERMEDIATE')?.groups.some((g) => g.key === 'causative')).toBe(true);
  });

  it('技能归属组；未知技能不硬归（走机动）', () => {
    const bp = blueprintFor('ja', 'BEGINNER')!;
    expect(attributeGroup(bp, 'jp.particle.ka')?.key).toBe('particle-basic');
    expect(attributeGroup(bp, 'jp.grammar.conditional_tara')?.key).toBe('tara');
    expect(attributeGroup(bp, 'xx.unknown') ).toBeNull();
    expect(attributeGroup(bp, null)).toBeNull();
  });
});

describe('placement exam v2（蓝图组卷 + 分项）', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'exam_v2_user';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  function seedPool(skill: string, id: string, n = 1) {
    const ps: Array<Promise<unknown>> = [];
    for (let i = 0; i < n; i++) {
      ps.push(
        repo.saveQuestion({
          id: `${id}_${i}`,
          userId,
          type: 'CHOICE',
          category: 'exam',
          prompt: `prompt ${id} ${i}`,
          content: `content ${id} ${i}`,
          correctAnswer: 'a',
          explanation: 'x',
          testedSkillId: skill,
          difficulty: 3,
          language: 'en',
        })
      );
    }
    return Promise.all(ps);
  }

  it('开考冻结蓝图；组卷按组取数；交卷给分项', async () => {
    // 池补足机动与组缺口（模板现货 12 + 池 8 = 20 去重题）
    await seedPool('en.grammar.subjunctive', 'ps', 3);
    await seedPool('en.grammar.inversion', 'pi', 2);
    await seedPool('en.vocab.review', 'pv', 3);
    const started = await repo.startPlacementExam(userId, 'en', 'BEGINNER');
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;
    expect(started.value.exam.blueprint?.version).toBe('v1');
    expect(started.value.exam.blueprint?.groups.length).toBe(3);

    const asm = await assemblePracticeRun(repo, userId, started.value.runId);
    expect(isOk(asm)).toBe(true);
    if (!isOk(asm)) return;
    expect(asm.value.totalItems).toBe(20);

    const items = await repo.getPracticeRunItems(userId, started.value.runId);
    expect(isOk(items)).toBe(true);
    if (!isOk(items)) return;
    expect(items.value.length).toBe(20);
    // 去重：内容两两不同（重复题不进考卷）
    const keys = items.value.map((it) => `${it.question.content}||${it.question.correctAnswer}`);
    expect(new Set(keys).size).toBe(20);

    // 17 对 3 错（inv 组内第 3 题错 1，article 组内第 1/3 题错 2 → article 组线挂；总分 0.85 过总分线）
    const seenBySkill = new Map<string, number>();
    for (const it of items.value) {
      const skill = String(it.question.testedSkillId ?? '');
      const idx = seenBySkill.get(skill) ?? 0;
      seenBySkill.set(skill, idx + 1);
      const wrong =
        (skill === 'en.grammar.inversion' && idx === 2) ||
        (skill === 'en.grammar.article' && (idx === 0 || idx === 2));
      const s = await repo.submitPracticeItem(userId, started.value.runId, it.itemId, wrong ? 'WRONG' : String(it.question.correctAnswer ?? 'a'), {
        isCorrect: !wrong,
        score: wrong ? 0 : 1,
      });
      expect(isOk(s)).toBe(true);
    }
    const fin = await repo.finishPlacementExam(userId, started.value.exam.id);
    expect(isOk(fin)).toBe(true);
    if (!isOk(fin)) return;
    expect(fin.value.graded).toBe(20);
    expect(fin.value.blueprintVersion).toBe('v1');
    expect(fin.value.groups.length).toBe(3);
    // 整卷去重 20 道（机动重复也可见；本卷无重复）
    expect(fin.value.distinctItems).toBe(20);
    const subj = fin.value.groups.find((g) => g.key === 'subjunctive')!;
    expect(subj.met).toBe(true);
    // 总分 16/20 = 0.8 过总分线，但 article 组线挂 → 不通过（分项一票否决如实上报）
    expect(fin.value.passed).toBe(false);
    const art = fin.value.groups.find((g) => g.key === 'article')!;
    expect(art.met).toBe(false);
  });

  it('全对通过并写档', async () => {
    await seedPool('en.grammar.subjunctive', 'ps', 3);
    await seedPool('en.grammar.inversion', 'pi', 2);
    await seedPool('en.vocab.review', 'pv', 3);
    const started = await repo.startPlacementExam(userId, 'en', 'BEGINNER');
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;
    const asm = await assemblePracticeRun(repo, userId, started.value.runId);
    expect(isOk(asm)).toBe(true);
    if (!isOk(asm)) return;
    const items = await repo.getPracticeRunItems(userId, started.value.runId);
    expect(isOk(items)).toBe(true);
    if (!isOk(items)) return;
    for (const it of items.value) {
      await repo.submitPracticeItem(userId, started.value.runId, it.itemId, 'a', {
        isCorrect: true,
        score: 1,
      });
    }
    const fin = await repo.finishPlacementExam(userId, started.value.exam.id);
    expect(isOk(fin)).toBe(true);
    if (!isOk(fin)) return;
    expect(fin.value.passed).toBe(true);
    expect(fin.value.level).toBe('BEGINNER');
    expect(fin.value.groups.every((g) => g.thin || g.met)).toBe(true);
  });

  it('题量不足直接阻断晋级（不得跳过缩小分母）', async () => {
    // 删掉 subj 模板：subj 组 0 题（未覆盖），其余照常
    repo
      .getRawDb()
      .query("DELETE FROM learning_content_templates WHERE skill_id = 'en.grammar.subjunctive'")
      .run();
    await seedPool('en.vocab.review', 'pv', 12);
    const started = await repo.startPlacementExam(userId, 'en', 'BEGINNER');
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;
    const asm = await assemblePracticeRun(repo, userId, started.value.runId);
    expect(isOk(asm)).toBe(true);
    if (!isOk(asm)) return;
    const items = await repo.getPracticeRunItems(userId, started.value.runId);
    expect(isOk(items)).toBe(true);
    if (!isOk(items)) return;
    expect(items.value.length).toBe(20);
    for (const it of items.value) {
      await repo.submitPracticeItem(userId, started.value.runId, it.itemId, 'a', {
        isCorrect: true,
        score: 1,
      });
    }
    const fin = await repo.finishPlacementExam(userId, started.value.exam.id);
    expect(isOk(fin)).toBe(true);
    if (!isOk(fin)) return;
    // 总分 100% 也不可晋级：subj 组无有效题目
    expect(fin.value.passed).toBe(false);
    expect(fin.value.uncoveredGroups).toContain('subjunctive');
    expect(fin.value.failReasons.join('')).toContain('无有效题目');
  });

  it('重考换题面（同能力不同题，余量组轮换）', async () => {
    const jaUser = 'exam_retake_user';
    for (let i = 0; i < 15; i++) {
      await repo.recordKanaPractice(jaUser, `kana_a`, true, 'HIRAGANA');
    }
    await repo.saveQuestion({
      id: 'ja_flex_1',
      userId: jaUser,
      type: 'CHOICE',
      category: 'exam',
      prompt: 'p1',
      content: 'flex one',
      correctAnswer: 'a',
      explanation: 'x',
      testedSkillId: 'jp.vocab.review',
      difficulty: 2,
      language: 'ja',
    });
    await repo.saveQuestion({
      id: 'ja_flex_2',
      userId: jaUser,
      type: 'CHOICE',
      category: 'exam',
      prompt: 'p2',
      content: 'flex two',
      correctAnswer: 'a',
      explanation: 'x',
      testedSkillId: 'jp.vocab.review',
      difficulty: 2,
      language: 'ja',
    });
    const faces = async (): Promise<string[]> => {
      const started = await repo.startPlacementExam(jaUser, 'ja', 'BEGINNER');
      expect(isOk(started)).toBe(true);
      if (!isOk(started)) return [];
      const asm = await assemblePracticeRun(repo, jaUser, started.value.runId);
      expect(isOk(asm)).toBe(true);
      if (!isOk(asm)) return [];
      const items = await repo.getPracticeRunItems(jaUser, started.value.runId);
      expect(isOk(items)).toBe(true);
      if (!isOk(items)) return [];
      // 交卷（ni_vs_de 全错 + dest 错 → particle 组 4/8 未达线，总分 16/20 仍过线，看分项一票否决）
      for (const it of items.value) {
        const skill = String(it.question.testedSkillId ?? '');
        const wrong = skill === 'jp.particle.ni_vs_de' || skill === 'jp.particle.destination_ni';
        await repo.submitPracticeItem(jaUser, started.value.runId, it.itemId, 'x', {
          isCorrect: !wrong,
          score: wrong ? 0 : 1,
        });
      }
      const fin = await repo.finishPlacementExam(jaUser, started.value.exam.id);
      expect(isOk(fin)).toBe(true);
      if (!isOk(fin)) return [];
      expect(fin.value.passed).toBe(false);
      return items.value
        .filter((it) => String(it.question.testedSkillId ?? '').includes('particle'))
        .map((it) => String(it.question.content ?? ''));
    };
    const first = await faces();
    expect(first.length).toBeGreaterThan(0);
    const second = await faces();
    expect(second.length).toBeGreaterThan(0);
    // 余量组轮换：两次 particle 题面序列不同（同能力不同题；总数可能因余量组合而异）
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  });
});
