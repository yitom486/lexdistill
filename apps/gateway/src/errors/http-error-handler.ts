import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  BusinessError,
  translateToBusinessError,
  type ErrorCategory,
} from '@lexdistill/shared';

/**
 * 业务错误大类向标准 HTTP 状态码的映射字典
 */
export function mapCategoryToHttpStatus(category: ErrorCategory): ContentfulStatusCode {
  switch (category) {
    case 'VALIDATION':
      return 400;
    case 'SECURITY':
      return 403;
    case 'LEARNER_STATE':
    case 'ROUTING':
      return 404;
    case 'TOOL_EXECUTION':
      return 422;
    case 'AGENT_RUNTIME':
      return 502;
    case 'NETWORK':
      return 504;
    case 'DATABASE':
    case 'INTERNAL':
    default:
      return 500;
  }
}

/**
 * 统一的结构化错误响应负载
 */
export interface StandardErrorPayload {
  success: false;
  error: {
    code: string;
    userMessage: string;
    category: ErrorCategory;
    retryable: boolean;
    details?: unknown;
  };
}

/**
 * 将任意异常（包含已知 BusinessError 与未捕获异常）格式化为统一 HTTP 结构化响应
 */
export function formatBusinessErrorResponse(
  c: Context,
  rawError: unknown,
  contextTag: string = 'HONO_GATEWAY'
) {
  const businessError =
    rawError instanceof BusinessError
      ? rawError
      : translateToBusinessError(rawError, contextTag);

  const status = mapCategoryToHttpStatus(businessError.category);

  const payload: StandardErrorPayload = {
    success: false,
    error: {
      code: businessError.code,
      userMessage: businessError.userMessage,
      category: businessError.category,
      retryable: businessError.retryable,
      details: businessError.internalDetails,
    },
  };

  return c.json(payload, status);
}
