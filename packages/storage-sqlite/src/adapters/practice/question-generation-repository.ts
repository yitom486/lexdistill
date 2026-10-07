import type { Database } from 'bun:sqlite';
import { MIMEType } from 'node:util';
import { BusinessError, generateId } from '@study-studio/shared';
import { GenerationConfigSchema, SubmitBankQuestionsSchema, QueryBankSchema, ReadGenerationTextbookSchema, AssembleBankPaperSchema,
  BankMaterialSchema, GenerationBlueprintSchema, GenerationRunLimitsSchema,
  type GenerationBinding, type GenerationConfig, type BankAudioReceipt, type SubmitBankQuestions,
  type QueryBank, type ReadGenerationTextbook, type AssembleBankPaper, type GenerationBlueprint, type GenerationRunLimits,
  type GenerationTaskSnapshot, type GenerationPaperDetail, type BankSubmissionRecord, type GenerationTaskSummary } from '@study-studio/protocol';
import { canonicalJson } from '../../canonical-fingerprint.js';
import { assertChapter, countAudio, countQuestions, loadContext, readTextbook, reject, type GenerationContext } from './generation-context.js';
import { assemblePaper, queryQuestions, submitQuestions } from './generation-questions.js';

/** The host owns the connection. Every write rechecks scope inside an immediate transaction. */
export class SqliteQuestionGenerationRepository {
  constructor(private readonly sqlite: Database) {}
  private hasTaskExtraColumns(): boolean {
    try {
      const cols = this.sqlite.query("SELECT name FROM pragma_table_info('generation_tasks')").all() as { name: string }[];
      const names = new Set(cols.map(c => c.name));
      return names.has('blueprint_json') && names.has('limits_json');
    } catch { return false; }
  }
  private transaction<T>(binding: GenerationBinding, action: (ctx: GenerationContext) => T): T {
    return this.sqlite.transaction(() => action(loadContext(this.sqlite, binding))).immediate();
  }
  createTask(binding: GenerationBinding, rawConfig: GenerationConfig, expiresAt: string,
    extra?: { blueprint?: GenerationBlueprint | null; runLimits?: GenerationRunLimits | null; objective?: string | null }): void {
    const config = GenerationConfigSchema.parse(rawConfig);
    const blueprint = extra?.blueprint ? GenerationBlueprintSchema.parse(extra.blueprint) : null;
    const runLimits = extra?.runLimits ? GenerationRunLimitsSchema.parse(extra.runLimits) : null;
    const objective = extra?.objective?.trim() ? extra.objective.trim().slice(0, 2000) : null;
    if (Object.values(binding).some(v => !v.trim()) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) reject('E_GENERATION_CONFIG', '任务身份或过期时间不正确');
    const expiry = new Date(expiresAt).toISOString();
    const hasExtra = this.hasTaskExtraColumns();
    this.sqlite.transaction(() => {
      const old = this.sqlite.query('SELECT * FROM generation_tasks WHERE id=?').get(binding.taskId) as
        { user_id: string; session_id: string; turn_id: string; config_json: string; expires_at: string; blueprint_json?: string | null; limits_json?: string | null; objective_text?: string | null } | null;
      if (old) {
        if (old.user_id !== binding.userId || old.session_id !== binding.sessionId || old.turn_id !== binding.turnId || old.config_json !== canonicalJson(config) || old.expires_at !== expiry) reject('E_IDEMPOTENCY_CONFLICT', '已创建的任务不能替换身份、配置或有效期');
        if (hasExtra) {
          const oldBlueprint = old.blueprint_json ?? null;
          const newBlueprint = blueprint ? canonicalJson(blueprint) : null;
          const oldLimits = old.limits_json ?? null;
          const newLimits = runLimits ? canonicalJson(runLimits) : null;
          if (oldBlueprint !== newBlueprint || oldLimits !== newLimits || (old.objective_text ?? null) !== objective) reject('E_IDEMPOTENCY_CONFLICT', '已创建的任务不能替换蓝图、预算或目标');
        } else if (blueprint || runLimits || objective) reject('E_GENERATION_CONFIG', '当前数据库尚未升级到 v046，不能保存蓝图与预算');
        return;
      }
      for (const s of config.textbookScopes) assertChapter(this.sqlite, binding.userId, config.language, s.documentId, s.chapterId);
      if (hasExtra) {
        this.sqlite.query("INSERT INTO generation_tasks (id,user_id,session_id,turn_id,config_json,status,expires_at,created_at,blueprint_json,limits_json,objective_text) VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?,?)").run(binding.taskId, binding.userId, binding.sessionId,
          binding.turnId, canonicalJson(config), expiry, new Date().toISOString(),
          blueprint ? canonicalJson(blueprint) : null, runLimits ? canonicalJson(runLimits) : null, objective);
      } else {
        if (blueprint || runLimits || objective) reject('E_GENERATION_CONFIG', '当前数据库尚未升级到 v046，不能保存蓝图与预算');
        this.sqlite.query("INSERT INTO generation_tasks (id,user_id,session_id,turn_id,config_json,status,expires_at,created_at) VALUES (?,?,?,?,?,'ACTIVE',?,?)").run(binding.taskId, binding.userId, binding.sessionId,
          binding.turnId, canonicalJson(config), expiry, new Date().toISOString());
      }
    }).immediate();
  }
  config(binding: GenerationBinding) {
    return this.transaction(binding, ctx => ({ config: ctx.config, usedQuestions: countQuestions(ctx), usedAudio: countAudio(ctx),
      usedAudioAttempts: (ctx.sqlite.query('SELECT audio_attempts AS n FROM generation_tasks WHERE id=?').get(binding.taskId) as { n: number }).n,
      usedPapers: (ctx.sqlite.query('SELECT count(*) AS n FROM bank_papers WHERE task_id=?').get(binding.taskId) as { n: number }).n }));
  }
  finishTask(binding: GenerationBinding, status: 'COMPLETED' | 'CANCELLED'): void {
    if (status !== 'COMPLETED' && status !== 'CANCELLED') reject('E_GENERATION_CONFIG', '任务状态不正确');
    this.sqlite.transaction(() => {
      const task = this.sqlite.query('SELECT status,expires_at FROM generation_tasks WHERE id=? AND user_id=? AND session_id=? AND turn_id=?').get(
        binding.taskId, binding.userId, binding.sessionId, binding.turnId) as { status: string; expires_at: string } | null;
      if (!task) throw new BusinessError('E_GENERATION_SCOPE', '出题任务不属于当前用户或会话', 'SECURITY');
      if (task.status === status) return;
      if (task.status !== 'ACTIVE' || (status === 'COMPLETED' && task.expires_at <= new Date().toISOString())) reject('E_GENERATION_INACTIVE', '任务已结束或过期，不能标记完成');
      if (this.sqlite.query("SELECT 1 FROM bank_audio_assets WHERE task_id=? AND status='RUNNING'").get(binding.taskId)) reject('E_AUDIO_BUSY', '音频任务仍在运行，请先取消并等待收尾');
      this.sqlite.query('UPDATE generation_tasks SET status=? WHERE id=?').run(status, binding.taskId);
    }).immediate();
  }
  readTextbook(binding: GenerationBinding, input: ReadGenerationTextbook) {
    return this.transaction(binding, ctx => readTextbook(ctx, ReadGenerationTextbookSchema.parse(input)));
  }
  query(binding: GenerationBinding, input: QueryBank) {
    return this.transaction(binding, ctx => queryQuestions(ctx, QueryBankSchema.parse(input)));
  }
  submit(binding: GenerationBinding, input: SubmitBankQuestions) {
    return this.transaction(binding, ctx => submitQuestions(ctx, SubmitBankQuestionsSchema.parse(input)));
  }
  assemble(binding: GenerationBinding, input: AssembleBankPaper) {
    return this.transaction(binding, ctx => assemblePaper(ctx, AssembleBankPaperSchema.parse(input)));
  }
  claimAudio(binding: GenerationBinding, materialId: string) {
    return this.transaction(binding, ctx => {
      const material = ctx.sqlite.query(`SELECT l.content_json FROM bank_materials m JOIN bank_listening_materials l ON l.material_id=m.id
        WHERE m.id=? AND m.user_id=? AND m.language=? AND EXISTS(SELECT 1 FROM bank_questions q WHERE q.material_id=m.id
          AND q.user_id=m.user_id AND q.category='LISTENING' AND q.status='VALIDATED' AND q.target_level=? AND q.difficulty_tier<=?)`).get(
          materialId, binding.userId, ctx.config.language, ctx.config.targetLevel, ctx.config.maxDifficultyTier) as { content_json: string } | null;
      if (!material || !ctx.config.categoryLimits.LISTENING) reject('E_BANK_SCOPE', '听力材料不属于本次出题范围');
      const existing = ctx.sqlite.query('SELECT status,mime_type,length(audio_bytes) AS n FROM bank_audio_assets WHERE task_id=? AND material_id=?').get(binding.taskId, materialId) as { status: string; mime_type: string; n: number } | null;
      if (existing?.status === 'READY') return { ready: { materialId, mimeType: existing.mime_type, byteLength: existing.n } };
      if (existing) reject('E_AUDIO_BUSY', '该材料的音频正在生成，请勿重复提交');
      if (!ctx.config.audio || countAudio(ctx) >= ctx.config.maxAudio) reject('E_GENERATION_QUOTA', '听力音频额度已用完或未配置语音服务');
      const attempts = (ctx.sqlite.query('SELECT audio_attempts AS n FROM generation_tasks WHERE id=?').get(binding.taskId) as { n: number }).n;
      if (attempts >= ctx.config.maxAudioAttempts) reject('E_GENERATION_QUOTA', '语音调用次数额度已用完，失败重试也计入调用次数');
      const parsed = BankMaterialSchema.parse(JSON.parse(material.content_json));
      if (parsed.type !== 'LISTENING') reject('E_BANK_CORRUPT', '听力材料格式错误');
      const claimId = generateId();
      ctx.sqlite.query('UPDATE generation_tasks SET audio_attempts=audio_attempts+1 WHERE id=?').run(binding.taskId);
      ctx.sqlite.query("INSERT INTO bank_audio_assets (task_id,material_id,claim_id,status,created_at) VALUES (?,?,?,'RUNNING',?)").run(binding.taskId, materialId, claimId, new Date().toISOString());
      return { claimId, material: parsed, config: ctx.config };
    });
  }
  completeAudio(binding: GenerationBinding, materialId: string, claimId: string, bytes: Uint8Array, mimeType: string): BankAudioReceipt {
    if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024 || mimeType.length > 200 || /[\r\n]/.test(mimeType)) reject('E_AUDIO_INVALID', '语音服务返回了空音频、超限音频或不支持的格式');
    let parsedMime: MIMEType;
    try { parsedMime = new MIMEType(mimeType); } catch { reject('E_AUDIO_INVALID', '语音服务返回了无效音频类型'); }
    if (!parsedMime.essence.startsWith('audio/')) reject('E_AUDIO_INVALID', '语音服务返回的内容不是音频');
    const normalizedMime = parsedMime.toString();
    return this.transaction(binding, ctx => {
      const result = ctx.sqlite.query("UPDATE bank_audio_assets SET status='READY',mime_type=?,audio_bytes=? WHERE task_id=? AND material_id=? AND claim_id=? AND status='RUNNING'").run(normalizedMime, bytes, binding.taskId, materialId, claimId);
      if (result.changes !== 1) reject('E_AUDIO_CLAIM', '音频生成任务已被取消或替换');
      return { materialId, mimeType: normalizedMime, byteLength: bytes.byteLength };
    });
  }
  releaseAudio(binding: GenerationBinding, materialId: string, claimId: string): void {
    // Cleanup is permitted after expiration, but never across task ownership boundaries.
    this.sqlite.query(`DELETE FROM bank_audio_assets WHERE task_id=? AND material_id=? AND claim_id=? AND status='RUNNING'
      AND EXISTS(SELECT 1 FROM generation_tasks t WHERE t.id=task_id AND t.user_id=? AND t.session_id=? AND t.turn_id=?)`).run(
        binding.taskId, materialId, claimId, binding.userId, binding.sessionId, binding.turnId);
  }
  readAudio(userId: string, taskId: string, materialId: string): { bytes: Uint8Array; mimeType: string } {
    const row = this.sqlite.query(`SELECT a.audio_bytes,a.mime_type FROM bank_audio_assets a JOIN generation_tasks t ON t.id=a.task_id
      WHERE a.task_id=? AND a.material_id=? AND t.user_id=? AND a.status='READY'`).get(taskId, materialId, userId) as { audio_bytes: Uint8Array; mime_type: string } | null;
    if (!row) throw new BusinessError('E_NOT_FOUND', '音频不存在或不属于当前用户', 'SECURITY');
    return { bytes: row.audio_bytes, mimeType: row.mime_type };
  }
  describeTask(userId: string, taskId: string): GenerationTaskSnapshot {
    const hasExtra = this.hasTaskExtraColumns();
    const row = this.sqlite.query(`SELECT id,user_id,session_id,turn_id,config_json,status,expires_at${hasExtra ? ',blueprint_json,limits_json,objective_text' : ''} FROM generation_tasks WHERE id=?`).get(taskId) as
      { id: string; user_id: string; session_id: string; turn_id: string; config_json: string; status: string; expires_at: string; blueprint_json?: string | null; limits_json?: string | null; objective_text?: string | null } | null;
    if (!row || row.user_id !== userId) throw new BusinessError('E_GENERATION_SCOPE', '出题任务不属于当前用户', 'SECURITY');
    if (row.status !== 'ACTIVE' && row.status !== 'COMPLETED' && row.status !== 'CANCELLED') reject('E_BANK_CORRUPT', '任务状态异常');
    const config = GenerationConfigSchema.parse(JSON.parse(row.config_json));
    const blueprint = hasExtra && row.blueprint_json ? GenerationBlueprintSchema.parse(JSON.parse(row.blueprint_json)) : null;
    const runLimits = hasExtra && row.limits_json ? GenerationRunLimitsSchema.parse(JSON.parse(row.limits_json)) : GenerationRunLimitsSchema.parse({});
    const objective = hasExtra ? (row.objective_text ?? null) : null;
    const binding = { taskId: row.id, userId: row.user_id, sessionId: row.session_id, turnId: row.turn_id };
    const usedQuestions = (this.sqlite.query('SELECT count(*) AS n FROM generation_task_questions WHERE task_id=?').get(taskId) as { n: number }).n;
    const usedAudio = (this.sqlite.query("SELECT count(*) AS n FROM bank_audio_assets WHERE task_id=? AND status='READY'").get(taskId) as { n: number }).n;
    let usedAudioAttempts = 0;
    try { usedAudioAttempts = (this.sqlite.query('SELECT audio_attempts AS n FROM generation_tasks WHERE id=?').get(taskId) as { n: number }).n; } catch { usedAudioAttempts = 0; }
    const usedPapers = (this.sqlite.query('SELECT count(*) AS n FROM bank_papers WHERE task_id=?').get(taskId) as { n: number }).n;
    const papers = this.listTaskPapers(userId, taskId);
    const audio = (this.sqlite.query("SELECT material_id,mime_type,length(audio_bytes) AS n FROM bank_audio_assets WHERE task_id=? AND status='READY'").all(taskId) as
      { material_id: string; mime_type: string; n: number }[]).map(r => ({ materialId: r.material_id, mimeType: r.mime_type, byteLength: r.n }));
    return { binding, status: row.status as GenerationTaskSnapshot['status'], isExpired: row.expires_at <= new Date().toISOString(),
      expiresAt: row.expires_at, config, blueprint, runLimits, objective, usage: { usedQuestions, usedAudio, usedAudioAttempts, usedPapers }, papers, audio };
  }
  listTaskPapers(userId: string, taskId: string): GenerationTaskSnapshot['papers'] {
    const task = this.sqlite.query('SELECT user_id FROM generation_tasks WHERE id=?').get(taskId) as { user_id: string } | null;
    if (!task || task.user_id !== userId) throw new BusinessError('E_GENERATION_SCOPE', '出题任务不属于当前用户', 'SECURITY');
    const papers = this.sqlite.query('SELECT id,title FROM bank_papers WHERE task_id=? AND user_id=? ORDER BY created_at,id').all(taskId, userId) as { id: string; title: string }[];
    return papers.map(p => {
      const items = this.sqlite.query('SELECT question_id FROM bank_paper_items WHERE paper_id=? ORDER BY ordinal').all(p.id) as { question_id: string }[];
      return { paperId: p.id, title: p.title, questionIds: items.map(i => i.question_id) };
    });
  }
  readTaskPaper(userId: string, taskId: string, paperId: string): GenerationPaperDetail {
    const paper = this.sqlite.query('SELECT id,title FROM bank_papers WHERE id=? AND task_id=? AND user_id=?').get(paperId, taskId, userId) as { id: string; title: string } | null;
    if (!paper) throw new BusinessError('E_NOT_FOUND', '试卷不存在或不属于当前用户与任务', 'SECURITY');
    const rows = this.sqlite.query('SELECT snapshot_json FROM bank_paper_items WHERE paper_id=? ORDER BY ordinal').all(paperId) as { snapshot_json: string }[];
    return { paperId: paper.id, title: paper.title, items: rows.map(r => JSON.parse(r.snapshot_json)) };
  }
  recoverOrphanedTasks(userId: string, taskIds: string[]): string[] {    const recovered: string[] = [];
    for (const taskId of taskIds) {
      const done = this.sqlite.transaction(() => {
        const task = this.sqlite.query('SELECT user_id,status FROM generation_tasks WHERE id=?').get(taskId) as { user_id: string; status: string } | null;
        if (!task || task.user_id !== userId || task.status !== 'ACTIVE') return false;
        this.sqlite.query("DELETE FROM bank_audio_assets WHERE task_id=? AND status='RUNNING'").run(taskId);
        if (this.sqlite.query("SELECT 1 FROM bank_audio_assets WHERE task_id=? AND status='RUNNING'").get(taskId)) reject('E_AUDIO_BUSY', '音频任务仍在运行');
        this.sqlite.query('UPDATE generation_tasks SET status=? WHERE id=?').run('CANCELLED', taskId);
        return true;
      }).immediate();
      if (done) recovered.push(taskId);
    }
    return recovered;
  }
  listUserTasks(userId: string): GenerationTaskSummary[] {
    const rows = this.sqlite.query(`SELECT t.id,t.status,t.expires_at,t.config_json,
      (SELECT count(*) FROM generation_task_questions q WHERE q.task_id=t.id) AS questions,
      (SELECT count(*) FROM bank_papers p WHERE p.task_id=t.id) AS papers
      FROM generation_tasks t WHERE t.user_id=? ORDER BY t.created_at DESC,t.id DESC LIMIT 50`).all(userId) as
      { id: string; status: string; expires_at: string; config_json: string; questions: number; papers: number }[];
    return rows.map(row => {
      const config = GenerationConfigSchema.parse(JSON.parse(row.config_json));
      return { taskId: row.id, status: row.status as GenerationTaskSummary['status'],
        isExpired: row.expires_at <= new Date().toISOString(), expiresAt: row.expires_at,
        language: config.language, targetLevel: config.targetLevel,
        usedQuestions: row.questions, usedPapers: row.papers, paperCount: row.papers };
    });
  }
  getBankSubmission(userId: string, submissionId: string): BankSubmissionRecord | null {
    const row = this.sqlite.query(`SELECT submission_id,task_id,paper_id,question_id,answer_type,user_answer,status,
      is_correct,score,time_spent_ms,attempt_id,grading_error,model,adapter,grading_json FROM bank_submissions WHERE user_id=? AND submission_id=?`).get(userId, submissionId) as
      { submission_id: string; task_id: string; paper_id: string; question_id: string; answer_type: string;
        user_answer: string; status: string; is_correct: number | null; score: number | null;
        time_spent_ms: number; attempt_id: string | null; grading_error: string | null; model: string | null; adapter: string | null; grading_json: string | null } | null;
    if (!row) return null;
    return { submissionId: row.submission_id, taskId: row.task_id, paperId: row.paper_id, questionId: row.question_id,
      answerType: row.answer_type, userAnswer: row.user_answer, status: row.status as BankSubmissionRecord['status'],
      isCorrect: row.is_correct === null ? null : row.is_correct === 1, score: row.score,
      timeSpentMs: row.time_spent_ms, attemptId: row.attempt_id, gradingError: row.grading_error,
      model: row.model, adapter: row.adapter, grading: row.grading_json ? JSON.parse(row.grading_json) : null };
  }
  insertBankSubmission(input: { userId: string; submissionId: string; taskId: string; paperId: string; questionId: string;
    answerType: string; userAnswer: string; timeSpentMs?: number }): BankSubmissionRecord {
    const now = new Date().toISOString();
    this.sqlite.query(`INSERT INTO bank_submissions (user_id,submission_id,task_id,paper_id,question_id,answer_type,
      user_answer,status,created_at,updated_at,time_spent_ms,attempt_id) VALUES (?,?,?,?,?, ?,?,'SUBMITTED',?,?,?,?)`).run(input.userId, input.submissionId,
      input.taskId, input.paperId, input.questionId, input.answerType, input.userAnswer, now, now, input.timeSpentMs ?? 0,
      `att_${input.userId.length}:${input.userId}:${input.submissionId}`);
    return this.getBankSubmission(input.userId, input.submissionId)!;
  }
  settleBankSubmission(userId: string, submissionId: string, patch: { status: 'GRADED' | 'GRADING_FAILED';
    isCorrect?: boolean | null; score?: number | null; gradingError?: string | null;
    grading?: unknown; model?: string; adapter?: string }): BankSubmissionRecord {
    const result = this.sqlite.query(`UPDATE bank_submissions SET status=?,is_correct=?,score=?,grading_error=?,
      attempt_id=COALESCE(attempt_id,?),grading_json=?,model=COALESCE(?,model),adapter=COALESCE(?,adapter),updated_at=? WHERE user_id=? AND submission_id=? AND status!='GRADED'`).run(patch.status,
      patch.isCorrect === undefined || patch.isCorrect === null ? null : (patch.isCorrect ? 1 : 0),
      patch.score ?? null, patch.gradingError ?? null, `att_${userId.length}:${userId}:${submissionId}`, patch.grading === undefined ? null : JSON.stringify(patch.grading),
      patch.model ?? null, patch.adapter ?? null, new Date().toISOString(), userId, submissionId);
    if (result.changes !== 1) reject('E_SUBMISSION_NOT_FOUND', '作答提交不存在');
    return this.getBankSubmission(userId, submissionId)!;
  }
  healBankSubmission(userId: string, submissionId: string, input: { timeSpentMs: number }): BankSubmissionRecord {
    const result = this.sqlite.query(`UPDATE bank_submissions SET time_spent_ms=?,attempt_id=?,updated_at=?
      WHERE user_id=? AND submission_id=? AND attempt_id IS NULL`).run(input.timeSpentMs,
      `att_${userId.length}:${userId}:${submissionId}`, new Date().toISOString(), userId, submissionId);
    if (result.changes !== 1) reject('E_SUBMISSION_NOT_FOUND', '作答提交不存在或元数据已完整');
    return this.getBankSubmission(userId, submissionId)!;
  }
  listBankSubmissions(userId: string, taskId: string, paperId: string): BankSubmissionRecord[] {
    const paper = this.sqlite.query('SELECT id FROM bank_papers WHERE id=? AND task_id=? AND user_id=?').get(paperId, taskId, userId) as { id: string } | null;
    if (!paper) throw new BusinessError('E_NOT_FOUND', '试卷不存在或不属于当前用户与任务', 'SECURITY');
    const rows = this.sqlite.query(`SELECT submission_id,task_id,paper_id,question_id,answer_type,user_answer,status,
      is_correct,score,time_spent_ms,attempt_id,grading_error,model,adapter,grading_json FROM bank_submissions
      WHERE user_id=? AND task_id=? AND paper_id=? ORDER BY created_at,submission_id`).all(userId, taskId, paperId) as Array<{
      submission_id: string; task_id: string; paper_id: string; question_id: string; answer_type: string;
      user_answer: string; status: string; is_correct: number | null; score: number | null;
      time_spent_ms: number; attempt_id: string | null; grading_error: string | null; model: string | null;
      adapter: string | null; grading_json: string | null }>;
    return rows.map(row => ({ submissionId: row.submission_id, taskId: row.task_id, paperId: row.paper_id,
      questionId: row.question_id, answerType: row.answer_type, userAnswer: row.user_answer,
      status: row.status as BankSubmissionRecord['status'],
      isCorrect: row.is_correct === null ? null : row.is_correct === 1, score: row.score,
      timeSpentMs: row.time_spent_ms, attemptId: row.attempt_id, gradingError: row.grading_error,
      model: row.model, adapter: row.adapter, grading: row.grading_json ? JSON.parse(row.grading_json) : null }));
  }
  /** All legacy record paths must reject bank IDs without a host-settled receipt. */
  assertAttemptSource(attempt: { id: string; userId: string; questionId: string; userAnswer: string; isCorrect: boolean; score: number; timeSpentMs: number }) {
    const isBank = this.sqlite.query("SELECT 1 FROM bank_questions WHERE id=? AND status='VALIDATED'").get(attempt.questionId);
    const row = this.sqlite.query(`SELECT user_id,question_id,user_answer,status,is_correct,score,time_spent_ms
      FROM bank_submissions WHERE attempt_id=?`).get(attempt.id) as
      { user_id: string; question_id: string; user_answer: string; status: string; is_correct: number | null; score: number | null; time_spent_ms: number } | null;
    if (!isBank && !row) return;
    if (!row || row.status !== 'GRADED' || row.user_id !== attempt.userId || row.question_id !== attempt.questionId
      || row.user_answer !== attempt.userAnswer || row.is_correct !== Number(attempt.isCorrect) || row.score !== attempt.score || row.time_spent_ms !== attempt.timeSpentMs) {
      reject('E_BANK_ANSWER_REQUIRED', '新题库作答必须通过试卷作答入口和后端判分，不能直接提交成绩');
    }
  }
  bankAnswerStates(userId: string, questionIds: string[]): Array<{ questionId: string; attempts: number; hasGraded: boolean }> {
    if (questionIds.length === 0) return [];
    const rows = this.sqlite.query(`SELECT a.question_id,count(*) AS n FROM quiz_attempts a
      JOIN bank_submissions s ON s.user_id=a.user_id AND s.question_id=a.question_id
        AND (s.attempt_id=a.id OR (s.attempt_id IS NULL AND a.id GLOB 'att_[0-9]*:*'
          AND substr(a.id,instr(a.id,':')+1)=s.user_id||':'||s.submission_id))
        AND s.status='GRADED' AND s.user_answer=a.user_answer AND s.is_correct=a.is_correct AND s.score=a.score
      WHERE a.user_id=? AND a.question_id IN (${questionIds.map(() => '?').join(',')}) GROUP BY a.question_id`).all(userId, ...questionIds) as
      { question_id: string; n: number }[];
    const counts = new Map(rows.map(r => [r.question_id, r.n]));
    return questionIds.map(questionId => ({ questionId, attempts: counts.get(questionId) ?? 0, hasGraded: (counts.get(questionId) ?? 0) > 0 }));
  }
}
