import { z } from 'zod';
import { ExerciseGradeSchema, type ExerciseGrade } from './textbook-practice.js';

const text = z.string().trim().min(1).max(12000);
const id = z.string().trim().min(1).max(200);
export const BankCategorySchema = z.enum(['VOCABULARY', 'GRAMMAR', 'READING', 'CLOZE', 'LISTENING', 'WRITING']);
export const BankAnswerTypeSchema = z.enum(['MULTIPLE_CHOICE', 'FILL_BLANK', 'REORDER', 'SHORT_ANSWER', 'TRANSLATION', 'WRITING']);
export const GenerationLevelSchema = z.enum(['N5', 'N4', 'N3', 'N2', 'N1', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'TOPIK_1', 'TOPIK_2', 'TOPIK_3', 'TOPIK_4', 'TOPIK_5', 'TOPIK_6']);
export const GenerationScopeSchema = z.object({ documentId: id, chapterId: id }).strict();
export const GenerationConfigSchema = z.object({
  language: z.enum(['ja', 'en', 'ko']), targetLevel: GenerationLevelSchema,
  modelId: id, promptVersion: id,
  runtimeId: z.string().trim().min(1).max(60).optional(),
  maxQuestions: z.number().int().min(1).max(100),
  categoryLimits: z.record(BankCategorySchema, z.number().int().min(0).max(100)),
  allowedAnswerTypes: z.array(BankAnswerTypeSchema).min(1).max(6),
  maxDifficultyTier: z.number().int().min(1).max(5),
  maxAudio: z.number().int().min(0).max(20), maxAudioAttempts: z.number().int().min(0).max(100),
  maxPapers: z.number().int().min(1).max(20), maxPaperItems: z.number().int().min(1).max(100),
  textbookScopes: z.array(GenerationScopeSchema).max(20),
  audio: z.object({ providerId: id, modelId: id, maleVoice: id, femaleVoice: id, narratorVoice: id,
    speed: z.number().min(0.5).max(2), timeoutMs: z.number().int().min(100).max(120000) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const valid = value.language === 'ja' ? /^N[1-5]$/ : value.language === 'en' ? /^[ABC][12]$/ : /^TOPIK_[1-6]$/;
  if (!valid.test(value.targetLevel)) ctx.addIssue({ code: 'custom', path: ['targetLevel'], message: 'Level must match the language.' });
  if (value.maxAudio > 0 && !value.audio) ctx.addIssue({ code: 'custom', path: ['audio'], message: 'Audio quota requires configured voices and provider.' });
  if (value.maxAudioAttempts < value.maxAudio) ctx.addIssue({ code: 'custom', path: ['maxAudioAttempts'], message: 'Audio attempt quota cannot be less than the audio asset quota.' });
  if (!Object.values(value.categoryLimits).some(n => (n ?? 0) > 0)) ctx.addIssue({ code: 'custom', path: ['categoryLimits'], message: 'At least one category must be allowed.' });
});
export type GenerationConfig = z.infer<typeof GenerationConfigSchema>;
export type BankCategory = z.infer<typeof BankCategorySchema>;
export type BankAnswerType = z.infer<typeof BankAnswerTypeSchema>;

const answer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MULTIPLE_CHOICE'), options: z.array(z.object({ key: id, text }).strict()).min(2).max(8), correctKey: id }).strict(),
  z.object({ type: z.literal('FILL_BLANK'), acceptedAnswers: z.array(text).min(1).max(10) }).strict(),
  z.object({ type: z.literal('REORDER'), chunks: z.array(text).min(2).max(30), correctOrder: z.array(z.number().int().min(0)).min(2).max(30) }).strict(),
  z.object({ type: z.literal('SHORT_ANSWER'), referenceAnswer: text, rubric: text }).strict(),
  z.object({ type: z.literal('TRANSLATION'), referenceAnswer: text, rubric: text, targetLanguage: z.enum(['zh', 'ja', 'en', 'ko']) }).strict(),
  z.object({ type: z.literal('WRITING'), sampleAnswer: text, rubric: text, minWords: z.number().int().min(0).max(5000), maxWords: z.number().int().min(1).max(5000) }).strict(),
]);
export const BankMaterialSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('READING'), title: text, text }).strict(),
  z.object({ type: z.literal('LISTENING'), title: text, mode: z.enum(['DIALOGUE', 'PASSAGE', 'NEWS']),
    turns: z.array(z.object({ speaker: z.enum(['MALE', 'FEMALE', 'NARRATOR']), text }).strict()).min(1).max(100),
    news: z.discriminatedUnion('kind', [z.object({ kind: z.literal('SIMULATED') }).strict(),
      z.object({ kind: z.literal('SOURCED'), sourceUrl: z.string().url().max(2000), publishedAt: z.string().datetime() }).strict()]).optional(),
  }).strict(),
]);
export type BankMaterial = z.infer<typeof BankMaterialSchema>;
export const BankQuestionDraftSchema = z.object({
  category: BankCategorySchema, targetLevel: GenerationLevelSchema,
  difficultyTier: z.number().int().min(1).max(5), difficultyReason: text,
  prompt: text, explanation: text, skillIds: z.array(id).min(1).max(20),
  answer, material: BankMaterialSchema.optional(), citations: z.array(GenerationScopeSchema).max(20),
}).strict().superRefine((q, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  if (q.answer.type === 'MULTIPLE_CHOICE') {
    const keys = q.answer.options.map(o => o.key);
    if (new Set(keys).size !== keys.length || !keys.includes(q.answer.correctKey)) issue(['answer'], 'Option keys must be unique and contain the answer.');
    if (new Set(q.answer.options.map(o => o.text.normalize('NFKC'))).size !== keys.length) issue(['answer', 'options'], 'Option texts must be distinct.');
  }
  if (q.answer.type === 'REORDER') {
    const { chunks, correctOrder } = q.answer;
    if (correctOrder.length !== chunks.length || new Set(correctOrder).size !== chunks.length || correctOrder.some(n => n >= chunks.length)) issue(['answer'], 'Order must be a permutation of all chunk indexes.');
  }
  if (q.answer.type === 'WRITING' && q.answer.minWords > q.answer.maxWords) issue(['answer'], 'Word limits are reversed.');
  if (q.category === 'WRITING' && q.answer.type !== 'WRITING') issue(['answer'], 'Writing requires a writing rubric.');
  if (q.category === 'LISTENING' && q.material?.type !== 'LISTENING') issue(['material'], 'Listening requires a script.');
  if (['READING', 'CLOZE'].includes(q.category) && q.material?.type !== 'READING') issue(['material'], 'Reading and cloze require a passage.');
  if (q.category !== 'LISTENING' && q.material?.type === 'LISTENING') issue(['material'], 'Listening scripts belong to listening questions.');
  if (q.material?.type === 'LISTENING') {
    const { mode, turns, news } = q.material;
    const speakers = new Set(turns.map(t => t.speaker));
    if (mode === 'DIALOGUE' && (speakers.size !== 2 || !speakers.has('MALE') || !speakers.has('FEMALE'))) issue(['material', 'turns'], 'Dialogue must use the configured male and female speakers only.');
    if (mode !== 'DIALOGUE' && (speakers.size !== 1 || !speakers.has('NARRATOR'))) issue(['material', 'turns'], 'Passage and news use the narrator.');
    if ((mode === 'NEWS') !== Boolean(news)) issue(['material', 'news'], 'Only news requires source or simulation metadata.');
    if (turns.reduce((n, t) => n + t.text.length, 0) > 12000) issue(['material', 'turns'], 'Script exceeds the length limit.');
  }
});
export type BankQuestionDraft = z.infer<typeof BankQuestionDraftSchema>;
export const SubmitBankQuestionsSchema = z.object({ requestKey: id, questions: z.array(BankQuestionDraftSchema).min(1).max(20) }).strict();
export const QueryBankSchema = z.object({ category: BankCategorySchema.optional(), answerType: BankAnswerTypeSchema.optional(),
  history: z.enum(['ALL', 'UNANSWERED', 'MISTAKES']).default('ALL'), offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(50).default(20) }).strict();
