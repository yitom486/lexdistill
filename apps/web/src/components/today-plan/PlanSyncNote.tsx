interface PlanSyncNoteProps {
  refreshing: boolean;
  stale: boolean;
  onRetry: () => void;
}

/**
 * 计划同步状态行：后台刷新中 / 刷新失败留缓存。
 * 纯展示；重试走已有 refetch（只读），不产生学习写入。
 */
export function PlanSyncNote({ refreshing, stale, onRetry }: PlanSyncNoteProps) {
  if (stale) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-ink-amber-800-amber-300">
          显示的是上次读取的内容，可能不是最新。
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold text-gold-warm hover:underline underline-offset-4 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          重试
        </button>
      </div>
    );
  }
  if (refreshing) {
    return <p className="text-xs text-ink-faint-soft">正在同步最新进度…</p>;
  }
  return null;
}
