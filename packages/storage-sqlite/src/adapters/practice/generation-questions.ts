import { generateId } from '@lexdistill/shared';
import { BankQuestionDraftSchema, type BankAnswerType, type BankQuestionRecord, type SubmitBankQuestions,
  type BankSubmitReceipt, type QueryBank, type AssembleBankPaper, type BankPaperReceipt } from '@lexdistill/protocol';
import { fingerprintCanonical } from '../../canonical-fingerprint.js';
import { assertAllowedChapter, countQuestions, receipt, reject, saveReceipt, type GenerationContext } from './generation-context.js';

export const answerTables: Record<BankAnswerType, string> = {
  MULTIPLE_CHOICE: 'bank_multiple_choice_questions', FILL_BLANK: 'bank_fill_blank_questions', REORDER: 'bank_reorder_questions',
  SHORT_ANSWER: 'bank_short_answer_questions', TRANSLATION: 'bank_translation_questions', WRITING: 'bank_writing_questions',
};
interface QuestionRow {
  id: string; language: BankQuestionRecord['language']; category: BankQuestionRecord['category']; answer_type: BankAnswerType;
  target_level: BankQuestionRecord['targetLevel']; difficulty_tier: number; difficulty_reason: string;
  prompt: string; explanation: string; skill_ids_json: string; citations_json: string; material_id: string | null;
  model_id: string; prompt_version: string; attempts: number; wrong_attempts: number; has_mistake: number;
}
const historySql = `SELECT q.*,
  (SELECT count(*) FROM quiz_attempts a WHERE a.user_id=q.user_id AND a.question_id=q.id AND a.language=q.language) AS attempts,
  (SELECT count(*) FROM quiz_attempts a WHERE a.user_id=q.user_id AND a.question_id=q.id AND a.language=q.language AND a.is_correct=0) AS wrong_attempts,
  (EXISTS(SELECT 1 FROM mistakes m WHERE m.user_id=q.user_id AND m.question_id=q.id AND m.language=q.language AND m.is_resolved=0)
    OR COALESCE((SELECT a.is_correct=0 FROM quiz_attempts a WHERE a.user_id=q.user_id AND a.question_id=q.id AND a.language=q.language ORDER BY a.created_at DESC,a.id DESC LIMIT 1),0)) AS has_mistake
  FROM bank_questions q`;