export const ReadGenerationTextbookSchema = z.object({ documentId: id, chapterId: id,
  kind: z.enum(['vocabulary', 'knowledge', 'articles', 'sentences', 'exercises', 'material']),
  offset: z.number().int().min(0).max(1000000).default(0), limit: z.number().int().min(1).max(30).default(10) }).strict();
export const GenerateBankAudioSchema = z.object({ materialId: id }).strict();
export const AssembleBankPaperSchema = z.object({ requestKey: id, title: text, questionIds: z.array(id).min(1).max(100) }).strict();
export type SubmitBankQuestions = z.infer<typeof SubmitBankQuestionsSchema>;
export type QueryBank = z.infer<typeof QueryBankSchema>;
export type ReadGenerationTextbook = z.infer<typeof ReadGenerationTextbookSchema>;
export type AssembleBankPaper = z.infer<typeof AssembleBankPaperSchema>;
export const GenerationListeningModeSchema = z.enum(['DIALOGUE', 'PASSAGE', 'NEWS']);
export type GenerationListeningMode = z.infer<typeof GenerationListeningModeSchema>;
/**
 * P1 精确组卷蓝图：与 GenerationConfig 的最大额度不同，这里是必须精确满足的要求。
 * totalItems 必须等于 categoryCounts 之和；若给出 listeningModes，其和必须等于 LISTENING 数量。
 * 仅表达宿主已校验的任务事实，不替代后端对最终试卷的核对。
 */
