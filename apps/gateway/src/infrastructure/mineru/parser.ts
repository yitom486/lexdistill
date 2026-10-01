import { z } from 'zod';
import { createHash } from 'node:crypto';
import { extractZip } from '@study-studio/archive';
import type { ChapterSource, TextbookPipelineSettings } from '@study-studio/document-model';
import { BusinessError } from '@study-studio/shared';
import { cloudChapterSource, localChapterSource } from './chapter-source.js';
import { MineruHttpClient, MINERU_CLOUD_URL, MINERU_CLOUD_BYTE_LIMIT } from './http-client.js';

export interface ChapterParser {
  parse(pdf: Uint8Array, pages: readonly number[], signal: AbortSignal, diagnostic: (name: string, detail: unknown) => void): Promise<ChapterSource>;
}
const id = z.string().min(1);
interface ParseCheckpoint { taskId?: string; uploadId?: string; uploadUrl?: string; uploadHeaders?: Record<string, string>; uploaded?: boolean; fileId?: string; resultUrl?: string }
const cloudEnvelope = z.object({ code: z.union([z.number(), z.string()]), data: z.unknown().optional() });
function checked<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new BusinessError('E_MINERU_RESPONSE_INVALID', 'MinerU 返回的解析回执结构不完整', 'VALIDATION', true, result.error.issues);
  return result.data;
}
async function cloudJson(client: MineruHttpClient, path: string, body?: unknown): Promise<unknown> {
  const envelope = checked(cloudEnvelope, await client.json(path, body));
  if (envelope.code !== 0) throw new BusinessError('E_MINERU_API_REJECTED', ['A0202', 'A0211'].includes(String(envelope.code)) ? 'MinerU Token 无效或已过期，请更新本机凭据' : [-50001, -60018].includes(Number(envelope.code)) ? 'MinerU 解析额度已用完，请检查额度后再试' : 'MinerU 未接受解析请求，请检查文件、配置或服务状态', 'TOOL_EXECUTION', [-10001, -60001, -60007, -60009].includes(Number(envelope.code)), { providerCode: envelope.code });
  return envelope.data;
}

export function createMineruParser(settings: TextbookPipelineSettings, options: { cloudBaseUrl?: string; cloudToken?: string; localToken?: string } = {}): ChapterParser {
  const local = settings.parserBackend === 'mineru-local';
  const base = local ? settings.mineruLocalUrl : options.cloudBaseUrl ?? MINERU_CLOUD_URL;
  if (local) {
    let url: URL;
    try { url = new URL(base); } catch { throw new BusinessError('E_MINERU_CONFIG', '请填写本地 MinerU 服务地址', 'VALIDATION'); }
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new BusinessError('E_MINERU_CONFIG', '本地 MinerU 地址必须是本机 HTTP 服务地址', 'VALIDATION');
  }
  const token = (local ? options.localToken ?? process.env.MINERU_LOCAL_TOKEN ?? '' : options.cloudToken ?? process.env.MINERU_TOKEN ?? '').trim().replace(/^Bearer\s+/i, '');
  if (!local && !token) throw new BusinessError('E_MINERU_CREDENTIAL_MISSING', '尚未配置 MinerU 云端 Token，请在本机配置 MINERU_TOKEN，或明确选择已部署的本地服务', 'VALIDATION');
  const checkpoints = new Map<string, ParseCheckpoint>();
  return { async parse(pdf, pages, signal, diagnostic) {
    const key = createHash('sha256').update(pdf).update(JSON.stringify(pages)).digest('hex');
    const checkpoint = checkpoints.get(key) ?? {}; checkpoints.set(key, checkpoint);
    const deadline = AbortSignal.timeout(settings.parseTimeoutMs);
    const client = new MineruHttpClient(base.endsWith('/') ? base : `${base}/`, token, AbortSignal.any([signal, deadline]));
    try {
      const source = await (local ? parseLocal(client, pdf, pages, settings, diagnostic, checkpoint) : parseCloud(client, pdf, pages, settings, diagnostic, checkpoint));
      checkpoints.delete(key);
      return source;
    } catch (cause) {
      if (deadline.aborted && !signal.aborted) throw new BusinessError('E_MINERU_TIMEOUT', '章节解析等待超时，可继续检测已提交任务；已保存章节保留', 'NETWORK', true);
      if (cause instanceof BusinessError && cause.code === 'E_MINERU_PARSE_FAILED') checkpoints.delete(key);
      throw cause;
    }
  } };
}

