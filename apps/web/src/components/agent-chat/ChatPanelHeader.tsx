import {
  Gauge,
  GitFork,
  History,
  KeyRound,
  Minimize2,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { sound } from '../../utils/audio.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { useAgentContextUsageStore } from '../../stores/useAgentContextUsageStore.js';
import { useSelectedRuntimeCaps } from '../../hooks/useSelectedRuntimeCaps.js';
import { agentRuntimeLabel } from '../../config/agent-runtimes.js';
import type {
  AgentStatusDto,
  AgentSessionDto,
} from '../../queries/useAgentQueries.js';
import type { AgentTurnHealth } from './chat-shared.js';
import { getTutorTrackCopy } from '../../copy/tutor-track-copy.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';

interface ChatPanelHeaderProps {
  connected: boolean;
  agentAvailable: boolean;
  agentStatus?: AgentStatusDto | undefined;
  agentTurnHealth: AgentTurnHealth;
  lastCoachPrompt: string | null;
  busy: boolean;
  retryLastAgentTurn: () => void;
  track: TrackLanguage;
  coachThreadId: string;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  refetchThreads: () => void;
  sessions: AgentSessionDto[];
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
  clearDisplay: () => void;
  onClose?: (() => void) | undefined;
}

/** P2-1 拆分：顶栏状态徽标 + 会话历史弹层（纯搬运自 AgentChatPanel）。 */

/** ACP 上下文用量徽标（usage_update 只读透传；配额见额度芯片，两者口径不同）。 */
function ContextUsageChip() {
  const usage = useAgentContextUsageStore(state => state.usage);
  if (!usage || !(usage.size > 0)) return null;
  const percent = Math.min(100, Math.round((usage.used / usage.size) * 100));
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-ink-ghost"
      title={`Agent 上下文用量（本轮结束时）：${usage.used.toLocaleString()} / ${usage.size.toLocaleString()}`}
    >
      <Gauge className="size-3" />
      上下文 {percent}%
    </span>
  );
}

