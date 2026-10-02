/**
 * 网关标准错误信封读取器。
 *
 * 网关统一返回 `{ success:false, error:{ code, userMessage, category, retryable, details } }`
 *（见 gateway `errors/http-error-handler.ts` 的 `StandardErrorPayload`），userMessage 藏在
 * `error` 嵌套里，不在顶层。调用方一律走这里取文案，禁止手写 `'userMessage' in payload`。
 */

/** 网关不可达错误码（fetch 层无响应时用；见 fetchPdfGateway）。 */
export const GATEWAY_UNREACHABLE_CODE = 'E_GATEWAY_UNREACHABLE';

/** 教材请求失败但健康检查正常；不能由此断定网关重启或 PDF 解析故障。 */
export const GATEWAY_REQUEST_FAILED_CODE = 'E_GATEWAY_REQUEST_FAILED';

export const GATEWAY_REQUEST_FAILED_MESSAGE =
  '教材请求未能完成，请检查网关连接后重试。';

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
 * 仅在健康检查也失败时提示无法连接，不推测文件大小、解析崩溃或进程退出。
 */
export const GATEWAY_NO_RESPONSE_MESSAGE =
  '无法连接本机网关，请检查桌面后台服务后重试。';

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

/**
 * 探测网关是否存活：返回握手 bootId（存活）或 null（不可达/非 ok/缺字段）。
 * 只走失败路径的单次轻量 GET（4s 超时）；读侧永不抛。
 */
export async function probeGatewayBootId(baseUrl: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const payload: unknown = await res.json().catch(() => null);
    if (typeof payload !== 'object' || payload === null) return null;
    const bootId = (payload as { bootId?: unknown }).bootId;
    return typeof bootId === 'string' && bootId ? bootId : null;
  } catch {
    return null;
  }
}

/**
 * 仅在没有 HTTP 响应时进行一次健康检查，记录实际检查结果。
 * 网关存活不证明请求失败原因；健康检查失败也不证明进程已退出。
 * 读到真实 HTTP 信封错误的调用方不得经过这里（那是业务失败，不是中断）。
 */
export async function mapGatewayTransportFailure(baseUrl: string, error: unknown): Promise<unknown> {
  const unreachable =
    isGatewayNoResponseError(error) ||
    (error instanceof GatewayRequestError && error.code === GATEWAY_UNREACHABLE_CODE);
  if (!unreachable) return error;
  const bootId = await probeGatewayBootId(baseUrl);
  return new GatewayRequestError(bootId === null ? GATEWAY_NO_RESPONSE_MESSAGE : GATEWAY_REQUEST_FAILED_MESSAGE, {
    code: bootId === null ? GATEWAY_UNREACHABLE_CODE : GATEWAY_REQUEST_FAILED_CODE,
    details: { health: bootId === null ? { reachable: false } : { reachable: true, bootId } },
  });
}
