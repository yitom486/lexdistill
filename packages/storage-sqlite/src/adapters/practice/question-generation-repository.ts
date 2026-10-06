import type { Database } from 'bun:sqlite';
import { MIMEType } from 'node:util';
import { BusinessError, generateId } from '@study-studio/shared';
import { GenerationConfigSchema, SubmitBankQuestionsSchema, QueryBankSchema, ReadGenerationTextbookSchema, AssembleBankPaperSchema,
  BankMaterialSchema, type GenerationBinding, type GenerationConfig, type BankAudioReceipt, type SubmitBankQuestions,
  type QueryBank, type ReadGenerationTextbook, type AssembleBankPaper } from '@study-studio/protocol';
import { canonicalJson } from '../../canonical-fingerprint.js';
import { assertChapter, countAudio, countQuestions, loadContext, readTextbook, reject, type GenerationContext } from './generation-context.js';
import { assemblePaper, queryQuestions, submitQuestions } from './generation-questions.js';

/** The host owns the connection. Every write rechecks scope inside an immediate transaction. */
export class SqliteQuestionGenerationRepository {
  constructor(private readonly sqlite: Database) {}
  private transaction<T>(binding: GenerationBinding, action: (ctx: GenerationContext) => T): T {
    return this.sqlite.transaction(() => action(loadContext(this.sqlite, binding))).immediate();
  }
  createTask(binding: GenerationBinding, rawConfig: GenerationConfig, expiresAt: string): void {
    const config = GenerationConfigSchema.parse(rawConfig);
    if (Object.values(binding).some(v => !v.trim()) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) reject('E_GENERATION_CONFIG', '任务身份或过期时间不正确');
    const expiry = new Date(expiresAt).toISOString();
    this.sqlite.transaction(() => {
      const old = this.sqlite.query('SELECT * FROM generation_tasks WHERE id=?').get(binding.taskId) as
        { user_id: string; session_id: string; turn_id: string; config_json: string; expires_at: string } | null;
      if (old) {
        if (old.user_id !== binding.userId || old.session_id !== binding.sessionId || old.turn_id !== binding.turnId || old.config_json !== canonicalJson(config) || old.expires_at !== expiry) reject('E_IDEMPOTENCY_CONFLICT', '已创建的任务不能替换身份、配置或有效期');
        return;
      }
      for (const s of config.textbookScopes) assertChapter(this.sqlite, binding.userId, config.language, s.documentId, s.chapterId);
      this.sqlite.query("INSERT INTO generation_tasks (id,user_id,session_id,turn_id,config_json,status,expires_at,created_at) VALUES (?,?,?,?,?,'ACTIVE',?,?)").run(binding.taskId, binding.userId, binding.sessionId,
        binding.turnId, canonicalJson(config), expiry, new Date().toISOString());
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
}
