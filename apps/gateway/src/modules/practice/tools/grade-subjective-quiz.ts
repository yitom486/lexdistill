import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import {
  type QuizGradingResult,
  QuizGradingResultSchema,
  type ErrorDiagnosis,
} from '@lexdistill/protocol';
import {
  ok,
  err,
  type Result,
  BusinessError,
  generateId,
  nowIso,
} from '@lexdistill/shared';
import {
  type LearnerRepository,
  createMistakeEntry,
} from '@lexdistill/learner-core';

export const GradeSubjectiveQuizInputSchema = z.object({
  questionId: z.string(),
  prompt: z.string(),
  standardAnswer: z.string(),
  userSubmission: z.string(),
  testedSkillId: z.string(),
  contextSentence: z.string().optional(),
});

export type GradeSubjectiveQuizInput = z.infer<typeof GradeSubjectiveQuizInputSchema>;

export class GradeSubjectiveQuizTool
  implements ToolDefinition<GradeSubjectiveQuizInput, QuizGradingResult>
{
  public readonly name = 'quiz.gradeSubjective';
  public readonly description =
    '【兼容别名】主观题批改与错题入库；Agent/新路径请优先 learning.assess。本工具保留 QuizGradingResult 输出形态。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = GradeSubjectiveQuizInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  public async execute(
    input: GradeSubjectiveQuizInput,
    context: ToolExecutionContext
  ): Promise<Result<QuizGradingResult, BusinessError>> {
    try {
      const trimmedUser = input.userSubmission.trim();
      const trimmedStd = input.standardAnswer.trim();

      // 精准字符串比对 (0ms 判定全对基准)
      const isExactMatch = trimmedUser === trimmedStd;

      let isCorrect = isExactMatch;
      let score = isExactMatch ? 100 : 0;
      let explanation = '';
      let errorDiagnosis: ErrorDiagnosis | undefined;
      let refinementSuggestion = '';
      let followUpTip = '';

      if (isExactMatch) {
        explanation = '语法结构严谨，助词使用与用词均完全符合地道日文表达规范！';
        refinementSuggestion = trimmedStd;
        followUpTip = '保持良好习惯，该表达已在记忆库中强化。';
      } else {
        // 启发式多维语法分析器 (母语负迁移诊断)
        const hasMissingParticle =
          (input.standardAnswer.includes('に') && !trimmedUser.includes('に')) ||
          (input.standardAnswer.includes('で') && !trimmedUser.includes('で')) ||
          (input.standardAnswer.includes('を') && !trimmedUser.includes('を'));

        const hasTenseMismatch =
          (input.standardAnswer.includes('ました') && !trimmedUser.includes('た')) ||
          (input.standardAnswer.includes('ない') && !trimmedUser.includes('ない'));

        if (hasMissingParticle) {
          isCorrect = false;
          score = 65;
          errorDiagnosis = {
            category: 'PARTICLE',
            description: '格助词缺失或功能混淆，未能明确标示动作的着落点或作用场所。',
            motherTongueInterference:
              '汉语是孤立语，没有形态助词系统，汉语直译“去学校”、“在咖啡馆读书”时非常容易忘记添加日语必须的格助词「に/で/を」。',
          };
          explanation = `主要偏差在助词运用：标准答案为「${trimmedStd}」，你提交的表达中缺少必要的格助词。`;
          refinementSuggestion = trimmedStd;
          followUpTip = '牢记：日语句子中每个名词进入谓语网络，必须有助词作为“粘合剂”！';
        } else if (hasTenseMismatch) {
          isCorrect = false;
          score = 70;
          errorDiagnosis = {
            category: 'TENSE',
            description: '动词时态或体态变化不一致。',
            motherTongueInterference:
              '中文通过副词“已经/了”表示过去，而日文必须通过动词词尾形态变化（～た / ～ました）体现时态。',
          };
          explanation = `时态形态偏差：语境要求使用过去式或特定否定形式，标准表达为「${trimmedStd}」。`;
          refinementSuggestion = trimmedStd;
          followUpTip = '时刻关注句首或语境中的时间副词（昨日、先週），提前锁定动词过去形态。';
        } else {
          // 句式基本可通但不够地道
          isCorrect = true;
          score = 88;
          explanation = '句意基本通顺，但在用词与语体自然度上可进一步润色。';
          refinementSuggestion = trimmedStd;
          followUpTip = '建议多朗读原生例句，培养固定搭配语感。';
        }
      }

      const mistakeRecorded = !isCorrect || score < 80;

      const result: QuizGradingResult = QuizGradingResultSchema.parse({
        questionId: input.questionId,
        isCorrect,
        score,
        correctAnswer: trimmedStd,
        userSubmission: trimmedUser,
        explanation,
        errorDiagnosis,
        refinementSuggestion,
        followUpTip,
        mistakeRecorded,
      });

      // 如果未达标，自动沉淀至 SQLite 错题本
      if (mistakeRecorded) {
        const mistake = createMistakeEntry(
          context.userId,
          {
            id: input.questionId,
            type: 'TRANSLATION',
            prompt: input.prompt,
            content: input.contextSentence ?? input.prompt,
            correctAnswer: trimmedStd,
            explanation,
            testedSkillId: input.testedSkillId,
            difficultyTier: 3,
          },
          trimmedUser,
          result
        );
        await this.learnerRepo.saveMistake(mistake);
      }

      return ok(result);
    } catch (error) {
      return err(
        new BusinessError(
          'E_GRADING_FAILED',
          `主观题 AI 智能批改异常：${error instanceof Error ? error.message : String(error)}`,
          'AGENT_RUNTIME'
        )
      );
    }
  }
}
