import { isOk, type Result, BusinessError, logger } from '@study-studio/shared';

/**
 * lines 投影可选钩子（P2-2a）。
 * PDF／TOC 服务经 deps 注入（缺省即不投影，存量测试零 churn）；
 * enrich／种子直接调 repo.projectLinesSegments，不经此类型。
 * 失败只 warn 不挡主流程（与 P2-1 投影失败定级一致）。
 */
export type LinesProjectionHook = (
  userId: string,
  documentId: string
) => Promise<Result<{ inserted: number; skipped: number }, BusinessError>>;

export async function fireLinesProjection(
  hook: LinesProjectionHook | undefined,
  scope: string,
  userId: string,
  documentId: string
): Promise<void> {
  if (!hook) return;
  try {
    const res = await hook(userId, documentId);
    if (!isOk(res)) {
      logger.warn('[lines-projection] 投影失败（已 warn，主流程继续）', {
        scope,
        documentId,
        code: res.error.code,
      });
    }
  } catch (e) {
    logger.warn('[lines-projection] 投影异常（已吞，主流程继续）', {
      scope,
      documentId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
