import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LESSON_SEEDS } from '@lexdistill/storage-sqlite';
import { N5_WORD_SEEDS } from '@lexdistill/storage-sqlite';

describe('curriculum lessons（先讲后测讲义）', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'lesson_user';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  it('种子 7 篇全入库：结构完整（讲解+例句+易错）', async () => {
    expect(LESSON_SEEDS.length).toBe(7);
    const res = await repo.listLessons(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.length).toBe(7);
    for (const l of res.value) {
      expect(l.skillId.length).toBeGreaterThan(0);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.sections.length).toBeGreaterThan(0);
      expect(l.examples.length).toBeGreaterThan(0);
      expect(l.pitfall.length).toBeGreaterThan(0);
      expect(l.completed).toBe(false);
    }
    // 覆盖题库真实考点：ni_vs_de 与 tara 必须有讲义
    const ids = res.value.map((l) => l.skillId);
    expect(ids).toContain('jp.particle.ni_vs_de');
    expect(ids).toContain('jp.grammar.conditional_tara');
  });

  it('学完打卡幂等：完成态回显 completedAt', async () => {
    const first = await repo.completeLesson(userId, 'jp.particle.ni_vs_de');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    const second = await repo.completeLesson(userId, 'jp.particle.ni_vs_de');
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.completedAt).toBe(first.value.completedAt);

    const list = await repo.listLessons(userId, 'ja');
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    const done = list.value.find((l) => l.skillId === 'jp.particle.ni_vs_de');
    expect(done?.completed).toBe(true);
    expect(done?.completedAt).toBe(first.value.completedAt);
    // 别人没学：进度按用户隔离
    const other = await repo.listLessons('other_user', 'ja');
    expect(isOk(other)).toBe(true);
    if (!isOk(other)) return;
    expect(other.value.find((l) => l.skillId === 'jp.particle.ni_vs_de')?.completed).toBe(false);
  });

  it('未知讲义拒绝（不臆造进度）', async () => {
    const res = await repo.completeLesson(userId, 'jp.grammar.not_exist');
    expect(isOk(res)).toBe(false);
  });

  it('门快照：档位 + 已学完 + 本轨道讲义一次取齐', async () => {
    await repo.setTrackLevel(userId, 'ja', 'NOVICE');
    await repo.completeLesson(userId, 'jp.particle.ni_vs_de');
    const gate = await repo.getStudyGate(userId, 'ja');
    expect(isOk(gate)).toBe(true);
    if (!isOk(gate)) return;
    expect(gate.value.level).toBe('NOVICE');
    expect(gate.value.completedSkills).toEqual(['jp.particle.ni_vs_de']);
    expect(gate.value.lessonSkills).toContain('jp.grammar.conditional_tara');
    expect(gate.value.lessonSkills.length).toBe(7);
  });
});

describe('N5 核心 100 词', () => {
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  it('100 词全入库：id 唯一、有读音、有释义', () => {
    expect(N5_WORD_SEEDS.length).toBe(100);
    const ids = N5_WORD_SEEDS.map((w) => w.id);
    expect(new Set(ids).size).toBe(100);
    for (const w of N5_WORD_SEEDS) {
      expect(w.headword.length).toBeGreaterThan(0);
      expect((w.reading ?? '').length).toBeGreaterThan(0);
      expect(w.meanings.length).toBeGreaterThan(0);
    }
    const count = repo
      .getRawDb()
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM local_dictionary_entries WHERE id LIKE 'n5_ja_%'"
      )
      .get()?.count;
    expect(count).toBe(100);
  });

  it('开箱可查可收：汉字表记 + 中文反查', async () => {
    const hit = await repo.searchLocalDictionary('ja', '食べる');
    expect(isOk(hit)).toBe(true);
    if (!isOk(hit)) return;
    expect(hit.value.some((e) => e.id === 'n5_ja_taberu')).toBe(true);
    const reverse = await repo.searchLocalDictionary('ja', '牛奶');
    expect(isOk(reverse)).toBe(true);
    if (!isOk(reverse)) return;
    expect(reverse.value.some((e) => e.id === 'n5_ja_gyuunyuu')).toBe(true);
    const collected = await repo.collectDictionaryEntry('u_n5', 'n5_ja_taberu');
    expect(isOk(collected)).toBe(true);
  });
});
