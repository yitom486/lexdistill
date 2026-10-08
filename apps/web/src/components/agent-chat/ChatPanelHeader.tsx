import {
  Gauge,
  GitFork,
  History,
  KeyRound,
  Minimize2,
  Plus,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { sound } from '../../utils/audio.js';
import { useSelectedRuntimeCaps } from '../../hooks/useSelectedRuntimeCaps.js';
import type {
  AgentStatusDto,
  McpServerStatusDto,
  AgentUsageDto,
  AgentSkillDto,
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
  usage?: AgentUsageDto | null | undefined;
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
  skillsOpen: boolean;
  setSkillsOpen: (open: boolean) => void;
  skills: AgentSkillDto[];
  mcpServers: McpServerStatusDto[];
  clearDisplay: () => void;
  onClose?: (() => void) | undefined;
}

/** P2-1 拆分：顶栏状态徽标 + 会话历史/Skills 弹层（纯搬运自 AgentChatPanel）。 */
export function ChatPanelHeader(props: ChatPanelHeaderProps) {
  const {
    connected,
    agentAvailable,
    agentStatus,
    agentTurnHealth,
    lastCoachPrompt,
    busy,
    retryLastAgentTurn,
    usage,
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
    skillsOpen,
    setSkillsOpen,
    skills,
    mcpServers,
    clearDisplay,
    onClose,
  } = props;
  const copy = getTutorTrackCopy(track);
  const runtimeCaps = useSelectedRuntimeCaps();
  return (
    <header className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-line">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">Agent</span>
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
          {runtimeCaps.supportsUsage && typeof usage?.usedPercent === 'number' ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-ink-ghost"
              title={
                [
                  '这是当前 Agent 的额度占用，不是本轮生成进度。',
                  usage.resetsAt
                    ? `重置于 ${new Date(usage.resetsAt * 1000).toLocaleString()}`
                    : usage.label || '',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
            >
              <Gauge className="size-3" />
              额度已用 {Math.round(usage.usedPercent)}%
            </span>
          ) : null}
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
            : `${copy.headerHint} · Agent 流式${coachThreadId ? ` · ${coachThreadId.slice(0, 8)}…` : ''}`}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {connected ? (
          <Wifi className="size-3.5 text-ink-emerald-700-emerald-400 mr-1" />
        ) : (
          <WifiOff className="size-3.5 text-ink-ghost mr-1" />
        )}
        {runtimeCaps.supportsThreads ? (
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
          <span className="inline-flex h-7 items-center px-1 text-[10px] text-ink-ghost" title="当前运行时无 Codex 会话体系">
            无历史面板
          </span>
        )}
        {runtimeCaps.supportsThreads ? (
        <Popover open={skillsOpen} onOpenChange={setSkillsOpen}>
          <PopoverTrigger
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-ghost hover:bg-surface-stone-100-stone-900 hover:text-ink"
            title="Skills"
            onClick={() => sound.playClick()}
          >
            <Sparkles className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 p-2 border-line bg-paper-soft text-ink"
          >
            <p className="px-1 pb-2 text-[11px] font-medium text-ink-soft">
              Agent Skills（只读）
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {skills.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-ink-ghost">暂无 skill</p>
              ) : (
                skills.map((s) => (
                  <div
                    key={`${s.scope ?? 'x'}:${s.name}`}
                    className="rounded-lg px-2 py-1.5 hover:bg-surface-stone-100-stone-900"
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="min-w-0 truncate text-[11px] text-ink">{s.name}</p>
                      <span
                        className={`shrink-0 text-[9px] ${
                          s.enabled ? 'text-ink-emerald-700-emerald-400' : 'text-ink-ghost'
                        }`}
                      >
                        {s.enabled ? 'on' : 'off'}
                      </span>
                    </div>
                    {s.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[10px] text-ink-ghost">
                        {s.description}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            <div className="mt-2 border-t border-line px-1 pt-2">
              <p className="pb-1 text-[10px] font-medium text-ink-ghost">
                MCP 状态（观测，非学习工具总线）
              </p>
              <div className="max-h-28 space-y-1 overflow-y-auto">
                {mcpServers.length === 0 ? (
                  <p className="px-1 py-2 text-[10px] text-ink-ghost">未配置 MCP</p>
                ) : (
                  mcpServers.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between gap-2 rounded px-1 py-0.5"
                    >
                      <span className="truncate text-[10px] text-ink-soft">{s.name}</span>
                      <span className="shrink-0 text-[9px] text-ink-ghost">
                        {s.status} · {s.toolCount} tools
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        ) : (
          <span className="inline-flex h-7 items-center px-1 text-[10px] text-ink-ghost" title="当前运行时无 Codex 技能体系">
            无技能面板
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
