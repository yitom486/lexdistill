import {
  BusinessError,
  extractErrorText,
  translateToBusinessError,
  type ErrorCategory,
} from '@study-studio/shared';

interface MappedCodexError {
  code: string;
  userMessage: string;
  category: ErrorCategory;
  retryable: boolean;
}

/**
 * App Server `error` 通知：`{ error: TurnError, willRetry, threadId, turnId }`
 * TurnError：`{ message, codexErrorInfo, additionalDetails }`
 */
export function translateCodexNotificationParams(
  params: unknown
): BusinessError | null {
  if (!params || typeof params !== 'object') {
    return translateCodexTurnError(params);
  }
  const rec = params as Record<string, unknown>;
  // Codex 会先推 willRetry=true 再自行重试；此时不能当终态失败去拆会话。
  if (rec.willRetry === true) return null;
  if (rec.error != null) return translateCodexTurnError(rec.error);
  return translateCodexTurnError(params);
}

export function translateCodexTurnError(raw: unknown): BusinessError {
  const parsed = parseTurnErrorShape(raw);
  const mapped = mapCodexErrorInfo(parsed?.codexErrorInfo);
  const details = parsed?.additionalDetails?.trim() ?? '';
  const message = parsed?.message?.trim() || extractErrorText(raw);

  if (mapped) {
    const extra = details && !mapped.userMessage.includes(details) ? `（${clip(details, 120)}）` : '';
    return new BusinessError(
      mapped.code,
      `${mapped.userMessage}${extra}`,
      mapped.category,
      mapped.retryable,
      { raw, codexErrorInfo: parsed?.codexErrorInfo, additionalDetails: details || undefined }
    );
  }

  if (message) {
    const generic = translateToBusinessError(new Error(message), 'CODEX_TURN');
    if (generic.code !== 'E_UNKNOWN_INTERNAL' && generic.code !== 'E_AGENT_ENGINE_ERROR') {
      return generic;
    }
    const extra = details && !message.includes(details) ? `（${clip(details, 120)}）` : '';
    return new BusinessError(
      'E_CODEX_TURN',
      `Codex 本轮未完成：${clip(message, 180)}${extra}`,
      'AGENT_RUNTIME',
      true,
      { raw, additionalDetails: details || undefined }
    );
  }

  return new BusinessError(
    'E_CODEX_TURN',
    'Codex 本轮未完成，但没有返回可读原因。请重试；若仍失败，可新开对话或换模型。',
    'AGENT_RUNTIME',
    true,
    { raw }
  );
}

function parseTurnErrorShape(raw: unknown): {
  message?: string;
  additionalDetails?: string;
  codexErrorInfo?: unknown;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const nested =
    rec.error && typeof rec.error === 'object' ? (rec.error as Record<string, unknown>) : rec;
  const message = typeof nested.message === 'string' ? nested.message : undefined;
  const additionalDetails =
    typeof nested.additionalDetails === 'string' ? nested.additionalDetails : undefined;
  const codexErrorInfo =
    nested.codexErrorInfo !== undefined ? nested.codexErrorInfo : rec.codexErrorInfo;
  if (!message && additionalDetails == null && codexErrorInfo == null) return null;
  return {
    ...(message ? { message } : {}),
    ...(additionalDetails ? { additionalDetails } : {}),
    ...(codexErrorInfo !== undefined ? { codexErrorInfo } : {}),
  };
}

