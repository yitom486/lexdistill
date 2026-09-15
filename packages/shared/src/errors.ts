/**
 * 业务与领域标准错误分类
 */
export type ErrorCategory =
  | 'AGENT_RUNTIME'     // 底层 AI / Codex 服务异常
  | 'TOOL_EXECUTION'    // 工具执行失败
  | 'VALIDATION'        // 参数或协议结构校验失败
  | 'LEARNER_STATE'     // 学习者数据冲突或未找到
  | 'DATABASE'          // 数据库与持久化仓储异常
  | 'NETWORK'           // 网络与长连接通信异常
  | 'SECURITY'          // 权限拒绝或未授权
  | 'ROUTING'           // 未知路由/API 资源不存在（与学习数据无关）
  | 'INTERNAL';         // 系统未捕获的未知异常

/**
 * 友好且结构化的业务错误类型 (面向 UI 与调用链)
 */
export class BusinessError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,       // 必须是向学习者展示的友好自然语言
    public readonly category: ErrorCategory,
    public readonly retryable: boolean = false,
    public readonly internalDetails?: unknown
  ) {
    super(`[${code}] ${userMessage}`);
    this.name = 'BusinessError';
  }
}

const MAX_EXTRACTED_MESSAGE = 240;

/**
 * 从 Error / JSON-RPC / Codex TurnError 等异构载荷里抽出可读文案。
 * 禁止把普通对象落到 `[object Object]`。
 */
export function extractErrorText(rawError: unknown, depth = 0): string {
  if (rawError == null || depth > 4) return '';
  if (typeof rawError === 'string') return rawError.trim();
  if (rawError instanceof Error) {
    return (rawError.message || rawError.name || '').trim();
  }
  if (typeof rawError !== 'object') {
    const text = String(rawError);
    return text === '[object Object]' ? '' : text.trim();
  }

  const rec = rawError as Record<string, unknown>;
  const direct = [rec.message, rec.userMessage, rec.reason, rec.detail, rec.description].find(
    (value) => typeof value === 'string' && value.trim()
  );
  if (typeof direct === 'string') return direct.trim();

  if (rec.error != null && rec.error !== rawError) {
    const nested = extractErrorText(rec.error, depth + 1);
    if (nested) return nested;
  }
  if (rec.data != null && rec.data !== rawError) {
    const nested = extractErrorText(rec.data, depth + 1);
    if (nested) return nested;
  }

  try {
    const json = JSON.stringify(rawError);
    if (json && json !== '{}' && json !== '[]' && json !== 'null') {
      return json.length > MAX_EXTRACTED_MESSAGE
        ? `${json.slice(0, MAX_EXTRACTED_MESSAGE)}…`
        : json;
    }
  } catch {
    /* ignore */
  }
  return '';
}

function looksLikeStackTrace(text: string): boolean {
  return /\n\s+at\s+\S/.test(text) || (text.length > 400 && text.includes('    at '));
}

/**
 * 将底层不可预期的异常（网络报错、进程崩溃、数据库异常、JSON解析错误等）
 * 统一翻译为用户友好的业务领域错误
 */
export function translateToBusinessError(
  rawError: unknown,
  contextTag: string | Record<string, unknown> = 'SYSTEM'
): BusinessError {
  if (rawError instanceof BusinessError) {
    return rawError;
  }

  const errMessage = extractErrorText(rawError);
  const errName = rawError instanceof Error ? rawError.name : '';

  // 1. 网络与连接拒绝翻译
  if (
    errMessage.includes('ECONNREFUSED') ||
    errMessage.includes('Failed to fetch') ||
    errMessage.includes('fetch failed')
  ) {
    return new BusinessError(
      'E_NETWORK_DISCONNECTED',
      '无法连接到学习助手服务，请检查本地网络或确认服务是否已启动。',
      'NETWORK',
      true,
      { raw: errMessage, context: contextTag }
    );
  }

  // 2. 超时翻译
  if (errMessage.toLowerCase().includes('timeout') || errMessage.includes('ETIMEDOUT')) {
    return new BusinessError(
      'E_REQUEST_TIMEOUT',
      'AI 学习助手响应超时，可能是网络波动或模型正忙，请重试。',
      'AGENT_RUNTIME',
      true,
      { raw: errMessage, context: contextTag }
    );
  }

  // 3. 数据库与持久化异常翻译 (SQLite, Drizzle)
  if (
    errMessage.includes('SQLITE_') ||
    errMessage.includes('sqlite') ||
    errMessage.includes('Drizzle') ||
    errMessage.includes('UNIQUE constraint failed') ||
    errMessage.includes('FOREIGN KEY constraint failed') ||
    errMessage.includes('database is locked') ||
    errMessage.includes('no such table')
  ) {
    const isConstraint = errMessage.includes('UNIQUE') || errMessage.includes('constraint');
    return new BusinessError(
      isConstraint ? 'E_DATABASE_CONSTRAINT' : 'E_DATABASE_ERROR',
      isConstraint
        ? '学习记录已存在或冲突，无法重复写入。'
        : '本地学习数据库存储遇到临时冲突或锁定，系统已保护您的数据，请稍后重试。',
      'DATABASE',
      !isConstraint,
      { raw: errMessage, context: contextTag }
    );
  }

  // 4. 数据解析/校验格式错误翻译 (Zod, JSON)
  if (
    rawError instanceof SyntaxError ||
    errName === 'ZodError' ||
    errMessage.includes('JSON') ||
    errMessage.includes('validation') ||
    errMessage.includes('invalid_type')
  ) {
    return new BusinessError(
      'E_DATA_FORMAT_INVALID',
      '提交或返回的学习数据格式不符合规范，请检查后重新提交。',
      'VALIDATION',
      false,
      { raw: errMessage, context: contextTag }
    );
  }

  // 5. 工具执行错误翻译
  if (errMessage.includes('TOOL_EXECUTION') || errMessage.includes('tool execution failed')) {
    return new BusinessError(
      'E_TOOL_EXECUTION_FAILED',
      '执行学习辅助工具时遇到异常，请稍后重试。',
      'TOOL_EXECUTION',
      true,
      { raw: errMessage, context: contextTag }
    );
  }

  // 6. 底层 Codex / AI 引擎异常翻译：保留原文，避免把对象/具体原因吞掉
  if (errMessage.toLowerCase().includes('codex') || errMessage.includes('app-server')) {
    const clipped =
      errMessage.length > MAX_EXTRACTED_MESSAGE
        ? `${errMessage.slice(0, MAX_EXTRACTED_MESSAGE)}…`
        : errMessage;
    return new BusinessError(
      'E_AGENT_ENGINE_ERROR',
      `Codex 本轮未完成：${clipped}`,
      'AGENT_RUNTIME',
      true,
      { raw: errMessage, context: contextTag }
    );
  }

  // 7. 兜底未知异常：有可读原文就带上，不再把对象吞成「一点小问题」
  const friendlyFallback =
    errMessage && !looksLikeStackTrace(errMessage)
      ? `本轮未完成：${errMessage.length > MAX_EXTRACTED_MESSAGE ? `${errMessage.slice(0, MAX_EXTRACTED_MESSAGE)}…` : errMessage}`
      : '系统遇到了一点小问题，请稍后重试。';
  return new BusinessError('E_UNKNOWN_INTERNAL', friendlyFallback, 'INTERNAL', true, {
    raw: errMessage,
    context: contextTag,
  });
}
