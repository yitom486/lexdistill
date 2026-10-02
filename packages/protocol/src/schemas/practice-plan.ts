import { z } from 'zod';
import { QuizQuestionTypeSchema } from './quiz.js';

/**
 * P5：可配置多语种练习计划协议。
 *
 * 两层模型：用户保存可复用的 `PracticePlanTemplate`（长期配置），每天/每次「开始」
 * 从模板生成不可变的 `PracticePlanRun`（冻结当时 revision、题目、数量与批改模式），
 * 因此用户日后改模板不会污染历史 run。所有终态作答仍写入既有 `quiz_attempts`/错题/打卡，
 * 是学习画像与每日进度的唯一来源；计划 UI 不自行累计计数。
 *
 * AI 权限：AI 只能「提出建议」（learning.plan.propose），所有模板/计划变更必须由用户在 UI
 * 确认后 Gateway 才保存（apply 须携带确认令牌）。AI 不得通过自由文本直接写模板或改 FSRS/掌握度。
 */

// ---------- 枚举 ----------

/** 练习块类型（7 类） */
export const PracticeBlockKindSchema = z.enum([
  'VOCAB_REVIEW',
  'VOCAB_NEW',
  'QUIZ',
  'TRANSLATION',
  'DICTATION',
  'READING',
  'WRITING',
]);
export type PracticeBlockKind = z.infer<typeof PracticeBlockKindSchema>;

/** 批改模式（3 类） */
export const GradingModeSchema = z.enum(['AUTO_IMMEDIATE', 'AI_IMMEDIATE', 'AI_BATCH']);
export type GradingMode = z.infer<typeof GradingModeSchema>;

/** 词汇来源（VOCAB_REVIEW / VOCAB_NEW 块引用，不复制词典/闪卡数据） */
export const VocabularySourceSchema = z.enum(['DUE_CARDS', 'COLLECTED_WORDS', 'TOPIC_WORDS']);
export type VocabularySource = z.infer<typeof VocabularySourceSchema>;

/** 翻译方向：用结构化 source/target 描述，不写死「英译汉/汉译英」 */
export const TranslationDirectionSchema = z.object({
  sourceLanguage: z.string().min(2),
  targetLanguage: z.string().min(2),
});
export type TranslationDirection = z.infer<typeof TranslationDirectionSchema>;

/** 运行状态 */
export const PracticeRunStatusSchema = z.enum([
  'IN_PROGRESS',
  'GRADING',
  'COMPLETED',
  'ABANDONED',
]);
export type PracticeRunStatus = z.infer<typeof PracticeRunStatusSchema>;

/** 单题尝试状态 */
export const PracticeItemAttemptStatusSchema = z.enum([
  'PENDING',
  'DRAFT',
  'SUBMITTED',
  'GRADED',
  'GRADING',
  'GRADING_FAILED',
]);
export type PracticeItemAttemptStatus = z.infer<typeof PracticeItemAttemptStatusSchema>;

// ---------- 块与模板 ----------

/** 练习块规格（模板中的有序块） */
export const PracticeBlockSpecSchema = z.object({
  id: z.string().min(1),
  kind: PracticeBlockKindSchema,
  title: z.string().optional(),
  /** 题量 1–30；主观题批量上限 20 题（由领域层校验收紧） */
  count: z.number().int().min(1).max(30),
  difficulty: z.number().int().min(1).max(5).optional(),
  skillIds: z.array(z.string()).optional(),
  topic: z.string().optional(),
  questionFormats: z.array(QuizQuestionTypeSchema).optional(),
  translationDirection: TranslationDirectionSchema.optional(),
  vocabularySource: VocabularySourceSchema.optional(),
  gradingMode: GradingModeSchema,
});
export type PracticeBlockSpec = z.infer<typeof PracticeBlockSpecSchema>;

/**
 * P6-1：模板排程。
 * - daily：每日适用（缺省行为；模板无 schedule 字段时等价）；
 * - weekly：仅所列星期适用（0=周日 … 6=周六，至少 1 天）。
 * monthly 暂缓，不在本 schema 覆盖范围。
 */
export const PracticePlanScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }),
  z.object({
    kind: z.literal('weekly'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
]);
export type PracticePlanSchedule = z.infer<typeof PracticePlanScheduleSchema>;

/** 用户计划模板（长期配置，不等于今天的进度） */
export const PracticePlanTemplateSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  language: z.enum(['en', 'ja', 'ko']),
  name: z.string().min(1),
  enabled: z.boolean(),
  /** 模板修订号；每次保存递增。run 冻结时记录此值，改模板后旧 run 不变。 */
  revision: z.number().int().nonnegative(),
  blocks: z.array(PracticeBlockSpecSchema).min(1).max(8),
  /**
   * P6-1：排程（可选；缺省 = 每日适用，向后兼容）。
   * v1 仅 daily + weekly；monthly 暂缓。
   */
  schedule: PracticePlanScheduleSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PracticePlanTemplate = z.infer<typeof PracticePlanTemplateSchema>;

// ---------- 运行与尝试 ----------

/** 冻结的执行会话快照 */
export const PracticePlanRunSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  language: z.enum(['en', 'ja', 'ko']),
  /** 关联模板（可空，支持一次性自定义计划） */
  templateId: z.string().optional(),
  /** 冻结时的模板 revision（可空） */
  templateRevision: z.number().int().nonnegative().optional(),
  /** 冻结的块规格副本（改模板后不变） */
  blocks: z.array(PracticeBlockSpecSchema).min(1).max(8),
  status: PracticeRunStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  createdAt: z.string(),
});
export type PracticePlanRun = z.infer<typeof PracticePlanRunSchema>;

/** 单题尝试（草稿/已提交/已批改） */
export const PracticeItemAttemptSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  blockId: z.string().min(1),
  /** 关联 practice_items 的题目 id */
  itemId: z.string().min(1),
  status: PracticeItemAttemptStatusSchema,
  userAnswer: z.string().optional(),
  /** 批改结果 JSON（分数/诊断/润色等），由 learning.assess 产出 */
  gradingResult: z.record(z.string(), z.unknown()).optional(),
  timeSpentMs: z.number().int().nonnegative().optional(),
  submittedAt: z.string().optional(),
  gradedAt: z.string().optional(),
});
export type PracticeItemAttempt = z.infer<typeof PracticeItemAttemptSchema>;