async function parseCloud(client: MineruHttpClient, pdf: Uint8Array, pages: readonly number[], settings: TextbookPipelineSettings, note: (name: string, detail: unknown) => void, checkpoint: ParseCheckpoint): Promise<ChapterSource> {
  if (pdf.byteLength > MINERU_CLOUD_BYTE_LIMIT) throw new BusinessError('E_MINERU_FILE_LIMIT', '当前章节文件超过云端大小限制，请减少每次解析页数', 'VALIDATION');
  if (!checkpoint.taskId) {
    const task = checked(z.object({ batch_id: id, file_urls: z.array(id).length(1) }), await cloudJson(client, '/api/v4/file-urls/batch', {
    files: [{ name: 'chapter.pdf', is_ocr: true }], model_version: 'vlm', enable_table: true, enable_formula: false, language: settings.parserLanguage,
  }));
    checkpoint.taskId = task.batch_id; checkpoint.uploadUrl = task.file_urls[0]!;
    note('parse_submitted', { parser: 'mineru-cloud', remoteTaskId: task.batch_id, pages });
  } else note('parse_resumed', { parser: 'mineru-cloud', remoteTaskId: checkpoint.taskId, pages });
  // OSS 签名上传不用 Token 和自动 Content-Type；字节体避免 Blob 的隐式头。
  if (!checkpoint.uploaded) {
    await (await client.response(checkpoint.uploadUrl!, { method: 'PUT', body: new Uint8Array(pdf).buffer })).body?.cancel();
    checkpoint.uploaded = true;
    note('parse_uploaded', { remoteTaskId: checkpoint.taskId, bytes: pdf.byteLength });
  }
  while (!checkpoint.resultUrl) {
    const batch = checked(z.object({ extract_result: z.array(z.object({ state: z.enum(['waiting-file', 'pending', 'running', 'converting', 'done', 'failed']), full_zip_url: id.optional(), extract_progress: z.object({ extracted_pages: z.number().optional(), total_pages: z.number().optional() }).optional() })).length(1) }), await cloudJson(client, `/api/v4/extract-results/batch/${encodeURIComponent(checkpoint.taskId!)}`));
    const item = batch.extract_result[0]!;
    note('parse_progress', { remoteTaskId: checkpoint.taskId, state: item.state, ...(item.extract_progress ? { progress: item.extract_progress } : {}) });
    if (item.state === 'failed') throw new BusinessError('E_MINERU_PARSE_FAILED', 'MinerU 未能解析本章，请核对文件和服务状态', 'TOOL_EXECUTION', true);
    if (item.state === 'done') { if (!item.full_zip_url) throw new BusinessError('E_MINERU_RESPONSE_INVALID', '章节解析完成但缺少结果文件', 'VALIDATION', true); checkpoint.resultUrl = item.full_zip_url; break; }
    await client.pause(settings.parsePollIntervalMs);
  }
  note('parse_downloading', { remoteTaskId: checkpoint.taskId });
  const zip = await client.bytes(checkpoint.resultUrl);
  let entries: ReturnType<typeof extractZip>;
  try { entries = extractZip(zip); } catch { throw new BusinessError('E_MINERU_RESPONSE_INVALID', '章节解析包损坏或超出读取限制', 'VALIDATION', true); }
  const models = entries.filter(entry => /(?:^|\/)[^/]+_model\.json$/.test(entry.path));
  if (models.length !== 1) throw new BusinessError('E_MINERU_RESPONSE_INVALID', '解析包缺少唯一的逐页模型结果', 'VALIDATION', true);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(models[0]!.data)); } catch { throw new BusinessError('E_MINERU_RESPONSE_INVALID', '章节逐页结果不是有效 JSON', 'VALIDATION', true); }
  const source = cloudChapterSource(raw, pages);
  note('parse_completed', { remoteTaskId: checkpoint.taskId, pages, blockCount: source.blocks.length });
  return source;
}