function mapCodexErrorInfo(info: unknown): MappedCodexError | null {
  if (info == null) return null;
  if (typeof info === 'string') {
    switch (info) {
      case 'usageLimitExceeded':
        return {
          code: 'E_CODEX_USAGE_LIMIT',
          userMessage:
            'Codex 当前额度窗口已达上限。官方客户端有时仍能用剩余额度，但学习助手这一轮被 App Server 拒绝了。请等待重置、换更轻量模型，或稍后重试。',
          category: 'AGENT_RUNTIME',
          retryable: true,
        };
      case 'contextWindowExceeded':
        return {
          code: 'E_CODEX_CONTEXT_WINDOW',
          userMessage: '当前对话上下文过长，无法继续这一轮。请压缩会话或新开对话后再试。',
          category: 'AGENT_RUNTIME',
          retryable: true,
        };
      case 'sessionBudgetExceeded':
        return {
          code: 'E_CODEX_SESSION_BUDGET',
          userMessage: '本会话额度已用尽。请新开对话，或等待额度重置后再试。',
          category: 'AGENT_RUNTIME',
          retryable: true,
        };
      case 'serverOverloaded':
        return {
          code: 'E_CODEX_OVERLOADED',
          userMessage: 'Codex 服务正忙，请稍后再试。',
          category: 'AGENT_RUNTIME',
          retryable: true,
        };
      case 'unauthorized':
        return {
          code: 'E_CODEX_UNAUTHORIZED',
          userMessage: '本机 Codex 登录已失效。请在终端执行 codex login 后重试。',
          category: 'SECURITY',
          retryable: false,
        };
      case 'internalServerError':
        return {
          code: 'E_CODEX_INTERNAL',
          userMessage: 'Codex 服务内部出错，请稍后重试。',
          category: 'AGENT_RUNTIME',
          retryable: true,
        };
      case 'badRequest':
        return {
          code: 'E_CODEX_BAD_REQUEST',
          userMessage:
            '这一轮请求不被 Codex 接受（模型、工具或上下文可能不兼容）。可换模型或新开对话后重试。',
          category: 'VALIDATION',
          retryable: true,
        };
      case 'cyberPolicy':
      case 'misalignmentPolicyViolation':
        return {
          code: 'E_CODEX_POLICY',
          userMessage: '请求被安全策略拦截，请调整提问后重试。',
          category: 'SECURITY',
          retryable: false,
        };
      case 'sandboxError':
        return {
          code: 'E_CODEX_SANDBOX',
          userMessage: 'Codex 沙箱执行失败。学习对话一般不需要改文件，直接重试即可。',
          category: 'AGENT_RUNTIME',
          retryable: true,
        };
      case 'threadRollbackFailed':
        return {
          code: 'E_CODEX_ROLLBACK',
          userMessage: '会话回滚失败，建议新开对话后再试。',
          category: 'AGENT_RUNTIME',
          retryable: true,
        };
      default:
        return null;
    }
  }
  if (typeof info !== 'object') return null;
  const rec = info as Record<string, unknown>;
  if ('httpConnectionFailed' in rec) {
    const status = readHttpStatus(rec.httpConnectionFailed);
    return {
      code: 'E_CODEX_HTTP',
      userMessage: status
        ? `连接 Codex 模型服务失败（HTTP ${status}）。请检查网络后重试。`
        : '连接 Codex 模型服务失败，请检查网络后重试。',
      category: 'NETWORK',
      retryable: true,
    };
  }
  if ('responseStreamConnectionFailed' in rec) {
    return {
      code: 'E_CODEX_STREAM',
      userMessage: 'Codex 流式连接建立失败，请稍后重试。',
      category: 'NETWORK',
      retryable: true,
    };
  }
  if ('responseStreamDisconnected' in rec) {
    return {
      code: 'E_CODEX_STREAM',
      userMessage: 'Codex 流式连接中断，请重试本轮。',
      category: 'NETWORK',
      retryable: true,
    };
  }
  if ('responseTooManyFailedAttempts' in rec) {
    return {
      code: 'E_CODEX_RETRY_EXHAUSTED',
      userMessage: 'Codex 多次尝试仍失败。请稍后再试，或换一个模型。',
      category: 'AGENT_RUNTIME',
      retryable: true,
    };
  }
  if ('activeTurnNotSteerable' in rec) {
    return {
      code: 'E_CODEX_NOT_STEERABLE',
      userMessage: '当前这一轮还不能插入追问。请等回复结束后再发送，避免连点。',
      category: 'VALIDATION',
      retryable: true,
    };
  }
  return null;
}

function readHttpStatus(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const code = (raw as { httpStatusCode?: unknown }).httpStatusCode;
  return typeof code === 'number' ? code : null;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
