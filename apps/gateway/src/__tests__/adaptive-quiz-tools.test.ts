import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GenerateAdaptiveQuizTool } from '../modules/practice/tools/generate-adaptive-quiz.js';
import { GradeSubjectiveQuizTool } from '../modules/practice/tools/grade-subjective-quiz.js';
import { isOk } from '@lexdistill/shared';

describe('Adaptive Quiz Tools (M4)', () => {
  let repo: DrizzleLearnerRepository;
  let generateTool: GenerateAdaptiveQuizTool;
  let gradeTool: GradeSubjectiveQuizTool;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    generateTool = new GenerateAdaptiveQuizTool(repo);
    gradeTool = new GradeSubjectiveQuizTool(repo);
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  describe('GenerateAdaptiveQuizTool', () => {
    it('should generate targeted questions for specified weakness skill', async () => {
      const res = await generateTool.execute(
        {
          targetLanguage: 'ja',
          targetLevel: 'JLPT N3',
          weaknessSkillId: 'jp.particle.ni_vs_de',
          count: 1,
        },
        { userId: 'user_test', sessionId: 'sess_test' }
      );

      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.targetSkillId).toBe('jp.particle.ni_vs_de');
        expect(res.value.questions.length).toBe(1);
        const q = res.value.questions[0]!;
        expect(q.testedSkillId).toBe('jp.particle.ni_vs_de');
        expect(q.options?.length).toBeGreaterThan(0);
        expect(q.correctAnswer).toBe('で');
        expect(q.explanation).toContain('本を読む');
      }
    });

    it('should extract top weakness from learner profile if not specified', async () => {
      await repo.updateLearnerProfile('user_test', { targetLanguage: 'ja', learnerLevel: 'BEGINNER' });
      // 写入一个弱项画像
      await repo.saveSkillMetric('user_test', {
        id: 'jp.grammar.conditional_tara',
        dimension: 'GRAMMAR',
        name: '假定形「～たら」',
        proficiency: 0.45,
        totalAttempts: 5,
        correctAttempts: 2,
        consecutiveErrors: 3,
        status: 'WEAKNESS',
      });
      // 先讲后测：tara 讲义已学完，弱项靶向才放行（未学完走降级，另有单测）。
      await repo.completeLesson('user_test', 'jp.grammar.conditional_tara');

      const res = await generateTool.execute(
        {
          targetLanguage: 'ja',
          targetLevel: 'JLPT N3',
          count: 1,
        },
        { userId: 'user_test', sessionId: 'sess_test' }
      );

      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.targetSkillId).toBe('jp.grammar.conditional_tara');
        expect(res.value.adaptationReason).toContain('近期连续出错');
        expect(res.value.questions.length).toBe(1);
        expect(res.value.questions[0]?.correctAnswer).toBe('高かったら');
      }
    });

    it('难度门：NOVICE 超纲弱项降级（无讲义的不锁，只看档位）；自选不拦', async () => {
      // 使役态：INTERMEDIATE 起、无讲义 → NOVICE 只看档位降级
      await repo.saveSkillMetric('user_test', {
        id: 'jp.grammar.causative_active',
        dimension: 'GRAMMAR',
        name: '使役态',
        proficiency: 0.4,
        totalAttempts: 5,
        correctAttempts: 2,
        consecutiveErrors: 3,
        status: 'WEAKNESS',
      });
      await repo.setTrackLevel('user_test', 'ja', 'NOVICE');
      // 降级目标 ni_vs_de 的讲义先学完：本用例测“档位降级”，讲义锁另测。
      await repo.completeLesson('user_test', 'jp.particle.ni_vs_de');

      // 系统代选：弱项超纲 → 降级 ni_vs_de
      const gated = await generateTool.execute(
        { targetLanguage: 'ja', targetLevel: 'JLPT N5', count: 1 },
        { userId: 'user_test', sessionId: 'sess_test' }
      );
      expect(isOk(gated)).toBe(true);
      if (isOk(gated)) {
        expect(gated.value.targetSkillId).toBe('jp.particle.ni_vs_de');
        expect(gated.value.adaptationReason).toContain('超纲');
        expect(gated.value.questions.length).toBe(1);
      }

      // 用户自选：明确意图，不拦
      const explicit = await generateTool.execute(
        {
          targetLanguage: 'ja',
          targetLevel: 'JLPT N5',
          weaknessSkillId: 'jp.grammar.causative_active',
          count: 1,
        },
        { userId: 'user_test', sessionId: 'sess_test' }
      );
      expect(isOk(explicit)).toBe(true);
      if (isOk(explicit)) {
        expect(explicit.value.targetSkillId).toBe('jp.grammar.causative_active');
        expect(explicit.value.questions.length).toBe(1);
      }
    });

    it('讲义锁：锁定的画像弱项被跳过并注记，不直接推题', async () => {
      await repo.saveSkillMetric('user_test2', {
        id: 'jp.grammar.conditional_tara',
        dimension: 'GRAMMAR',
        name: '假定形「～たら」',
        proficiency: 0.45,
        totalAttempts: 5,
        correctAttempts: 2,
        consecutiveErrors: 3,
        status: 'WEAKNESS',
      });
      await repo.setTrackLevel('user_test2', 'ja', 'BEGINNER');
      // tara 讲义未学完（档位够），系统代选必须跳过
      const res = await generateTool.execute(
        { targetLanguage: 'ja', targetLevel: 'JLPT N4', count: 1 },
        { userId: 'user_test2', sessionId: 'sess_test' }
      );
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.targetSkillId).not.toBe('jp.grammar.conditional_tara');
        expect(res.value.adaptationReason).toContain('讲义还没学完');
      }
    });
  });

  describe('GradeSubjectiveQuizTool', () => {
    it('should grade perfect match as 100% correct with no mistake recorded', async () => {
      const res = await gradeTool.execute(
        {
          questionId: 'q_trans_01',
          prompt: '翻译：明天去图书馆。',
          standardAnswer: '明日図書館へ行きます。',
          userSubmission: '明日図書館へ行きます。',
          testedSkillId: 'jp.sentence.translation',
        },
        { userId: 'user_test', sessionId: 'sess_test' }
      );

      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.isCorrect).toBe(true);
        expect(res.value.score).toBe(100);
        expect(res.value.mistakeRecorded).toBe(false);
      }

      const mistakesRes = await repo.getMistakes('user_test');
      expect(isOk(mistakesRes)).toBe(true);
      if (isOk(mistakesRes)) {
        expect(mistakesRes.value.length).toBe(0);
      }
    });

    it('should diagnose missing particle with mother tongue interference analysis and record mistake', async () => {
      const res = await gradeTool.execute(
        {
          questionId: 'q_trans_02',
          prompt: '翻译：在咖啡馆看书。',
          standardAnswer: 'カフェで本を読みます。',
          userSubmission: 'カフェ本を読みます。', // 漏掉了格助词「で」
          testedSkillId: 'jp.particle.ni_vs_de',
        },
        { userId: 'user_test', sessionId: 'sess_test' }
      );

      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.isCorrect).toBe(false);
        expect(res.value.score).toBeLessThan(80);
        expect(res.value.errorDiagnosis?.category).toBe('PARTICLE');
        expect(res.value.errorDiagnosis?.motherTongueInterference).toContain('汉语是孤立语');
        expect(res.value.mistakeRecorded).toBe(true);
      }

      // 验证自动落库至 SQLite 错题本
      const mistakesRes = await repo.getMistakes('user_test');
      expect(isOk(mistakesRes)).toBe(true);
      if (isOk(mistakesRes)) {
        expect(mistakesRes.value.length).toBe(1);
        expect(mistakesRes.value[0]?.questionId).toBe('q_trans_02');
        expect(mistakesRes.value[0]?.lastUserSubmission).toBe('カフェ本を読みます。');
      }
    });

    it('should diagnose tense mismatch with mother tongue interference analysis', async () => {      const res = await gradeTool.execute(
        {
          questionId: 'q_trans_03',
          prompt: '翻译：昨天买了新书。',
          standardAnswer: '昨日新しい本を買いました。',
          userSubmission: '昨日新しい本を買う。', // 过去时漏变
          testedSkillId: 'jp.grammar.tense',
        },
        { userId: 'user_test', sessionId: 'sess_test' }
      );

      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.isCorrect).toBe(false);
        expect(res.value.errorDiagnosis?.category).toBe('TENSE');
        expect(res.value.errorDiagnosis?.motherTongueInterference).toContain('中文通过副词');
      }
    });
  });
});
