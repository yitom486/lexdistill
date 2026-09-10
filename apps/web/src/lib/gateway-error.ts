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
