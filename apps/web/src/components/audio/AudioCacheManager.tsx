import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Play, Square, HardDrive, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import {
  listAudioCache,
  getAudioCacheStats,
  deleteAudioCache,
  clearAllAudioCache,
  type CachedAudioRecord,
} from '../../lib/audio-cache.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function AudioCacheManager() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const player = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const releasePlayer = useCallback(() => {
    if (!player.current) return;
    const { audio, url } = player.current;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    URL.revokeObjectURL(url);
    player.current = null;
  }, []);
  useEffect(() => releasePlayer, [releasePlayer]);

  const statsQuery = useQuery({
    queryKey: ['audio-cache-stats'],
    queryFn: () => getAudioCacheStats(true),
  });

  const listQuery = useQuery({
    queryKey: ['audio-cache-list'],
    queryFn: () => listAudioCache(200, true),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['audio-cache-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['audio-cache-list'] });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!await deleteAudioCache(id)) throw new Error('删除音频缓存失败');
    },
    onSuccess: () => {
      toast.success('已删除选定音频缓存');
      invalidate();
    },
    onError: () => {
      toast.error('删除音频缓存失败');
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => clearAllAudioCache(true),
    onSuccess: () => {
      toast.success('已清空全部音频缓存');
      invalidate();
    },
    onError: () => {
      toast.error('清空音频缓存失败');
    },
  });

  const handlePlayPreview = (record: CachedAudioRecord) => {
    if (playingId === record.id) {
      releasePlayer();
      setPlayingId(null);
      return;
    }

    releasePlayer();
    const url = URL.createObjectURL(record.blob);
    const audio = new Audio(url);
    player.current = { audio, url };
    setPlayingId(record.id);

    audio.onended = () => {
      if (player.current?.audio !== audio) return;
      releasePlayer();
      setPlayingId(null);
    };
    audio.onerror = () => {
      if (player.current?.audio !== audio) return;
      releasePlayer();
      setPlayingId(null);
      toast.error('试听播放失败');
    };
    void audio.play().catch(() => {
      if (player.current?.audio !== audio) return;
      releasePlayer();
      setPlayingId(null);
      toast.error('试听播放失败');
    });
  };

  const records = listQuery.data ?? [];
  const statsReady = statsQuery.isSuccess;
  const filteredRecords = search.trim()
    ? records.filter((r) =>
        r.text.toLowerCase().includes(search.trim().toLowerCase()) ||
        r.voice.toLowerCase().includes(search.trim().toLowerCase()) ||
        r.provider.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : records;

  const stats = statsQuery.data ?? { count: 0, totalBytes: 0 };

  return (
    <div className="space-y-4">
      {/* 头部统计与批量操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-soft p-4">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-ink-mute" />
          <span className="text-sm font-medium text-ink">本地缓存空间</span>
          <Badge variant="outline" className="border-line text-xs font-normal text-ink-mute">
            {statsReady
              ? `${stats.count} 条音频 · ${formatBytes(stats.totalBytes)}`
              : statsQuery.isError
                ? '缓存统计读取失败'
                : '正在读取缓存统计…'}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-ink-mute"
            onClick={invalidate}
            disabled={listQuery.isFetching}
          >
            <RefreshCw className={`h-3 w-3 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs text-destructive hover:bg-surface"
            disabled={!statsReady || !listQuery.isSuccess || stats.count === 0 || clearAllMutation.isPending}
            onClick={() => {
              if (window.confirm(`确定要清空全部 ${stats.count} 条本地音频缓存吗？再次播放需重新向云端请求。`)) {
                clearAllMutation.mutate();
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
            清空全部
          </Button>
        </div>
      </div>

      {/* 搜索过滤框 */}
      {records.length > 5 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
          <input
            className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-mute focus-visible:ring-1 focus-visible:ring-focus-ring"
            placeholder="搜索已缓存的朗读文案或音色名称…"
            aria-label="搜索已缓存音频"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* 音频列表：读取中 / 读取失败（可重试）/ 空 / 有数据四态，不拿空数组冒充 */}
      {listQuery.isPending ? (
        <div className="rounded-2xl border border-line-soft bg-surface-soft/50 py-8 text-center text-xs text-ink-mute">
          正在读取本地音频缓存…
        </div>
      ) : listQuery.isError ? (
        <div className="rounded-2xl border border-line-soft bg-surface-soft/50 py-8 text-center text-xs text-ink-mute">
          <p>本地音频缓存读取失败，请重试。</p>
          <button
            type="button"
            onClick={invalidate}
            className="mt-2 underline underline-offset-2 text-accent-ink-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
          >
            重新读取
          </button>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="rounded-2xl border border-line-soft bg-surface-soft/50 py-8 text-center text-xs text-ink-mute">
          {search ? '未找到匹配的音频记录' : '暂无已保存的音频缓存。朗读后将自动保存在此处。'}
        </div>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {filteredRecords.map((record) => (
            <div
              key={record.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-surface-soft/60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={record.text}>
                  {record.text}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                  <Badge variant="outline" className="border-line px-1.5 py-0 text-xs font-normal">
                    {record.provider} · {record.voice}
                  </Badge>
                  {record.model && (
                    <span className="text-xs">{record.model}</span>
                  )}
                  <span>·</span>
                  <span>{formatBytes(record.sizeBytes)}</span>
                  <span>·</span>
                  <span>{formatDate(record.createdAt)}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title={playingId === record.id ? '停止播放' : '试听'}
                  aria-label={playingId === record.id ? '停止播放' : '试听'}
                  onClick={() => handlePlayPreview(record)}
                >
                  {playingId === record.id ? (
                    <Square className="h-3.5 w-3.5 fill-current text-ink" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current text-ink" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive hover:bg-surface-soft"
                  title="删除此项"
                  aria-label="删除此项"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(record.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
