import { z } from 'zod';

export const QuizQuestionTypeSchema = z.enum([
  'MULTIPLE_CHOICE',
  'FILL_IN_BLANK',
  'SENTENCE_REORDER',
  'TRANSLATION',
  'LISTENING_DICTATION',
]);
export type QuizQuestionType = z.infer<typeof QuizQuestionTypeSchema>;

/** 前端做题台历史题型枚举（与 protocol 并存，经映射表互通） */
export const UiQuizQuestionTypeSchema = z.enum(['CHOICE', 'FILL_BLANK', 'REORDER']);
export type UiQuizQuestionType = z.infer<typeof UiQuizQuestionTypeSchema>;

/**
 * Protocol ↔ UI 题型双向映射。
 * 协议侧：MULTIPLE_CHOICE / FILL_IN_BLANK / SENTENCE_REORDER
 * UI 侧：CHOICE / FILL_BLANK / REORDER
 */
export function toUiQuizType(type: string): UiQuizQuestionType {
  switch (type) {
    case 'FILL_IN_BLANK':
    case 'FILL_BLANK':
      return 'FILL_BLANK';
    case 'SENTENCE_REORDER':
    case 'REORDER':
      return 'REORDER';
    case 'MULTIPLE_CHOICE':
    case 'CHOICE':
    default:
      return 'CHOICE';
  }
}

export function toProtocolQuizType(
  type: string
): Extract<QuizQuestionType, 'MULTIPLE_CHOICE' | 'FILL_IN_BLANK' | 'SENTENCE_REORDER'> {
  switch (type) {
    case 'FILL_BLANK':
    case 'FILL_IN_BLANK':
      return 'FILL_IN_BLANK';
    case 'REORDER':
    case 'SENTENCE_REORDER':
      return 'SENTENCE_REORDER';
    case 'CHOICE':
    case 'MULTIPLE_CHOICE':
    default:
      return 'MULTIPLE_CHOICE';
  }
}

export const GeneratedQuestionSchema = z.object({
  id: z.string(),
  type: QuizQuestionTypeSchema,
  prompt: z.string(),
  content: z.string(),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string(),
  acceptableVariants: z.array(z.string()).optional(),
  explanation: z.string(),
  testedSkillId: z.string(),
  difficultyTier: z.number().min(1).max(5).default(3),
  /**
   * P5-E8：听写题完整语料（TTS 播 fullJapanese，UI 可展示挖空提示；答案永不入此结构）。
   */
  dictation: z
    .object({
      fullJapanese: z.string(),
      speaker: z.string().optional(),
      chinese: z.string().optional(),
      furiganaHint: z.string().optional(),
    })
    .optional(),
  /**
   * P5-E9：阅读块题目携带的篇目引用（Runner 渲染可折叠篇目面板）。
   */
  reading: z
    .object({
      setId: z.string(),
      title: z.string(),
      body: z.string(),
    })
    .optional(),
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const QuizSubmitPayloadSchema = z.object({
  questionId: z.string(),
  userSubmission: z.string(),
  timeSpentMs: z.number().nonnegative(),
});
export type QuizSubmitPayload = z.infer<typeof QuizSubmitPayloadSchema>;

export const ObjectiveAnswerInputSchema = z.object({
  submissionId: z.string().min(1).max(120),
  questionId: z.string().min(1),
  language: z.enum(['en', 'ja', 'ko']),
  userAnswer: z.string().trim().min(1).max(10000),
  timeSpentMs: z.number().int().nonnegative(),
});
export type ObjectiveAnswerInput = z.infer<typeof ObjectiveAnswerInputSchema>;

export const ObjectiveAnswerResultSchema = z.object({
  submissionId: z.string(),
  questionId: z.string(),
  isCorrect: z.boolean(),
  score: z.number().min(0).max(1),
  correctAnswer: z.string(),
  explanation: z.string(),
  persistedToDb: z.literal(true),
});
export type ObjectiveAnswerResult = z.infer<typeof ObjectiveAnswerResultSchema>;

export const ErrorDiagnosisSchema = z.object({
  category: z.enum([
    'PARTICLE',
    'TENSE',
    'WORD_CHOICE',
    'SYNTAX',
    'COLLOCATION',
    'PRONUNCIATION',
    'OTHER',
  ]),
  description: z.string(),
  motherTongueInterference: z.string().optional(),
});
export type ErrorDiagnosis = z.infer<typeof ErrorDiagnosisSchema>;

export const QuizGradingResultSchema = z.object({
  questionId: z.string(),
  isCorrect: z.boolean(),
  score: z.number().min(0).max(100),
  correctAnswer: z.string(),
  userSubmission: z.string(),
  explanation: z.string(),
  errorDiagnosis: ErrorDiagnosisSchema.optional(),
  refinementSuggestion: z.string().optional(),
  followUpTip: z.string().optional(),
  mistakeRecorded: z.boolean().default(false),
});
export type QuizGradingResult = z.infer<typeof QuizGradingResultSchema>;
