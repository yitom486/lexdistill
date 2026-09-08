import {
  BusinessError,
  err,
  ok,
  logger,
  type Result,
} from '@study-studio/shared';
import { assertPublicWebUrl } from '../document-import/web-url.js';

/**
 * Azure Document Intelligence fallback（prebuilt-layout，按需只打失败页）。
 *
 * 定位：本地 OCR（PP-OCRv6 Small）先行；只有本地结果过薄（<50 字）的页才走云。
 * - Key/endpoint 随请求传入，网关内存态使用，绝不落盘、不打日志；
 * - endpoint 限定 Azure 域名后缀 + 公网 DNS 复检（SSRF 纵深）；
 * - 计费只发生在 pages 参数选中的页（Azure 按分析页计费，不按上传字节）。
 *
 * v1 取舍：不要 styleFont（少一个失败面）；行级置信度经 span 对齐 words 求均值，
 * 对不上退化为页均值（未知≠0，调用方按 null 处理）。
 */

const API_VERSION = '2024-11-30';
/** 本地结果低于此字数视为失败页（标题页等天然稀疏页可能被多打一页云，接受）。 */
export const AZURE_FALLBACK_MIN_CHARS = 50;
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 60;
const REQUEST_TIMEOUT_MS = 30_000;

const AZURE_HOST_SUFFIXES = [
  '.cognitiveservices.azure.com',
  '.cognitiveservices.azure.us',
  '.cognitiveservices.azure.cn',
];

export interface AzureOcrCredentials {
  endpoint: string;
  apiKey: string;
}

export interface AzureOcrLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 行均值（span 对不上时为 null，调用方退化处理，绝不填 0 冒充） */
  confidence: number | null;
}

export interface AzureOcrPage {
  pageNumber: number;
  markdown: string;
  lines: AzureOcrLine[];
  /** 页均值（无词置信度时为 null） */
  confidence: number | null;
}

export interface AzureOcrResult {
  pages: AzureOcrPage[];
  modelId: string;
}

export type AzureFetchImpl = typeof fetch;

/** endpoint 白名单 + 公网复检（SSRF）。返回归一化 endpoint（去尾斜杠）。 */
export async function normalizeAzureEndpoint(raw: string): Promise<string> {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BusinessError('E_INVALID_INPUT', 'Azure endpoint 不正确（须为 https 地址）', 'VALIDATION', false);
  }
  if (url.protocol !== 'https:') {
    throw new BusinessError('E_INVALID_INPUT', 'Azure endpoint 须为 https', 'VALIDATION', false);
  }
  const host = url.hostname.toLowerCase();
  if (!AZURE_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new BusinessError(
      'E_INVALID_INPUT',
      '只接受 Azure 认知服务域名（*.cognitiveservices.azure.*）',
      'SECURITY',
      false
    );
  }
  await assertPublicWebUrl(url.toString());
  return url.toString().replace(/\/+$/, '');
}

function azureErrorToBusiness(status: number, bodyText: string): BusinessError {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (parsed?.error && typeof parsed.error === 'object') {
      if (typeof parsed.error.code === 'string') code = parsed.error.code;
      if (typeof parsed.error.message === 'string') message = parsed.error.message;
    }
  } catch {
    // 非 JSON 错误体，按原文截断回显
  }
  const detail = (message || bodyText).slice(0, 200);
  if (status === 401 || status === 403) {
    return new BusinessError(
      'E_AZURE_AUTH',
      `Azure Key 或 endpoint 无效（HTTP ${status}，${detail}），请检查设置后重试`,
      'VALIDATION',
      false
    );
  }
  if (status === 400) {
    return new BusinessError(
      'E_AZURE_REQUEST',
      `Azure 拒绝了本次请求（${code || 'BadRequest'}，${detail}），请缩小页窗后重试`,
      'VALIDATION',
      false
    );
  }
  if (status === 429) {
    return new BusinessError('E_AZURE_THROTTLE', 'Azure 限流稍后再试', 'NETWORK', true);
  }
  return new BusinessError(
    'E_AZURE_FAILED',
    `Azure 文档智能暂不可用（HTTP ${status}），请稍后重试`,
    'NETWORK',
    true
  );
}

