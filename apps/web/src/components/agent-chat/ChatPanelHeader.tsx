import {
  Gauge,
  KeyRound,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { Button } from '../ui/button.js';
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
import { ChatHistoryPopover } from './ChatHistoryPopover.js';

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

/** 上下文用量徽标（本轮结束时透传；配额见额度说明，两者口径不同）。 */
function ContextUsageChip() {
  const usage = useAgentContextUsageStore(state => state.usage);
  if (!usage || !(usage.size > 0)) return null;
  const percent = Math.min(100, Math.round((usage.used / usage.size) * 100));
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-ink-ghost"
      title={`上下文用量（本轮结束时）：${usage.used.toLocaleString()} / ${usage.size.toLocaleString()}`}
    >
      <Gauge className="size-3" />
      上下文 {percent}%
    </span>
  );
}

/** 自由导师顶栏：连接与执行状态 + 会话操作（历史弹层见 ChatHistoryPopover）。 */
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
  const showTurnMessage =
    agentTurnHealth.state === 'fallback' || agentTurnHealth.state === 'failed';
  return (
    <header className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-line">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight font-serif text-ink">{copy.trackName}导师</span>
          <span
            className={`inline-flex items-center gap-1 text-xs ${
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
              className="inline-flex items-center gap-1 text-xs text-ink-emerald-700-emerald-400"
              title={agentStatus?.message}
            >
              <KeyRound className="size-3" />
              助手就绪
            </span>
          ) : (
            <span className="text-xs text-ink-amber-900-amber-300" title={agentStatus?.message}>
              助手未就绪
            </span>
          )}
          {agentTurnHealth.state !== 'idle' ? (
            <span
              className={`inline-flex items-center gap-1 text-xs ${
                agentTurnHealth.state === 'healthy'
                  ? 'text-ink-emerald-700-emerald-400'
                  : agentTurnHealth.state === 'running'
                    ? 'text-ink-sky-700-sky-300'
                    : agentTurnHealth.state === 'fallback'
                      ? 'text-ink-amber-900-amber-300'
                      : 'text-ink-rose-600-rose-400'
              }`}
              title={
                showTurnMessage ? agentTurnHealth.message : undefined
              }
            >
              <span
                className={`size-1.5 rounded-full ${
                  agentTurnHealth.state === 'healthy'
                    ? 'bg-ink-emerald-700-emerald-400'
                    : agentTurnHealth.state === 'running'
                      ? 'bg-ink-sky-700-sky-300 animate-pulse motion-reduce:animate-none'
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
          {showTurnMessage && lastCoachPrompt ? (
            <button
              type="button"
              className="text-xs font-medium text-ink-sky-700-sky-300 hover:text-ink-sky-900-sky-200"
              disabled={busy}
              onClick={retryLastAgentTurn}
            >
              重试
            </button>
          ) : null}
          <ContextUsageChip />
        </div>
        <p
          className={`mt-0.5 text-xs truncate ${
            showTurnMessage
              ? 'text-ink-amber-900-amber-300'
              : 'text-ink-ghost'
          }`}
          title={showTurnMessage ? agentTurnHealth.message : undefined}
        >
          {showTurnMessage
            ? agentTurnHealth.message
            : `${copy.headerHint}${agentRuntimeId && agentRuntimeId !== 'codex-acp' ? ` · ${agentRuntimeLabel(agentRuntimeId)}` : ''}${coachThreadId ? ' · 当前会话已保留' : ''}`}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {connected ? (
          <Wifi className="size-3.5 text-ink-emerald-700-emerald-400 mr-1" />
        ) : (
          <WifiOff className="size-3.5 text-ink-ghost mr-1" />
        )}
        {runtimeCaps.supportsThreads || runtimeCaps.supportsHistory ? (
          <ChatHistoryPopover
            historyOpen={historyOpen}
            setHistoryOpen={setHistoryOpen}
            refetchThreads={refetchThreads}
            sessions={sessions}
            coachThreadId={coachThreadId}
            startNewChat={startNewChat}
            openSession={openSession}
            compactThread={compactThread}
            forkThread={forkThread}
            coachPersistThread={coachPersistThread}
            setCoachPersistThread={setCoachPersistThread}
            archiveThread={archiveThread}
          />
        ) : (
          <span className="inline-flex h-7 items-center px-1 text-xs text-ink-ghost" title="当前运行时不支持保留会话">
            无历史面板
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink"
          title="新对话（开启新会话）"
          aria-label="新对话"
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
          aria-label="清屏"
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
            aria-label="关闭面板"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
