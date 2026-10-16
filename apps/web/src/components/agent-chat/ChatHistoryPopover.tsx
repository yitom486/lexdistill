import { GitFork, History, Minimize2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { sound } from '../../utils/audio.js';
import type { AgentSessionDto } from '../../queries/useAgentQueries.js';

interface ChatHistoryPopoverProps {
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  refetchThreads: () => void;
  sessions: AgentSessionDto[];
  coachThreadId: string;
  startNewChat: () => void;
  openSession: (sessionId: string) => void;
  compactThread: {
    isPending: boolean;
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: () => void }
    ) => void;
  };
  forkThread: {
    isPending: boolean;
    mutate: (
      vars: { sessionId: string; ephemeral?: boolean },
      opts?: { onSuccess?: (res: { sessionId: string }) => void; onError?: () => void }
    ) => void;
  };
  coachPersistThread: boolean;
  setCoachPersistThread: (v: boolean) => void;
  archiveThread: {
    mutate: (id: string, opts?: { onSuccess?: () => void }) => void;
  };
}

/** 自由导师会话历史弹层：会话列表 + 新建/恢复/压缩/分叉/归档 + 保留开关。 */
export function ChatHistoryPopover(props: ChatHistoryPopoverProps) {
  const {
    historyOpen,
    setHistoryOpen,
    refetchThreads,
    sessions,
    coachThreadId,
    startNewChat,
    openSession,
    compactThread,
    forkThread,
    coachPersistThread,
    setCoachPersistThread,
    archiveThread,
  } = props;
  return (
    <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
      <PopoverTrigger
        className="inline-flex size-7 items-center justify-center rounded-md text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink"
        title="会话历史"
        aria-label="会话历史"
        onClick={() => {
          sound.playClick();
          void refetchThreads();
        }}
      >
        <History className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-2 border-line bg-paper-soft text-ink"
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-xs font-medium text-ink-soft">会话</p>
          <button
            type="button"
            className="text-xs text-ink-sky-700-sky-300 hover:text-ink-sky-900-sky-200"
            onClick={() => {
              startNewChat();
              setHistoryOpen(false);
            }}
          >
            新建
          </button>
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-ink-ghost">暂无保留的会话</p>
          ) : (
            sessions.map((t) => (
              <div
                key={t.id}
                className={`flex items-start gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-stone-100-stone-900 ${
                  t.id === coachThreadId ? 'bg-surface-slate-50-slate-800' : ''
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openSession(t.id)}
                >
                  <p className="truncate text-xs text-ink">
                    {t.name || t.preview || t.id.slice(0, 12)}
                  </p>
                  <p className="text-xs text-ink-ghost">
                    {t.updatedAt
                      ? new Date(t.updatedAt * 1000).toLocaleString()
                      : t.id.slice(0, 8)}
                  </p>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-ink-ghost hover:text-ink-amber-900-amber-200"
                  title="压缩上下文"
                  aria-label="压缩上下文"
                  disabled={compactThread.isPending}
                  onClick={() => {
                    sound.playClick();
                    compactThread.mutate(t.id, {
                      onSuccess: () => toast.success('已请求压缩会话上下文'),
                      onError: () => toast.error('压缩失败'),
                    });
                  }}
                >
                  <Minimize2 className="size-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-ink-ghost hover:text-ink-sky-900-sky-200"
                  title="分叉会话"
                  aria-label="分叉会话"
                  disabled={forkThread.isPending}
                  onClick={() => {
                    sound.playClick();
                    forkThread.mutate(
                      {
                        sessionId: t.id,
                        ephemeral: !coachPersistThread,
                      },
                      {
                        onSuccess: (res) => {
                          toast.success('已分叉新会话');
                          openSession(res.sessionId);
                        },
                        onError: () => toast.error('分叉失败'),
                      }
                    );
                  }}
                >
                  <GitFork className="size-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-ink-ghost hover:text-ink-rose-600-rose-400"
                  title="归档"
                  aria-label="归档会话"
                  onClick={() => {
                    sound.playClick();
                    archiveThread.mutate(t.id, {
                      onSuccess: () => {
                        if (coachThreadId === t.id) startNewChat();
                      },
                    });
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))
          )}
        </div>
        <label className="mt-2 flex items-center gap-2 border-t border-line px-1 pt-2 text-xs text-ink-ghost">
          <input
            type="checkbox"
            checked={coachPersistThread}
            onChange={(e) => setCoachPersistThread(e.target.checked)}
          />
          保留新会话（关闭后可恢复）
        </label>
      </PopoverContent>
    </Popover>
  );
}
