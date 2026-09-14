import {
  isOk,
  type Result,
  type BusinessError,
  logger,
  translateToBusinessError,
} from '@study-studio/shared';

/**
 * lines 投影钩子（P2-2a；P2-2a1 修订）。
 * - hook 为必需参数：调用方必须显式装配（生产 Aldrich repo 实现，测试 recorder），
 *   不存在静默 no-op；
 * - 失败只 warn 不挡主流程；未知异常统一走 translateToBusinessError（AGENTS §2.2），
 *   日志只保留结构化安全字段（scope/documentId/code），原始错误不落日志。
 */
export type LinesProjectionHook = (
  userId: string,
  documentId: string
) => Promise<Result<{ inserted: number; skipped: number }, BusinessError>>;

export async function fireLinesProjection(
  hook: LinesProjectionHook,
  scope: string,
  userId: string,
  documentId: string
): Promise<void> {
  try {
    const res = await hook(userId, documentId);
    if (!isOk(res)) {
      logger.warn('[lines-projection] 投影失败（已记录，主流程继续）', {
        scope,
        documentId,
        code: res.error.code,
      });
    }
  } catch (raw: unknown) {
    const translated = translateToBusinessError(raw, 'LINES_PROJECTION');
    logger.warn('[lines-projection] 投影异常（已翻译记录，主流程继续）', {
      scope,
      documentId,
      code: translated.code,
    });
  }
}
