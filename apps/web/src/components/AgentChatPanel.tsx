import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAgentGateway } from '../hooks/useAgentGateway.js';
import { useSelectedRuntimeCaps } from '../hooks/useSelectedRuntimeCaps.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { sound } from '../utils/audio.js';
import { buildTutorFreeGreeting } from '../copy/tutor-track-copy.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';
import {
  useArchiveAgentSessionMutation,
  useCompactAgentSessionMutation,
  useAgentQueueQuery,
  useAgentStatusQuery,
  useAgentSessionItemsQuery,
  useAgentSessionsQuery,
  useAgentRealtimeInvalidation,
  useDeleteAgentQueueItemMutation,
  useForkAgentSessionMutation,
  useQueueAgentMessageMutation,
} from '../queries/useAgentQueries.js';
import { useQueryClient } from '@tanstack/react-query';
import { ChatPanelHeader } from './agent-chat/ChatPanelHeader.js';
import { ChatMessageList } from './agent-chat/ChatMessageList.js';
import { ChatComposer } from './agent-chat/ChatComposer.js';
import { useChatTurn } from './agent-chat/use-chat-turn.js';
import { useCoachBootMessages } from './agent-chat/use-coach-boot.js';
import { useChatDismiss } from './agent-chat/use-chat-dismiss.js';
import { buildCoachClientSnapshot } from './agent-chat/coachSnapshot.js';
import { useReadingFocusStore } from '../stores/useReadingFocusStore.js';
import {
  type ChatMessage,
  type AgentTurnHealth,
} from './agent-chat/chat-shared.js';

interface AgentChatPanelProps {
  visible?: boolean;
  className?: string;
  onClose?: () => void;
}

/**
 * 对齐 Inkdown / Agent VS Code 风格：顶栏状态 + 底栏 mode/model/thinking + 流式气泡。
 * 仅经 Gateway；不引入厂商 SDK。
 */