export const GenerationBlueprintSchema = z.object({
  totalItems: z.number().int().min(1).max(100),
  categoryCounts: z.record(BankCategorySchema, z.number().int().min(0).max(100)),
  listeningModes: z.record(GenerationListeningModeSchema, z.number().int().min(0).max(100)).optional(),
}).strict().superRefine((value, ctx) => {
  const categories = Object.values(value.categoryCounts);
  if (!categories.some(n => (n ?? 0) > 0)) ctx.addIssue({ code: 'custom', path: ['categoryCounts'], message: 'At least one category must be required.' });
  const sum = categories.reduce((n, c) => n + (c ?? 0), 0);
  if (sum !== value.totalItems) ctx.addIssue({ code: 'custom', path: ['totalItems'], message: 'totalItems must equal the sum of categoryCounts.' });
  if (value.listeningModes) {
    const listening = value.categoryCounts.LISTENING ?? 0;
    const modeSum = Object.values(value.listeningModes).reduce((n, c) => n + (c ?? 0), 0);
    if (modeSum !== listening) ctx.addIssue({ code: 'custom', path: ['listeningModes'], message: 'Listening mode counts must equal the LISTENING category count.' });
  }
});
export type GenerationBlueprint = z.infer<typeof GenerationBlueprintSchema>;
/**
 * P1 模型运行预算：全部由宿主执行，不在提示词里口头约束。
 * maxModelRounds 限制工具调用总数；maxRepairAttempts 限制失败工具结果总数；maxDurationMs 限制整轮墙钟时间。
 */