export function ChatPanelHeader(props: ChatPanelHeaderProps) {
  const {
    connected,
    agentAvailable,
    agentStatus,
    agentTurnHealth,
    lastCoachPrompt,
    busy,
    retryLastAgentTurn,
    track,
    coachThreadId,
    historyOpen,
    setHistoryOpen,
    refetchThreads,
    sessions,
    startNewChat,
    openSession,
    compactThread,
    forkThread,
    coachPersistThread,
    setCoachPersistThread,
    archiveThread,
    clearDisplay,
    onClose,
  } = props;
  const copy = getTutorTrackCopy(track);
  const runtimeCaps = useSelectedRuntimeCaps();
  const agentRuntimeId = usePreferencesStore(state => state.agentRuntimeId);
  return (
    <header className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-line">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight font-serif text-ink">{copy.trackName}导师</span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] ${
              connected ? 'text-ink-emerald-700-emerald-400' : 'text-ink-ghost'
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                connected ? 'bg-ink-emerald-700-emerald-400' : 'bg-ink-ghost'
              }`}
            />
            {connected ? '已连接' : '未连接'}
          </span>
          {agentAvailable ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-ink-emerald-700-emerald-400"
              title={agentStatus?.message}
            >
              <KeyRound className="size-3" />
              Agent 可用
            </span>
          ) : (
            <span className="text-[10px] text-ink-amber-900-amber-300" title={agentStatus?.message}>
              Agent 未就绪
            </span>
          )}
          {agentTurnHealth.state !== 'idle' ? (
            <span
              className={`inline-flex items-center gap-1 text-[10px] ${
                agentTurnHealth.state === 'healthy'
                  ? 'text-ink-emerald-700-emerald-400'
                  : agentTurnHealth.state === 'running'
                    ? 'text-ink-sky-700-sky-300'
                    : agentTurnHealth.state === 'fallback'
                      ? 'text-ink-amber-900-amber-300'
                      : 'text-ink-rose-600-rose-400'
              }`}
              title={
                agentTurnHealth.state === 'fallback' || agentTurnHealth.state === 'failed'
                  ? agentTurnHealth.message
                  : undefined
              }
            >
              <span
                className={`size-1.5 rounded-full ${
                  agentTurnHealth.state === 'healthy'
                    ? 'bg-ink-emerald-700-emerald-400'
                    : agentTurnHealth.state === 'running'
                      ? 'bg-ink-sky-700-sky-300 animate-pulse'
                      : agentTurnHealth.state === 'fallback'
                        ? 'bg-ink-amber-900-amber-300'
                        : 'bg-ink-rose-600-rose-400'
                }`}
              />
              {agentTurnHealth.state === 'healthy'
                ? '本轮正常'
                : agentTurnHealth.state === 'running'
                  ? '请求中'
                  : agentTurnHealth.state === 'fallback'
                    ? '本轮已回退'
                    : '本轮失败'}
            </span>
          ) : null}
          {(agentTurnHealth.state === 'fallback' || agentTurnHealth.state === 'failed') &&
          lastCoachPrompt ? (
            <button
              type="button"
              className="text-[10px] font-medium text-ink-sky-700-sky-300 hover:text-ink-sky-900-sky-200"
              disabled={busy}
              onClick={retryLastAgentTurn}
            >
              重试
            </button>
          ) : null}
          <ContextUsageChip />
        </div>
        <p
          className={`mt-0.5 text-[10px] truncate ${
            agentTurnHealth.state === 'fallback' || agentTurnHealth.state === 'failed'
              ? 'text-ink-amber-900-amber-300'
              : 'text-ink-ghost'
          }`}
          title={
            agentTurnHealth.state === 'fallback' || agentTurnHealth.state === 'failed'
              ? agentTurnHealth.message
              : undefined
          }
        >
          {agentTurnHealth.state === 'fallback' || agentTurnHealth.state === 'failed'
            ? agentTurnHealth.message
            : `${copy.headerHint} · Agent 流式${agentRuntimeId && agentRuntimeId !== 'codex-acp' ? ` · ${agentRuntimeLabel(agentRuntimeId)}` : ''}${coachThreadId ? ` · ${coachThreadId.slice(0, 8)}…` : ''}`}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {connected ? (
          <Wifi className="size-3.5 text-ink-emerald-700-emerald-400 mr-1" />
        ) : (
          <WifiOff className="size-3.5 text-ink-ghost mr-1" />
        )}
        {runtimeCaps.supportsThreads || runtimeCaps.supportsHistory ? (
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink"
            title="会话历史"
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
              <p className="text-[11px] font-medium text-ink-soft">Agent 会话</p>
              <button
                type="button"
                className="text-[10px] text-ink-sky-700-sky-300 hover:text-ink-sky-900-sky-200"
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
                <p className="px-2 py-3 text-[11px] text-ink-ghost">暂无持久化会话</p>
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
                      <p className="truncate text-[11px] text-ink">
                        {t.name || t.preview || t.id.slice(0, 12)}
                      </p>
                      <p className="text-[10px] text-ink-ghost">
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
            <label className="mt-2 flex items-center gap-2 border-t border-line px-1 pt-2 text-[10px] text-ink-ghost">
              <input
                type="checkbox"
                checked={coachPersistThread}
                onChange={(e) => setCoachPersistThread(e.target.checked)}
              />
              持久化新会话（thread ephemeral=false）
            </label>
          </PopoverContent>
        </Popover>
        ) : (
          <span className="inline-flex h-7 items-center px-1 text-[10px] text-ink-ghost" title="当前运行时无持久会话体系">
            无历史面板
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink"
          title="新对话（新开 thread）"
          onClick={startNewChat}
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink"
          title="清屏（保留当前会话）"
          onClick={clearDisplay}
        >
          <Trash2 className="size-3.5" />
        </Button>
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink"
            title="关闭面板（会话不断开）"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