async function parseLocal(client: MineruHttpClient, pdf: Uint8Array, pages: readonly number[], settings: TextbookPipelineSettings, note: (name: string, detail: unknown) => void, checkpoint: ParseCheckpoint): Promise<ChapterSource> {
  const health = checked(z.object({ features: z.object({ output_formats: z.array(z.string()) }) }), await client.json('/v1/health'));
  if (!health.features.output_formats.includes('structured_content')) throw new BusinessError('E_MINERU_CONFIG', '本地 MinerU 服务没有 structured_content 输出能力，请检查 V1 服务版本', 'VALIDATION');
  if (!checkpoint.uploadId) {
    const upload = checked(z.object({ id, status: z.enum(['pending', 'completed']), upload_url: id.optional(), upload_method: z.literal('PUT').optional(), upload_headers: z.record(z.string()).optional(), file: z.object({ id }).optional() }), await client.json('/v1/uploads', { filename: 'chapter.pdf', bytes: pdf.byteLength, mime_type: 'application/pdf', purpose: 'parse', sha256sum: createHash('sha256').update(pdf).digest('hex') }));
    checkpoint.uploadId = upload.id;
    if (upload.upload_url) checkpoint.uploadUrl = upload.upload_url;
    if (upload.upload_headers) checkpoint.uploadHeaders = upload.upload_headers;
    if (upload.file) checkpoint.fileId = upload.file.id;
  }
  if (!checkpoint.fileId) {
    if (!checkpoint.uploadUrl) throw new BusinessError('E_MINERU_RESPONSE_INVALID', '本地服务未提供上传地址', 'VALIDATION', true);
    const url = client.allowed(checkpoint.uploadUrl);
    if (!checkpoint.uploaded) {
      await (await client.response(url, { method: 'PUT', headers: { ...checkpoint.uploadHeaders, ...client.auth(url) }, body: new Uint8Array(pdf).buffer })).body?.cancel();
      checkpoint.uploaded = true;
    }
    const completed = checked(z.object({ status: z.literal('completed'), file: z.object({ id }) }), await client.json(`/v1/uploads/${encodeURIComponent(checkpoint.uploadId)}/complete`, {}));
    checkpoint.fileId = completed.file.id;
  }
  const taskSchema = z.object({ job_id: id, status: z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'canceled']), files: z.array(z.object({ status: z.string(), output_files: z.object({ structured_content: z.object({ file_id: id }) }).optional() })).optional() });
  let task = checked(taskSchema, checkpoint.taskId ? await client.json(`/v1/parse/jobs/${encodeURIComponent(checkpoint.taskId)}`) : await client.json('/v1/parse/jobs', { files: [{ source: { type: 'file_id', file_id: checkpoint.fileId } }], tier: settings.mineruLocalTier, output_formats: ['structured_content'] }));
  note(checkpoint.taskId ? 'parse_resumed' : 'parse_submitted', { parser: 'mineru-local', remoteTaskId: task.job_id, pages, tier: settings.mineruLocalTier });
  checkpoint.taskId = task.job_id;
  while (task.status === 'queued' || task.status === 'running') {
    note('parse_progress', { remoteTaskId: task.job_id, state: task.status });
    await client.pause(settings.parsePollIntervalMs);
    task = checked(taskSchema, await client.json(`/v1/parse/jobs/${encodeURIComponent(task.job_id)}`));
  }
  if (task.status !== 'completed' || task.files?.length !== 1 || task.files[0]?.status !== 'completed' || !task.files[0].output_files) throw new BusinessError('E_MINERU_PARSE_FAILED', '本地 MinerU 未完整解析当前章节，请检查服务状态', 'TOOL_EXECUTION', true);
  const url = client.url(`/v1/files/${encodeURIComponent(task.files[0].output_files.structured_content.file_id)}/content`);
  const response = await client.response(url, { headers: client.auth(url) });
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new BusinessError('E_MINERU_RESPONSE_INVALID', '本地章节结果不是有效 JSON', 'VALIDATION', true); }
  const source = localChapterSource(raw, pages);
  note('parse_completed', { remoteTaskId: task.job_id, pages, blockCount: source.blocks.length });
  return source;
}