async function postAnalyze(
  fetchImpl: AzureFetchImpl,
  endpoint: string,
  apiKey: string,
  pdfBase64: string,
  pages: number[],
  locale: string
): Promise<string> {
  const pageSel = pages.join(',');
  const url =
    `${endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze` +
    `?api-version=${API_VERSION}&pages=${encodeURIComponent(pageSel)}` +
    `&locale=${encodeURIComponent(locale)}&outputContentFormat=markdown`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      body: JSON.stringify({ base64Source: pdfBase64 }),
    });
    if (res.status !== 202) {
      throw azureErrorToBusiness(res.status, await res.text().catch(() => ''));
    }
    const opLocation = res.headers.get('operation-location') ?? res.headers.get('Operation-Location');
    if (!opLocation) {
      throw new BusinessError('E_AZURE_FAILED', 'Azure 未返回轮询地址，请重试', 'NETWORK', true);
    }
    // Operation-Location 同 endpoint 域内（防重定向劫持：只认同 host）
    let opUrl: URL;
    try {
      opUrl = new URL(opLocation);
    } catch {
      throw new BusinessError('E_AZURE_FAILED', 'Azure 轮询地址异常，请重试', 'NETWORK', true);
    }
    if (opUrl.hostname.toLowerCase() !== new URL(endpoint).hostname.toLowerCase()) {
      throw new BusinessError('E_AZURE_FAILED', 'Azure 轮询地址跨域，拒绝跟随', 'SECURITY', false);
    }
    return opUrl.toString();
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    if ((e as { name?: string } | null)?.name === 'AbortError') {
      throw new BusinessError('E_AZURE_FAILED', 'Azure 提交超时，请缩小页窗后重试', 'NETWORK', true);
    }
    throw new BusinessError('E_AZURE_FAILED', 'Azure 提交失败，请检查网络后重试', 'NETWORK', true);
  } finally {
    clearTimeout(timer);
  }
}

interface RawWord {
  content?: unknown;
  polygon?: unknown;
  confidence?: unknown;
  span?: unknown;
}
interface RawLine {
  content?: unknown;
  polygon?: unknown;
  spans?: unknown;
}
interface RawPage {
  pageNumber?: unknown;
  lines?: unknown;
  words?: unknown;
}

function toPolygonBox(polygon: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!Array.isArray(polygon) || polygon.length < 8) return null;
  const nums = polygon.slice(0, 8).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const xs = [nums[0], nums[2], nums[4], nums[6]] as number[];
  const ys = [nums[1], nums[3], nums[5], nums[7]] as number[];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(0, Math.max(...xs) - x), height: Math.max(0, Math.max(...ys) - y) };
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** span 对齐：词落在哪行内（offset  containment；对不上整行退化 null）。 */
function lineConfidence(
  lineSpans: unknown,
  words: Array<{ confidence: number; offset: number; length: number }>
): number | null {
  if (!Array.isArray(lineSpans) || lineSpans.length === 0) return null;
  const confs: number[] = [];
  for (const s of lineSpans) {
    if (!s || typeof s !== 'object') continue;
    const rec = s as { offset?: unknown; length?: unknown };
    if (typeof rec.offset !== 'number' || typeof rec.length !== 'number') continue;
    const end = rec.offset + rec.length;
    for (const w of words) {
      if (w.offset >= rec.offset && w.offset + w.length <= end) confs.push(w.confidence);
    }
  }
  return avg(confs);
}

function parsePage(raw: unknown): AzureOcrPage | null {
  if (!raw || typeof raw !== 'object') return null;
  const rp = raw as RawPage;
  if (typeof rp.pageNumber !== 'number') return null;
  const rawWords = Array.isArray(rp.words) ? rp.words : [];
  const words: Array<{ confidence: number; offset: number; length: number }> = [];
  for (const w of rawWords) {
    if (!w || typeof w !== 'object') continue;
    const rw = w as RawWord;
    const span = rw.span && typeof rw.span === 'object' ? (rw.span as { offset?: unknown; length?: unknown }) : null;
    if (typeof rw.confidence !== 'number' || !span || typeof span.offset !== 'number' || typeof span.length !== 'number') {
      continue;
    }
    words.push({ confidence: rw.confidence, offset: span.offset, length: span.length });
  }
  const pageConf = avg(words.map((w) => w.confidence));
  const lines: AzureOcrLine[] = [];
  const rawLines = Array.isArray(rp.lines) ? rp.lines : [];
  for (const ln of rawLines) {
    if (!ln || typeof ln !== 'object') continue;
    const rl = ln as RawLine;
    if (typeof rl.content !== 'string' || !rl.content.trim()) continue;
    const box = toPolygonBox(rl.polygon) ?? { x: 0, y: 0, width: 0, height: 0 };
    lines.push({
      text: rl.content.trim(),
      ...box,
      confidence: lineConfidence(rl.spans, words),
    });
  }
  return {
    pageNumber: Math.trunc(rp.pageNumber),
    markdown: lines.map((l) => l.text).join('\n'),
    lines,
    confidence: pageConf,
  };
}