export const GenerationRunLimitsSchema = z.object({
  maxModelRounds: z.number().int().min(1).max(100).default(20),
  maxRepairAttempts: z.number().int().min(0).max(20).default(5),
  maxDurationMs: z.number().int().min(1000).max(600000).default(120000),
}).strict();
export type GenerationRunLimits = z.infer<typeof GenerationRunLimitsSchema>;
export const GenerationTaskStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']);
export type GenerationTaskStatus = z.infer<typeof GenerationTaskStatusSchema>;
export const CreateGenerationTaskSchema = z.object({
  taskId: id.optional(), userId: id, sessionId: id, turnId: id,
  config: GenerationConfigSchema, blueprint: GenerationBlueprintSchema.optional(),
  runLimits: GenerationRunLimitsSchema.optional(),
  objective: z.string().trim().max(2000).optional(),
  expiresAt: z.string().datetime().optional(),
}).strict();
export type CreateGenerationTask = z.infer<typeof CreateGenerationTaskSchema>;
export interface GenerationTaskUsage { usedQuestions: number; usedAudio: number; usedAudioAttempts: number; usedPapers: number }
export interface GenerationPaperSummary { paperId: string; title: string; questionIds: string[] }
export interface GenerationTaskSummary {
  taskId: string; status: GenerationTaskStatus; isExpired: boolean; expiresAt: string;
  language: GenerationConfig['language']; targetLevel: string;
  usedQuestions: number; usedPapers: number; paperCount: number;
}
export interface GenerationAudioSummary { materialId: string; mimeType: string; byteLength: number }
export interface GenerationTaskSnapshot {
  binding: GenerationBinding; status: GenerationTaskStatus; isExpired: boolean; expiresAt: string;
  config: GenerationConfig; blueprint: GenerationBlueprint | null; runLimits: GenerationRunLimits;
  objective: string | null;
  usage: GenerationTaskUsage; papers: GenerationPaperSummary[]; audio: GenerationAudioSummary[];
}
export interface GenerationPaperDetail { paperId: string; title: string; items: Array<BankQuestionRecord & { material: BankMaterial | null }> }
/**
 * P2 新题库作答边界：经试卷快照作答，判分与记录复用练习所有者。
 * 客观后端权威判分；主观先保存，再经显式批改入口提交结构化评分。
 */
export const BankAnswerSubmitSchema = z.object({
  submissionId: id, taskId: id, paperId: id, questionId: id,
  userAnswer: z.string().trim().min(1).max(10000),
  timeSpentMs: z.number().int().min(0).max(3600000).default(0),
}).strict();
export type BankAnswerSubmit = z.infer<typeof BankAnswerSubmitSchema>;
export const BankGradeSubmitSchema = z.object({
  submissionId: id, taskId: id, paperId: id,
  model: z.string().trim().min(1).max(128).optional(),
  effort: z.string().trim().min(1).max(32).optional(),
  runtimeId: z.string().trim().min(1).max(60).optional(),
}).strict();
export type BankGradeSubmit = z.infer<typeof BankGradeSubmitSchema>;
export const BankObjectiveAnswerResultSchema = z.object({
  submissionId: z.string(), questionId: z.string(),
  isCorrect: z.boolean(), score: z.number().min(0).max(1),
  correctAnswer: z.string(), explanation: z.string(),
  persistedToDb: z.literal(true),
}).strict();
export type BankObjectiveAnswerResult = z.infer<typeof BankObjectiveAnswerResultSchema>;
export const BankSubjectiveAnswerResultSchema = z.object({
  submissionId: z.string(), questionId: z.string(),
  status: z.enum(['SUBMITTED', 'GRADED', 'GRADING_FAILED']),
  isCorrect: z.boolean().optional(), score: z.number().min(0).max(1).optional(),
  gradingError: z.string().optional(),
  grading: ExerciseGradeSchema.optional(),
  persistedToDb: z.literal(true),
}).strict();
export type BankSubjectiveAnswerResult = z.infer<typeof BankSubjectiveAnswerResultSchema>;
export interface BankSubmissionRecord {
  submissionId: string; taskId: string; paperId: string; questionId: string;
  answerType: string; userAnswer: string;
  status: 'SUBMITTED' | 'GRADED' | 'GRADING_FAILED';
  isCorrect: boolean | null; score: number | null;
  timeSpentMs: number; attemptId: string | null; gradingError: string | null;
  model: string | null; adapter: string | null;
  grading: ExerciseGrade | null;
}
export interface GenerationBinding { taskId: string; userId: string; sessionId: string; turnId: string }
export interface BankQuestionRecord extends Omit<BankQuestionDraft, 'material'> {
  id: string; language: GenerationConfig['language']; materialId: string | null;
  levelSource: 'AI_ESTIMATE'; modelId: string; promptVersion: string;
  history: { attempts: number; wrongAttempts: number; hasMistake: boolean };
}
export interface BankSubmitReceipt { questionIds: string[]; materialIds: (string | null)[]; added: number; usedQuestions: number }
export interface BankPaperReceipt { paperId: string; questionIds: string[] }
export interface BankAudioReceipt { materialId: string; mimeType: string; byteLength: number }
