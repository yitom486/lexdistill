import { Button } from '../ui/button.js';

export type SourceKind = 'loading' | 'error' | 'empty' | 'ready';

/**
 * 查询快照派生：首读中 / 无数据失败 / 成功空 / 有数据。
 * 有缓存的刷新失败由调用方另行标注，不与无数据失败混用。
 */
export function sourceKind<T>(
  data: T[] | undefined,
  isLoading: boolean,
  isError: boolean
): SourceKind {
  if (data === undefined) return isError ? 'error' : 'loading';
  if (data.length === 0) return 'empty';
  return 'ready';
}

export function SourceRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onRetry}>
      重试
    </Button>
  );
}
