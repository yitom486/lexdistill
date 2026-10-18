import {
  Gauge,
  KeyRound,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { ChatPanelHeader as ChatPanelHeaderShell, ChatStatusBadge } from '@yitom/chat-ui';
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

/** 本轮健康度 → 状态胶囊。四档语义在包里统一，宿主只做映射。 */
function turnHealthBadge(health: AgentTurnHealth, message?: string) {
  switch (health.state) {
    case 'idle':
      return null;
    case 'healthy':
      return <ChatStatusBadge tone="positive" label="本轮正常" />;
    case 'running':
      return <ChatStatusBadge tone="neutral" pulse label="请求中" />;
    case 'fallback':
      return <ChatStatusBadge tone="warning" label="本轮已回退" {...(message ? { title: message } : {})} />;
    default:
      return <ChatStatusBadge tone="danger" label="本轮失败" {...(message ? { title: message } : {})} />;
  }
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

  const subtitle = showTurnMessage
    ? (agentTurnHealth.message ?? '')
    : `${copy.headerHint}${agentRuntimeId && agentRuntimeId !== 'codex-acp' ? ` · ${agentRuntimeLabel(agentRuntimeId)}` : ''}${coachThreadId ? ' · 当前会话已保留' : ''}`;

  return (
    <ChatPanelHeaderShell
      title={`${copy.trackName}导师`}
      status={
        <>
          <ChatStatusBadge
            tone={connected ? 'positive' : 'neutral'}
            label={connected ? '已连接' : '未连接'}
          />
          {agentAvailable ? (
            <ChatStatusBadge
              tone="positive"
              icon={<KeyRound className="size-3" />}
              label="助手就绪"
              {...(agentStatus?.message ? { title: agentStatus.message } : {})}
            />
          ) : (
            <ChatStatusBadge
              tone="warning"
              label="助手未就绪"
              {...(agentStatus?.message ? { title: agentStatus.message } : {})}
            />
          )}
          {turnHealthBadge(agentTurnHealth, agentTurnHealth.state === 'fallback' || agentTurnHealth.state === 'failed' ? agentTurnHealth.message : undefined)}
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
        </>
      }
      subtitle={subtitle}
      actions={
        <>
          {connected ? (
            <Wifi className="mr-1 size-3.5 text-ink-emerald-700-emerald-400" />
          ) : (
            <WifiOff className="mr-1 size-3.5 text-ink-ghost" />
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
        </>
      }
    />
  );
}