function asRecord(ctx: GenerationContext, row: QuestionRow): BankQuestionRecord {
  const detail = ctx.sqlite.query(`SELECT answer_json FROM ${answerTables[row.answer_type]} WHERE question_id=?`).get(row.id) as { answer_json: string } | null;
  if (!detail) reject('E_BANK_CORRUPT', '题目详情缺失，不能用于组卷');
  return { id: row.id, language: row.language, category: row.category, targetLevel: row.target_level,
    difficultyTier: row.difficulty_tier, difficultyReason: row.difficulty_reason, prompt: row.prompt, explanation: row.explanation,
    skillIds: JSON.parse(row.skill_ids_json), citations: JSON.parse(row.citations_json), answer: JSON.parse(detail.answer_json),
    materialId: row.material_id, levelSource: 'AI_ESTIMATE', modelId: row.model_id, promptVersion: row.prompt_version,
    history: { attempts: row.attempts, wrongAttempts: row.wrong_attempts, hasMistake: Boolean(row.has_mistake) } };
}
export function eligibleQuestion(ctx: GenerationContext, id: string): BankQuestionRecord {
  const row = ctx.sqlite.query(`${historySql} WHERE q.id=? AND q.user_id=? AND q.language=? AND q.status='VALIDATED' AND q.target_level=? AND q.difficulty_tier<=?`).get(
    id, ctx.binding.userId, ctx.config.language, ctx.config.targetLevel, ctx.config.maxDifficultyTier) as QuestionRow | null;
  if (!row || !ctx.config.categoryLimits[row.category] || !ctx.config.allowedAnswerTypes.includes(row.answer_type)) reject('E_BANK_SCOPE', '题目不属于当前用户、目标等级或允许题型');
  return asRecord(ctx, row);
}
export function queryQuestions(ctx: GenerationContext, input: QueryBank): { items: BankQuestionRecord[]; nextOffset: number | null } {
  const categories = Object.entries(ctx.config.categoryLimits).filter(([, n]) => n && n > 0).map(([k]) => k);
  const rows = ctx.sqlite.query(`${historySql} WHERE q.user_id=? AND q.language=? AND q.status='VALIDATED' AND q.target_level=? AND q.difficulty_tier<=?
    AND q.category IN (${categories.map(() => '?').join(',')}) AND q.answer_type IN (${ctx.config.allowedAnswerTypes.map(() => '?').join(',')}) AND (? IS NULL OR q.category=?) AND (? IS NULL OR q.answer_type=?)
    AND (?='ALL' OR (?='UNANSWERED' AND attempts=0) OR (?='MISTAKES' AND has_mistake=1))
    ORDER BY q.created_at,q.id LIMIT ? OFFSET ?`).all(ctx.binding.userId, ctx.config.language, ctx.config.targetLevel, ctx.config.maxDifficultyTier,
      ...categories, ...ctx.config.allowedAnswerTypes, input.category ?? null, input.category ?? null, input.answerType ?? null, input.answerType ?? null,
      input.history, input.history, input.history, input.limit + 1, input.offset) as QuestionRow[];
  return { items: rows.slice(0, input.limit).map(row => asRecord(ctx, row)), nextOffset: rows.length > input.limit ? input.offset + input.limit : null };
}
export function submitQuestions(ctx: GenerationContext, input: SubmitBankQuestions): BankSubmitReceipt {
  const previous = receipt<BankSubmitReceipt>(ctx, 'submit', input.requestKey, input);
  if (previous) return previous;
  const questionIds: string[] = [], materialIds: (string | null)[] = [];
  let added = 0;
  for (const draft of input.questions) {
    const q = BankQuestionDraftSchema.parse(draft);
    if (!ctx.config.categoryLimits[q.category] || !ctx.config.allowedAnswerTypes.includes(q.answer.type) || q.targetLevel !== ctx.config.targetLevel || q.difficultyTier > ctx.config.maxDifficultyTier) reject('E_GENERATION_CONFIG', '题型、等级或难度超出本次出题配置');
    if (q.skillIds.some(skill => !skill.startsWith(`${ctx.config.language}.`))) reject('E_GENERATION_CONFIG', '考点必须带有目标语言前缀，例如 en.grammar.past');
    for (const ref of q.citations) assertAllowedChapter(ctx, ref.documentId, ref.chapterId);
    const hash = fingerprintCanonical(q);
    const existing = ctx.sqlite.query('SELECT id,material_id FROM bank_questions WHERE user_id=? AND language=? AND fingerprint=?').get(ctx.binding.userId, ctx.config.language, hash) as { id: string; material_id: string | null } | null;
    let questionId = existing?.id, materialId = existing?.material_id ?? null;
    if (!questionId) {
      if (q.material) {
        const materialHash = fingerprintCanonical(q.material);
        const priorMaterial = ctx.sqlite.query('SELECT id FROM bank_materials WHERE user_id=? AND language=? AND fingerprint=?').get(ctx.binding.userId, ctx.config.language, materialHash) as { id: string } | null;
        materialId = priorMaterial?.id ?? generateId();
        if (!priorMaterial) {
          ctx.sqlite.query('INSERT INTO bank_materials VALUES (?,?,?,?,?,?)').run(materialId, ctx.binding.userId, ctx.config.language, q.material.type, materialHash, new Date().toISOString());
          const table = q.material.type === 'READING' ? 'bank_reading_materials' : 'bank_listening_materials';
          ctx.sqlite.query(`INSERT INTO ${table} (material_id,content_json) VALUES (?,?)`).run(materialId, JSON.stringify(q.material));
        }
      }
      questionId = generateId();
      ctx.sqlite.query(`INSERT INTO bank_questions (id,user_id,language,category,answer_type,target_level,difficulty_tier,difficulty_reason,
        level_source,status,prompt,explanation,skill_ids_json,citations_json,material_id,fingerprint,model_id,prompt_version,created_at)
        VALUES (?,?,?,?,?,?,?,?,'AI_ESTIMATE','VALIDATED',?,?,?,?,?,?,?,?,?)`).run(questionId, ctx.binding.userId, ctx.config.language,
          q.category, q.answer.type, q.targetLevel, q.difficultyTier, q.difficultyReason, q.prompt, q.explanation, JSON.stringify(q.skillIds),
          JSON.stringify(q.citations), materialId, hash, ctx.config.modelId, ctx.config.promptVersion, new Date().toISOString());
      ctx.sqlite.query(`INSERT INTO ${answerTables[q.answer.type]} (question_id,answer_json) VALUES (?,?)`).run(questionId, JSON.stringify(q.answer));
      added++;
    }
    ctx.sqlite.query('INSERT OR IGNORE INTO generation_task_questions VALUES (?,?)').run(ctx.binding.taskId, questionId);
    questionIds.push(questionId); materialIds.push(materialId);
  }
  const usedQuestions = countQuestions(ctx);
  if (usedQuestions > ctx.config.maxQuestions) reject('E_GENERATION_QUOTA', '本次出题总额度已用完，本批次已撤回');
  const counts = ctx.sqlite.query(`SELECT q.category,count(*) AS n FROM generation_task_questions t JOIN bank_questions q ON q.id=t.question_id
    WHERE t.task_id=? GROUP BY q.category`).all(ctx.binding.taskId) as { category: BankQuestionRecord['category']; n: number }[];
  if (counts.some(c => c.n > (ctx.config.categoryLimits[c.category] ?? 0))) reject('E_GENERATION_QUOTA', '本次题型额度已用完，本批次已撤回');
  const result = { questionIds, materialIds, added, usedQuestions };
  saveReceipt(ctx, 'submit', input.requestKey, input, result);
  return result;
}
export function assemblePaper(ctx: GenerationContext, input: AssembleBankPaper): BankPaperReceipt {
  const previous = receipt<BankPaperReceipt>(ctx, 'paper', input.requestKey, input);
  if (previous) return previous;
  if (input.questionIds.length > ctx.config.maxPaperItems || new Set(input.questionIds).size !== input.questionIds.length) reject('E_PAPER_ITEMS', '试卷题量超限或存在重复题目');
  const questions = input.questionIds.map(id => eligibleQuestion(ctx, id));
  const papers = (ctx.sqlite.query('SELECT count(*) AS n FROM bank_papers WHERE task_id=?').get(ctx.binding.taskId) as { n: number }).n;
  if (papers >= ctx.config.maxPapers) reject('E_GENERATION_QUOTA', '本次组卷额度已用完');
  const counts = new Map<BankQuestionRecord['category'], number>();
  for (const q of questions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  if ([...counts].some(([category, n]) => n > (ctx.config.categoryLimits[category] ?? 0))) reject('E_GENERATION_QUOTA', '试卷中某题型数量超出配置额度');
  const paperId = generateId();
  ctx.sqlite.query('INSERT INTO bank_papers VALUES (?,?,?,?,?)').run(paperId, ctx.binding.taskId, ctx.binding.userId, input.title, new Date().toISOString());
  for (const [ordinal, q] of questions.entries()) {
    let material: unknown = null;
    if (q.materialId) {
      const row = ctx.sqlite.query(`SELECT content_json FROM bank_reading_materials WHERE material_id=?
        UNION ALL SELECT content_json FROM bank_listening_materials WHERE material_id=?`).get(q.materialId, q.materialId) as { content_json: string } | null;
      if (!row) reject('E_BANK_CORRUPT', '试卷材料缺失');
      material = JSON.parse(row.content_json);
    }
    if (q.category === 'LISTENING') {
      const audio = ctx.sqlite.query("SELECT 1 FROM bank_audio_assets WHERE task_id=? AND material_id=? AND status='READY'").get(ctx.binding.taskId, q.materialId);
      if (!audio) reject('E_AUDIO_NOT_READY', '听力题必须先生成音频才能组卷');
    }
    ctx.sqlite.query('INSERT INTO bank_paper_items VALUES (?,?,?,?)').run(paperId, ordinal, q.id, JSON.stringify({ ...q, material, history: undefined }));
  }
  const result = { paperId, questionIds: input.questionIds };
  saveReceipt(ctx, 'paper', input.requestKey, input, result);
  return result;
}