export function AgentChatPanel({ className = '', onClose, visible = true }: AgentChatPanelProps) {
  const gateway = useAgentGateway();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const activeTab = useStudySessionStore((s) => s.activeTab);
  const profile = useUserProfileStore((s) => s.profile);
  const coachModelId = usePreferencesStore((s) => s.coachModelId);
  const setCoachModelId = usePreferencesStore((s) => s.setCoachModelId);
  const coachEffort = usePreferencesStore((s) => s.coachEffort);
  const setCoachEffort = usePreferencesStore((s) => s.setCoachEffort);
  const coachApprovalPolicy = usePreferencesStore((s) => s.coachApprovalPolicy);
  const setCoachApprovalPolicy = usePreferencesStore((s) => s.setCoachApprovalPolicy);
  const coachThreadId = usePreferencesStore((s) => s.coachThreadId);
  const setCoachThreadId = usePreferencesStore((s) => s.setCoachThreadId);
  const coachPersistThread = usePreferencesStore((s) => s.coachPersistThread);
  const setCoachPersistThread = usePreferencesStore((s) => s.setCoachPersistThread);
  const coachCollaborationMode = usePreferencesStore((s) => s.coachCollaborationMode);
  const setCoachCollaborationMode = usePreferencesStore((s) => s.setCoachCollaborationMode);

  const track = normalizeTrackLanguage(profile.targetLanguage);
  const queryClient = useQueryClient();

  // 面板可见时轮询运行时就绪状态：空闲期运行时掉线，界面要能自己变
  const { data: agentStatus, refetch: refetchAgentStatus } = useAgentStatusQuery({
    refetchInterval: visible ? 15_000 : false,
  });
  // 次级探测门控：等 status 确认已联动再发。避免未联动/启动期 6 路打空，
  // 与后端 ensureConnection single-flight 形成双保险（启动期只 spawn 一次）。
  const agentQueriesReady =
    Boolean(gateway.isConnected) && agentStatus?.available === true;
  const runtimeCaps = useSelectedRuntimeCaps();
  const { data: sessionsData, refetch: refetchThreads } = useAgentSessionsQuery(
    agentQueriesReady && (runtimeCaps.supportsThreads || runtimeCaps.supportsHistory)
  );
  const sessions = sessionsData?.sessions ?? [];
  const { data: threadItems = [], isFetched: threadItemsFetched } = useAgentSessionItemsQuery(
    coachThreadId || null,
    Boolean(coachThreadId) && agentQueriesReady && (runtimeCaps.supportsThreads || runtimeCaps.supportsHistory)
  );
  const archiveThread = useArchiveAgentSessionMutation();
  const compactThread = useCompactAgentSessionMutation();
  const forkThread = useForkAgentSessionMutation();
  useAgentRealtimeInvalidation();
  const queueMessage = useQueueAgentMessageMutation();
  const deleteQueueItem = useDeleteAgentQueueItemMutation();
  const { data: queueItems = [] } = useAgentQueueQuery(
    coachThreadId || null,
    Boolean(coachThreadId) && agentQueriesReady && (runtimeCaps.supportsThreads || runtimeCaps.supportsHistory)
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composerSettingsOpen, setComposerSettingsOpen] = useState(false);
  const dismiss = useChatDismiss(visible, onClose, setHistoryOpen, setComposerSettingsOpen);
  const [agentTurnHealth, setAgentTurnHealth] = useState<AgentTurnHealth>({ state: 'idle' });
  const lastCoachPromptRef = useRef<string | null>(null);
  const queueDrainRef = useRef(false);

  // 初始问候 / 历史恢复展示（发送/队列/审批生命周期见 useChatTurn）。
  useCoachBootMessages({
    track,
    setMessages,
    coachThreadId,
    threadItems,
    threadItemsFetched,
    supportsThreadsOrHistory:
      runtimeCaps.supportsThreads || runtimeCaps.supportsHistory,
  });

  // P3-3：标量订阅（稳定引用，防重渲染循环）；仅阅读页 store 非空才附 focus。
  const readingDocumentId = useReadingFocusStore((s) => s.documentId);
  const readingSurface = useReadingFocusStore((s) => s.surface);
  const snapshot = useCallback(() => {
    return buildCoachClientSnapshot({
      track,
      learnerLevel: profile.overallLevel,
      activeTab,
      readingDocumentId,
      readingSurface,
    });
  }, [track, profile.overallLevel, activeTab, readingDocumentId, readingSurface]);

  /** 显式新建会话（清空会话，下次发送开启新会话） */
  const startNewChat = () => {
    if (busy) interrupt();
    sound.playClick();
    setCoachThreadId('');
    setMessages([
      {
        id: `open_${Date.now()}`,
        role: 'assistant',
        text: buildTutorFreeGreeting(track),
      },
    ]);
  };

  /** 仅清屏，保留 coachThreadId，便于继续恢复 */
  const clearDisplay = () => {
    sound.playClick();
    setMessages([
      {
        id: `wipe_${Date.now()}`,
        role: 'system',
        text: coachThreadId
          ? '已清屏（会话仍保留，发送消息将续写当前会话）'
          : '已清屏',
      },
    ]);
  };

  const openThread = (threadId: string) => {
    if (busy) interrupt();
    sound.playClick();
    setCoachThreadId(threadId);
    setHistoryOpen(false);
  };

  const enqueueQueued = () => {    const text = input.trim();
    if (!text) return;
    if (!coachThreadId) {
      toast.error('请先有一个活跃会话再加入队列');
      return;
    }
    sound.playClick();
    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: `queue_${Date.now()}`, role: 'user', text: `排队：${text}` },
    ]);
    queueMessage.mutate(
      { sessionId: coachThreadId, message: text },
      {
        onError: () => toast.error('加入队列失败'),
        onSuccess: () => toast.success('已加入下一轮队列'),
      }
    );
  };

  const {
    startQueuedTurn,
    send,
    retryLastAgentTurn,
    respondApproval,
    interrupt,
  } = useChatTurn({
    gateway,
    busy,
    setBusy,
    setMessages,
    setAgentTurnHealth,
    queueDrainRef,
    lastCoachPromptRef,
    snapshot,
    track,
    setInput,
    coachModelId,
    coachEffort,
    coachApprovalPolicy,
    coachThreadId,
    coachPersistThread,
    coachCollaborationMode,
    setCoachThreadId,
    queryClient,
    refetchAgentStatus,
  });
  const connected = gateway.isConnected;
  const agentAvailable = Boolean(agentStatus?.available);

  const composerSettingsNonDefault = Boolean(
    Boolean(coachCollaborationMode) ||
      (coachApprovalPolicy && coachApprovalPolicy !== 'never') ||
      (coachEffort && coachEffort !== 'medium')
  );

  return (
    <div
      onKeyDown={dismiss.onKeyDown}
      className={`flex flex-col h-full min-h-[420px] rounded-xl border border-line bg-paper-soft text-ink overflow-hidden shadow-xl ${className}`}
    >
        <ChatPanelHeader
          connected={connected}
          agentAvailable={agentAvailable}
          agentStatus={agentStatus}
          agentTurnHealth={agentTurnHealth}
          lastCoachPrompt={lastCoachPromptRef.current}
          busy={busy}
          retryLastAgentTurn={retryLastAgentTurn}
          track={track}
          coachThreadId={coachThreadId}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          refetchThreads={() => void refetchThreads()}
          sessions={sessions}
          startNewChat={startNewChat}
          openSession={openThread}
          compactThread={compactThread}
          forkThread={forkThread}
          coachPersistThread={coachPersistThread}
          setCoachPersistThread={setCoachPersistThread}
          archiveThread={archiveThread}
          clearDisplay={clearDisplay}
          onClose={onClose ? dismiss.close : undefined}
        />

        <ChatMessageList
          queueItems={queueItems}
          busy={busy}
          startQueuedTurn={startQueuedTurn}
          coachThreadId={coachThreadId}
          deleteQueueItem={deleteQueueItem}
          messages={messages}
          respondApproval={respondApproval}
          endRef={endRef}
          coachEffort={coachEffort}
          track={track}
        />

        <ChatComposer
          input={input}
          setInput={setInput}
          send={(raw) => void send(raw)}
          busy={busy}
          composerSettingsOpen={composerSettingsOpen}
          setComposerSettingsOpen={setComposerSettingsOpen}
          composerSettingsNonDefault={composerSettingsNonDefault}
          coachApprovalPolicy={coachApprovalPolicy}
          setCoachApprovalPolicy={setCoachApprovalPolicy}
          coachEffort={coachEffort}
          setCoachEffort={setCoachEffort}
          coachModelId={coachModelId}
          setCoachModelId={setCoachModelId}
          onRuntimeChange={() => startNewChat()}
          enqueueQueued={enqueueQueued}
          interrupt={interrupt}
          queueMessage={queueMessage}
          coachThreadId={coachThreadId}
          agentStatus={agentStatus}
        />
      </div>
  );
}
