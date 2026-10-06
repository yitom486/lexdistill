import type { Database } from 'bun:sqlite';
import { ChapterManifestSchema } from '@study-studio/document-model';
import { BusinessError } from '@study-studio/shared';
import { GenerationConfigSchema, type GenerationBinding, type GenerationConfig, type ReadGenerationTextbook } from '@study-studio/protocol';
import { fingerprintCanonical } from '../../canonical-fingerprint.js';

export interface GenerationContext { sqlite: Database; binding: GenerationBinding; config: GenerationConfig }
export function reject(code: string, message: string): never { throw new BusinessError(code, message, 'VALIDATION'); }
export function loadContext(sqlite: Database, binding: GenerationBinding): GenerationContext {
  const row = sqlite.query(`SELECT config_json,status,expires_at FROM generation_tasks
    WHERE id=? AND user_id=? AND session_id=? AND turn_id=?`).get(binding.taskId, binding.userId, binding.sessionId, binding.turnId) as
    { config_json: string; status: string; expires_at: string } | null;
  if (!row) throw new BusinessError('E_GENERATION_SCOPE', '出题任务不属于当前用户或会话', 'SECURITY');
  if (row.status !== 'ACTIVE' || row.expires_at <= new Date().toISOString()) reject('E_GENERATION_INACTIVE', '出题任务已结束或过期');
  return { sqlite, binding, config: GenerationConfigSchema.parse(JSON.parse(row.config_json)) };
}
export function assertChapter(sqlite: Database, userId: string, language: string, documentId: string, chapterId: string) {
  const doc = sqlite.query('SELECT chapters_json FROM documents WHERE id=? AND user_id=? AND language=?').get(documentId, userId, language) as { chapters_json: string | null } | null;
  if (!doc) reject('E_TEXTBOOK_SCOPE', '教材不属于当前用户或目标语言');
  const manifest = ChapterManifestSchema.safeParse(JSON.parse(doc.chapters_json ?? 'null'));
  if (!manifest.success || !manifest.data.some(c => c.id === chapterId)) reject('E_TEXTBOOK_SCOPE', '教材章节不存在');
}
export function assertAllowedChapter(ctx: GenerationContext, documentId: string, chapterId: string) {
  if (!ctx.config.textbookScopes.some(s => s.documentId === documentId && s.chapterId === chapterId)) reject('E_TEXTBOOK_SCOPE', '本次出题未授权读取该教材章节');
  assertChapter(ctx.sqlite, ctx.binding.userId, ctx.config.language, documentId, chapterId);
}
export function countQuestions(ctx: GenerationContext) {
  return (ctx.sqlite.query('SELECT count(*) AS n FROM generation_task_questions WHERE task_id=?').get(ctx.binding.taskId) as { n: number }).n;
}
export function countAudio(ctx: GenerationContext) {
  return (ctx.sqlite.query('SELECT count(*) AS n FROM bank_audio_assets WHERE task_id=?').get(ctx.binding.taskId) as { n: number }).n;
}
export function receipt<T>(ctx: GenerationContext, operation: string, key: string, input: unknown): T | null {
  const row = ctx.sqlite.query('SELECT fingerprint,result_json FROM generation_receipts WHERE task_id=? AND operation=? AND request_key=?').get(ctx.binding.taskId, operation, key) as { fingerprint: string; result_json: string } | null;
  if (!row) return null;
  if (row.fingerprint !== fingerprintCanonical(input)) reject('E_IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同内容');
  return JSON.parse(row.result_json) as T;
}
export function saveReceipt(ctx: GenerationContext, operation: string, key: string, input: unknown, result: unknown) {
  ctx.sqlite.query('INSERT INTO generation_receipts VALUES (?,?,?,?,?)').run(ctx.binding.taskId, operation, key, fingerprintCanonical(input), JSON.stringify(result));
}
const textbookSql = {
  vocabulary: `SELECT v.id,g.word,g.reading,v.meaning,v.part_of_speech,v.explanation,v.examples_json,v.usage_notes
    FROM textbook_vocabulary v JOIN global_vocabulary g ON g.id=v.vocabulary_id WHERE v.document_id=? AND v.chapter_id=? ORDER BY v.ord,v.id LIMIT ? OFFSET ?`,
  knowledge: 'SELECT id,kind,title,explanation,connection,examples_json FROM textbook_knowledge WHERE document_id=? AND chapter_id=? ORDER BY ord,id LIMIT ? OFFSET ?',
  articles: 'SELECT id,title,text,translation FROM textbook_articles WHERE document_id=? AND chapter_id=? ORDER BY ord,id LIMIT ? OFFSET ?',
  sentences: 'SELECT id,text,translation,explanation,speaker FROM textbook_sentences WHERE document_id=? AND chapter_id=? ORDER BY ord,id LIMIT ? OFFSET ?',
  exercises: 'SELECT id,type,prompt,options_json,answer_json,explanation,difficulty_tier,difficulty_reason FROM textbook_exercise_items WHERE document_id=? AND chapter_id=? ORDER BY ord,id LIMIT ? OFFSET ?',
  material: 'SELECT substr(text,?,12000) AS text FROM textbook_materials WHERE document_id=? AND chapter_id=?',
};
export function readTextbook(ctx: GenerationContext, input: ReadGenerationTextbook): { items: unknown[]; nextOffset: number | null } {
  assertAllowedChapter(ctx, input.documentId, input.chapterId);
  if (input.kind === 'material') {
    const row = ctx.sqlite.query(textbookSql.material).get(input.offset + 1, input.documentId, input.chapterId) as { text: string } | null;
    return { items: row?.text ? [row] : [], nextOffset: row?.text.length === 12000 ? input.offset + 12000 : null };
  }
  const rows = ctx.sqlite.query(textbookSql[input.kind]).all(input.documentId, input.chapterId, input.limit + 1, input.offset);
  return { items: rows.slice(0, input.limit), nextOffset: rows.length > input.limit ? input.offset + input.limit : null };
}
