import {
  type TurnExecutionSummary,
  type TurnExecutionStatus,
  type TurnExecutionSource,
  type TurnExecutionOutcome,
  type TurnFailure,
  type TurnFailureCategory,
} from '@study-studio/protocol';
import type { BusinessError } from '@study-studio/shared';

/**
 * P3-C：构造回合执行摘要的纯函数。
 * 普通回合与队列回合共用，确保完成事件字段稳定、面向 UI、不含底层错误栈。
 * 单测可直接覆盖 4 种场景（建会话失败 / 流中失败 / 队列失败 / 用户中断）。
 */
export function buildTurnExecutionSummary(params: {
  status: TurnExecutionStatus;
  startedAt: number;
  source?: TurnExecutionSource;
  outcome?: TurnExecutionOutcome;
  /** Agent 失败时的业务错误；会被翻译为结构化 failure，不泄漏原始栈 */
  failureError?: BusinessError | null | undefined;
  /** 显式失败类别（覆盖由 error.code 推断的类别） */
  failureCategory?: TurnFailureCategory | undefined;
  queueRemaining?: number | undefined;
  lane?: 'coach' | 'learning' | undefined;
  threadId?: string | undefined;
  fromQueue?: boolean | undefined;
  model?: string | undefined;
  /** 旧字段兼容：Agent 失败时的用户文案（无结构化 error 时兜底） */
  legacyFailureMessage?: string | undefined;
}): TurnExecutionSummary {
  const {
    status,
    startedAt,
    source,
    outcome,
    failureError,
    failureCategory,
    queueRemaining,
    lane,
    threadId,
    fromQueue,
    model,
    legacyFailureMessage,
  } = params;

  const elapsedMs = Math.max(0, Date.now() - startedAt);

  let failure: TurnFailure | undefined;
  // failure 出现条件：非 COMPLETED（中断/失败），或 COMPLETED 但发生 Agent 回退（fallback）
  const hasFailureSignal = Boolean(failureError) || Boolean(legacyFailureMessage);
  if (status !== 'COMPLETED' || hasFailureSignal) {
    const category: TurnFailureCategory =
      failureCategory ??
      (status === 'INTERRUPTED'
        ? 'INTERRUPTED'
        : fromQueue
          ? 'QUEUE'
          : inferCategoryFromError(failureError));
    const userMessage =
      failureError?.userMessage ||
      legacyFailureMessage ||
      (status === 'INTERRUPTED'
        ? '本轮已中断。'
        : '本轮请求未完成，请稍后重试。');
    failure = {
      code: failureError?.code ?? (status === 'INTERRUPTED' ? 'E_TURN_INTERRUPTED' : 'E_TURN_FAILED'),
      userMessage,
      category,
      ...(typeof failureError?.retryable === 'boolean' ? { retryable: failureError.retryable } : {}),
    };
  }

  return {
    status,
    ...(source ? { source } : {}),
    ...(outcome ? { outcome } : {}),
    ...(failure ? { failure } : {}),
    elapsedMs,
    ...(typeof queueRemaining === 'number' ? { queueRemaining } : {}),
    ...(lane ? { lane } : {}),
    ...(threadId ? { threadId } : {}),
    ...(fromQueue ? { fromQueue: true } : {}),
    ...(model ? { model } : {}),
  };
}

function inferCategoryFromError(error: BusinessError | null | undefined): TurnFailureCategory {
  if (!error) return 'UNKNOWN';
  const code = error.code ?? '';
  if (code.includes('SESSION') || code.includes('CREATE')) return 'SESSION_CREATE';
  if (code.includes('STREAM') || code.includes('TURN')) return 'STREAM';
  if (code.includes('QUEUE')) return 'QUEUE';
  return 'UNKNOWN';
}

/** 回退到本地提示时的脚注：只给真实原因，不误导检查已连通的 Gateway。 */
export function formatAgentLocalFallbackNote(
  reason: string,
  _error?: BusinessError | null
): string {
  const trimmed = reason.trim();
  return `\n\n—\n（${trimmed} 已改用本地学习提示。可点击「重试」后再试一次。）`;
}

/** @deprecated 用 formatAgentLocalFallbackNote（旧名别名，兼容未改的调用方） */
export const formatCodexLocalFallbackNote = formatAgentLocalFallbackNote;