async function pollResult(
  fetchImpl: AzureFetchImpl,
  operationUrl: string,
  apiKey: string
): Promise<AzureOcrResult> {
  for (let i = 0; i < MAX_POLLS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(operationUrl, {
        signal: controller.signal,
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      });
      if (!res.ok) {
        throw azureErrorToBusiness(res.status, await res.text().catch(() => ''));
      }
      const body = (await res.json().catch(() => null)) as {
        status?: unknown;
        analyzeResult?: { pages?: unknown };
        error?: unknown;
      } | null;
      const status = body?.status;
      if (status === 'succeeded') {
        const rawPages = body?.analyzeResult?.pages;
        const pages: AzureOcrPage[] = [];
        if (Array.isArray(rawPages)) {
          for (const p of rawPages) {
            const parsed = parsePage(p);
            if (parsed) pages.push(parsed);
          }
        }
        return { pages, modelId: 'prebuilt-layout' };
      }
      if (status === 'failed') {
        const msg =
          body?.error && typeof body.error === 'object' && 'message' in body.error
            ? String((body.error as { message: unknown }).message).slice(0, 200)
            : '文档分析失败';
        throw new BusinessError('E_AZURE_FAILED', `Azure 分析失败（${msg}）`, 'TOOL_EXECUTION', false);
      }
      // notStarted/running → 继续轮询
    } catch (e) {
      if (e instanceof BusinessError) throw e;
      if ((e as { name?: string } | null)?.name === 'AbortError') {
        throw new BusinessError('E_AZURE_FAILED', 'Azure 轮询超时，请稍后重试', 'NETWORK', true);
      }
      throw new BusinessError('E_AZURE_FAILED', 'Azure 轮询失败，请稍后重试', 'NETWORK', true);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new BusinessError('E_AZURE_FAILED', 'Azure 分析超时（页窗过大？），请缩小页窗后重试', 'NETWORK', true);
}

export interface AzureAnalyzeInput {
  pdfBytes: Uint8Array;
  /** 1-based 页码（只打失败页，计费只在这几页） */
  pages: number[];
  credentials: AzureOcrCredentials;
  /** 识别 locale 提示（ja/ko/en；默认 ja） */
  locale?: string;
  fetchImpl?: AzureFetchImpl;
}

export interface AzureValidatedInput {
  pdfBytes: Uint8Array;
  pages: number[];
  /** 已过 normalizeAzureEndpoint 的 endpoint（测试接缝：跳过 DNS 步） */
  endpoint: string;
  apiKey: string;
  locale?: string;
  fetchImpl?: AzureFetchImpl;
}

/**
 * 内层（endpoint 已验）：提交→轮询→解析。单测用此接缝配 stub fetch，
 * 不碰 DNS；生产一律走 analyzePagesWithAzure（先验 endpoint）。
 */
export async function analyzeWithEndpoint(
  input: AzureValidatedInput
): Promise<Result<AzureOcrResult, BusinessError>> {
  try {
    const pages = [...new Set(input.pages)].filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b);
    if (pages.length === 0) {
      return err(new BusinessError('E_INVALID_INPUT', '没有需要云识别的页', 'VALIDATION', false));
    }
    if (input.pdfBytes.length > 64 * 1024 * 1024) {
      logger.warn('[azure-ocr] large upload (whole file base64, billed pages only)', {
        mb: Math.round(input.pdfBytes.length / 1048576),
        pages: pages.length,
      });
    }
    const pdfBase64 = Buffer.from(input.pdfBytes).toString('base64');
    const fetchImpl = input.fetchImpl ?? fetch;
    const operationUrl = await postAnalyze(
      fetchImpl,
      input.endpoint,
      input.apiKey,
      pdfBase64,
      pages,
      input.locale ?? 'ja'
    );
    const result = await pollResult(fetchImpl, operationUrl, input.apiKey);
    logger.info('[azure-ocr] pages done', {
      requested: pages.length,
      returned: result.pages.length,
    });
    return ok(result);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(new BusinessError('E_AZURE_FAILED', 'Azure 调用异常，请稍后重试', 'NETWORK', true));
  }
}

/**
 * 失败页打云（调用方已做阈值判断；这里只跑协议）。
 * 大文件预警：整文件 base64 上传（Azure 按 pages 计费但需全文）；
 * 超过 64MB 记 warn 让运维可见，不阻断（Azure 上限 500MB）。
 */
export async function analyzePagesWithAzure(
  input: AzureAnalyzeInput
): Promise<Result<AzureOcrResult, BusinessError>> {
  try {
    const pages = [...new Set(input.pages)].filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b);
    if (pages.length === 0) {
      return err(new BusinessError('E_INVALID_INPUT', '没有需要云识别的页', 'VALIDATION', false));
    }
    if (!input.credentials.apiKey) {
      return err(new BusinessError('E_INVALID_INPUT', '缺少 Azure Key（设置页填入后重试）', 'VALIDATION', false));
    }
    const endpoint = await normalizeAzureEndpoint(input.credentials.endpoint);
    return analyzeWithEndpoint({
      pdfBytes: input.pdfBytes,
      pages,
      endpoint,
      apiKey: input.credentials.apiKey,
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(new BusinessError('E_AZURE_FAILED', 'Azure 调用异常，请稍后重试', 'NETWORK', true));
  }
}
