import { describe, expect, it, spyOn } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningContentTool } from '../modules/learning-content/public.js';

describe('learning.content hangul_drill', () => {
  it('builds jamo-to-romanization questions from curriculum_hangul without LLM', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const tool = new LearningContentTool(repo);
    const res = await tool.execute(
      { action: 'hangul_drill', count: 3 },
      { userId: 'u_hangul_drill', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.language).toBe('ko');
    const questions = res.value.questions ?? [];
    expect(questions.length).toBe(3);
    const ids = new Set(questions.map((q) => q.content));
    expect(ids.size).toBe(3);
    for (const q of questions) {
      expect(q.type).toBe('MULTIPLE_CHOICE');
      expect(q.options?.length).toBe(4);
      expect(q.options).toContain(q.correctAnswer);
      expect(q.testedSkillId.startsWith('ko.hangul.')).toBe(true);
    }
  });

  it('never emits duplicate options for cross-type homophones (ㅋ k vs 收音 ㄱ k)', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const tool = new LearningContentTool(repo);
    // 最小池：同音孪生对 + 两个填充项；count 拉满使孪生双方必为题干（去重前必现重复选项）
    repo.getRawDb().run('DELETE FROM curriculum_hangul');
    const insert = repo.getRawDb().prepare(
      `INSERT INTO curriculum_hangul (
        id, type, jamo, name, romanization, row, col, mnemonic, audio_text, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const rows: Array<[string, string, string, string, string, string, string, null, string, number]> = [
      ['twin_k', 'CONSONANT', 'ㅋ', '키읔', 'k', '자음', '软腭音', null, 'ㅋ', 1],
      ['twin_coda', 'CODA', 'ㄱ', '기역 · 받침', 'k', '받침', '代表音 k', null, 'ㄱ', 2],
      ['fill_a', 'VOWEL', 'ㅏ', '아', 'a', '모음', '天·地·人', null, 'ㅏ', 3],
      ['fill_m', 'CONSONANT', 'ㅁ', '미음', 'm', '자음', '唇音', null, 'ㅁ', 4],
      ['fill_o', 'VOWEL', 'ㅗ', '오', 'o', '모음', '天·地·人', null, 'ㅗ', 5],
      ['fill_n', 'CONSONANT', 'ㄴ', '니은', 'n', '자음', '舌尖音', null, 'ㄴ', 6],
    ];
    for (const r of rows) insert.run(...r);
    const res = await tool.execute(
      { action: 'hangul_drill', count: 6 },
      { userId: 'u_hangul_drill', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const questions = res.value.questions ?? [];
    expect(questions.length).toBe(6);
    for (const q of questions) {
      expect(new Set(q.options).size).toBe(4);
      expect(q.options?.filter((o) => o === q.correctAnswer).length).toBe(1);
    }
  });

  it('samples without replacement even with repeated random values and distinguishes consonants from codas', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const random = spyOn(Math, 'random').mockReturnValue(0);
    try {
      const curriculum = await repo.getCurriculumHangul();
      expect(isOk(curriculum)).toBe(true);
      if (!isOk(curriculum)) return;
      const result = await new LearningContentTool(repo).execute(
        { action: 'hangul_drill', count: curriculum.value.length },
        { userId: 'u_hangul_unique', sessionId: 's1' },
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      const questions = result.value.questions ?? [];
      expect(questions.length).toBe(curriculum.value.length);
      expect(new Set(questions.map(question => question.content)).size).toBe(questions.length);
      const consonant = questions.find(question => question.content === '「ㄱ」');
      const coda = questions.find(question => question.content === '「ㄱ」 (收音)');
      expect(consonant?.correctAnswer).toBe('g');
      expect(coda?.correctAnswer).toBe('k');
    } finally {
      random.mockRestore();
      repo.getRawDb().close();
    }
  });
});
