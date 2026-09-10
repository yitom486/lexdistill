/**
 * 网关标准错误信封读取器。
 *
 * 网关统一返回 `{ success:false, error:{ code, userMessage, category, retryable, details } }`
 *（见 gateway `errors/http-error-handler.ts` 的 `StandardErrorPayload`），userMessage 藏在
 * `error` 嵌套里，不在顶层。调用方一律走这里取文案，禁止手写 `'userMessage' in payload`。
 */

/** 携带网关错误码与 details 的请求失败（message 即 userMessage，可直接展示）。 */
export class GatewayRequestError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  constructor(message: string, options?: { code?: string | undefined; details?: unknown }) {
    super(message);
    this.name = 'GatewayRequestError';
    if (options?.code !== undefined) this.code = options.code;
    if (options?.details !== undefined) this.details = options.details;
  }
}

function readNestedError(payload: unknown): { userMessage?: unknown; code?: unknown; details?: unknown } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const nested = (payload as { error?: unknown }).error;
  if (typeof nested !== 'object' || nested === null) return null;
  return nested as { userMessage?: unknown; code?: unknown; details?: unknown };
}

/**
 * 优先 `payload.error.userMessage`（网关标准信封），其次顶层 `payload.userMessage`
 *（旧形状兼容），否则返回 fallback。空串视同缺席。
 */
export function readGatewayUserMessage(payload: unknown, fallback: string): string {
  const nested = readNestedError(payload);
  if (nested && typeof nested.userMessage === 'string' && nested.userMessage.trim()) {
    return nested.userMessage;
  }
  if (typeof payload === 'object' && payload !== null) {
    const top = (payload as { userMessage?: unknown }).userMessage;
    if (typeof top === 'string' && top.trim()) return top;
  }
  return fallback;
}

/** 取网关标准信封的错误码（无则 undefined）。 */
export function readGatewayErrorCode(payload: unknown): string | undefined {
  const nested = readNestedError(payload);
  return nested && typeof nested.code === 'string' && nested.code ? nested.code : undefined;
}

/** 取网关标准信封的 details（C 超限引导用；无则 undefined）。 */
export function readGatewayErrorDetails(payload: unknown): unknown {
  const nested = readNestedError(payload);
  return nested?.details;
}

/**
 * 网关无响应固定中文（fetch 根本没拿到 HTTP 体时用，禁止把 Failed to fetch 顶到 toast）。
 * 大扫描书整本解析可能打断网关进程，文案直接指路重启 + 指定页码/全部页（只扫前 30 页）。
 */
export const GATEWAY_NO_RESPONSE_MESSAGE =
  '网关没有响应。请确认网关已启动；若刚导入很大的扫描 PDF，进程可能被整本解析打断，重启网关后再用「指定页码」或全部页（应只扫前 30 页）。';

function readErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const rec = error as { message?: unknown; name?: unknown };
    const parts = [rec.name, rec.message].filter((v): v is string => typeof v === 'string');
    if (parts.length > 0) return parts.join(' ');
  }
  return '';
}

/** 识别浏览器无响应失败：Failed to fetch / Load failed / NetworkError 等（大小写不敏感）。 */
export function isGatewayNoResponseError(error: unknown): boolean {
  const text = readErrorText(error);
  if (!text) return false;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(text);
}
