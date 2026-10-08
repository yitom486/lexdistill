import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAgentGateway } from '../hooks/useAgentGateway.js';
import { useSelectedRuntimeCaps } from '../hooks/useSelectedRuntimeCaps.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import {
  mapThreadItemsToBubbles,
  markToolCallsDone,
  stripTranscriptNoise,
  upsertToolCall,
} from '../lib/chat-transcript.js';
import { sound } from '../utils/audio.js';
import {
  buildTutorFreeGreeting,
  buildTutorOfflineReply,
} from '../copy/tutor-track-copy.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';
import {
  useArchiveAgentSessionMutation,
  useCompactAgentSessionMutation,
  useAgentCollaborationModesQuery,
  useAgentModelsQuery,
  useAgentQueueQuery,
  useAgentSkillsQuery,
  useAgentUsageQuery,
  useMcpServersQuery,
  useAgentStatusQuery,
  useAgentSessionItemsQuery,
  useAgentSessionsQuery,
  useAgentRealtimeInvalidation,
  useDeleteAgentQueueItemMutation,
  useForkAgentSessionMutation,
  useQueueAgentMessageMutation,
  AGENT_QUERY_KEYS,
} from '../queries/useAgentQueries.js';
import { useQueryClient } from '@tanstack/react-query';
import { ChatPanelHeader } from './agent-chat/ChatPanelHeader.js';
import { ChatMessageList } from './agent-chat/ChatMessageList.js';
import { ChatComposer } from './agent-chat/ChatComposer.js';
import { useChatTurn } from './agent-chat/use-chat-turn.js';
import { useReadingFocusStore } from '../stores/useReadingFocusStore.js';
import {
  FALLBACK_EFFORTS,
  type ChatMessage,
  type AgentTurnHealth,
} from './agent-chat/chat-shared.js';

interface AgentChatPanelProps {
  className?: string;
  onClose?: () => void;
}

/**
 * 对齐 Inkdown / Agent VS Code 风格：顶栏状态 + 底栏 mode/model/thinking + 流式气泡。
 * 仅经 Gateway；不引入厂商 SDK。
 */
export function AgentChatPanel({ className = '', onClose }: AgentChatPanelProps) {
  const gateway = useAgentGateway();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);

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

  const { data: agentStatus, refetch: refetchAgentStatus } = useAgentStatusQuery();
  // 次级探测门控：等 status 确认已联动再发。避免未联动/启动期 6 路打空，
  // 与后端 ensureConnection single-flight 形成双保险（启动期只 spawn 一次）。
  const agentQueriesReady =
    Boolean(gateway.isConnected) && agentStatus?.available === true;
  const runtimeCaps = useSelectedRuntimeCaps();
  const { data: models = [], isFetching: modelsLoading } = useAgentModelsQuery(
    agentQueriesReady && runtimeCaps.supportsModelPicker
  );
  const { data: sessionsData, refetch: refetchThreads } = useAgentSessionsQuery(
    agentQueriesReady && runtimeCaps.supportsThreads
  );
  const sessions = sessionsData?.sessions ?? [];
  const { data: collabModes = [] } = useAgentCollaborationModesQuery(
    agentQueriesReady
  );
  const { data: threadItems = [], isFetched: threadItemsFetched } = useAgentSessionItemsQuery(
    coachThreadId || null,
    Boolean(coachThreadId) && agentQueriesReady && runtimeCaps.supportsThreads
  );
  const archiveThread = useArchiveAgentSessionMutation();
  const compactThread = useCompactAgentSessionMutation();
  const forkThread = useForkAgentSessionMutation();
  useAgentRealtimeInvalidation();
  const queueMessage = useQueueAgentMessageMutation();
  const deleteQueueItem = useDeleteAgentQueueItemMutation();
  const { data: queueItems = [] } = useAgentQueueQuery(
    coachThreadId || null,
    Boolean(coachThreadId) && agentQueriesReady && runtimeCaps.supportsThreads
  );
  const { data: skills = [] } = useAgentSkillsQuery(agentQueriesReady && runtimeCaps.supportsThreads);
  const { data: usage } = useAgentUsageQuery(agentQueriesReady && runtimeCaps.supportsUsage);
  const { data: mcpServers = [] } = useMcpServersQuery(agentQueriesReady && runtimeCaps.supportsThreads);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [composerSettingsOpen, setComposerSettingsOpen] = useState(false);
  const [agentTurnHealth, setAgentTurnHealth] = useState<AgentTurnHealth>({ state: 'idle' });
  const lastCoachPromptRef = useRef<string | null>(null);
  const queueDrainRef = useRef(false);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === coachModelId || m.model === coachModelId),
    [models, coachModelId]
  );

  const effortOptions = useMemo(() => {
    const fromModel = selectedModel?.supportedReasoningEfforts?.filter(Boolean);
    if (fromModel?.length) return fromModel;
    return [...FALLBACK_EFFORTS];
  }, [selectedModel]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  // 偏好水合后再决定问候语 / 恢复提示，避免先闪 greeting 再被 thread items 覆盖
  // 非 Codex 运行时无 thread 体系：不显示“恢复会话”，直接问候（首轮自动建 ACP 会话）。
  useEffect(() => {
    if (bootedRef.current) return;
    const boot = () => {
      if (bootedRef.current) return;
      bootedRef.current = true;
      const threadId = usePreferencesStore.getState().coachThreadId;
      if (threadId && runtimeCaps.supportsThreads) {
        setMessages([
          {
            id: 'resume',
            role: 'system',
            text: '正在恢复上次 Agent 会话…',
          },
        ]);
      } else {
        setMessages([
          {
            id: 'open',
            role: 'assistant',
            text: buildTutorFreeGreeting(track),
          },
        ]);
      }
    };
    if (usePreferencesStore.persist.hasHydrated()) {
      boot();
      return;
    }
    return usePreferencesStore.persist.onFinishHydration(boot);
  }, [track]);

  useEffect(() => {
    if (!coachModelId && models.length) {
      const def = models.find((m) => m.isDefault) || models[0];
      if (def) setCoachModelId(def.id || def.model);
    }
  }, [coachModelId, models, setCoachModelId]);

  useEffect(() => {
    if (selectedModel?.defaultReasoningEffort && !effortOptions.includes(coachEffort)) {
      setCoachEffort(selectedModel.defaultReasoningEffort);
    } else if (effortOptions.length && !effortOptions.includes(coachEffort)) {
      setCoachEffort(effortOptions.includes('medium') ? 'medium' : effortOptions[0]!);
    }
  }, [selectedModel, effortOptions, coachEffort, setCoachEffort]);

  // P3-3：标量订阅（稳定引用，防重渲染循环）；仅阅读页 store 非空才附 focus。
  const readingDocumentId = useReadingFocusStore((s) => s.documentId);
  const readingSurface = useReadingFocusStore((s) => s.surface);
  const snapshot = useCallback(() => {
    return {
      targetLanguage: track,
      learnerLevel: profile.overallLevel,
      locale: 'zh-CN' as const,
      ui: { activeTab, openTutor: true },
      userIntentHint: 'FREE_COACH' as const,
      // P3-3：仅阅读页（store 非空，即教材阅读器开着某书某课）附阅读 focus，
      // 其他页面保持 undefined；可见性由服务端校验。
      ...(readingDocumentId
        ? {
            focus: {
              kind: 'READING_PASSAGE' as const,
              surface: readingSurface ?? '阅读中',
              documentId: readingDocumentId,
            },
          }
        : {}),
    };
  }, [track, profile.overallLevel, activeTab, readingDocumentId, readingSurface]);

  /** 显式新建会话（清空 thread，下次 turn 会 start 新 thread） */
  const startNewChat = () => {
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

  /** 仅清屏，保留 coachThreadId，便于继续 resume */
  const clearDisplay = () => {
    sound.playClick();
    setMessages([
      {
        id: `wipe_${Date.now()}`,
        role: 'system',
        text: coachThreadId
          ? '已清屏（会话仍保留，发送消息将续写当前 thread）'
          : '已清屏',
      },
    ]);
  };

  const openThread = (threadId: string) => {
    sound.playClick();
    setCoachThreadId(threadId);
    setHistoryOpen(false);
  };

  const enqueueQueued = () => {
    const text = input.trim();
    if (!text) return;
    if (!coachThreadId) {
      toast.error('请先有一个活跃会话再加入队列');
      return;
    }
    sound.playClick();
    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: `queue_${Date.now()}`, role: 'user', text: `排队 ${text}` },
    ]);
    queueMessage.mutate(
      { sessionId: coachThreadId, message: text },
      {
        onError: () => toast.error('加入队列失败'),
        onSuccess: () => toast.success('已加入下一轮队列'),
      }
    );
  };

  // 选中 / 恢复历史 thread：把 items 映射成聊天气泡
  useEffect(() => {
    if (!coachThreadId) return;
    if (threadItems.length) {
      const mapped: ChatMessage[] = mapThreadItemsToBubbles(threadItems).map((b) => ({
        ...b,
        text: b.role === 'user' ? stripTranscriptNoise(b.text) : b.text,
      }));
      if (mapped.length) setMessages(mapped);
      return;
    }
    if (threadItemsFetched) {
      setMessages((prev) => {
        if (prev.length === 1 && prev[0]?.id === 'resume') {
          return [
            {
              id: `open_${Date.now()}`,
              role: 'assistant',
              text: buildTutorFreeGreeting(track),
            },
          ];
        }
        return prev;
      });
    }
  }, [coachThreadId, threadItems, threadItemsFetched, track]);

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
  const modelLabel = !runtimeCaps.supportsModelPicker
    ? '运行时默认'
    : selectedModel?.displayName || coachModelId || (modelsLoading ? '加载中…' : '本机默认');

  const composerSettingsNonDefault = Boolean(
    Boolean(coachCollaborationMode) ||
      (coachApprovalPolicy && coachApprovalPolicy !== 'never') ||
      (coachEffort && coachEffort !== 'medium')
  );

  return (
    <div
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
          usage={usage}
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
          skillsOpen={skillsOpen}
          setSkillsOpen={setSkillsOpen}
          skills={skills}
          mcpServers={mcpServers}
          clearDisplay={clearDisplay}
          onClose={onClose}
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
          coachCollaborationMode={coachCollaborationMode}
          setCoachCollaborationMode={setCoachCollaborationMode}
          collabModes={collabModes}
          coachApprovalPolicy={coachApprovalPolicy}
          setCoachApprovalPolicy={setCoachApprovalPolicy}
          coachEffort={coachEffort}
          setCoachEffort={setCoachEffort}
          effortOptions={effortOptions}
          coachModelId={coachModelId}
          setCoachModelId={setCoachModelId}
          modelLabel={modelLabel}
          models={models}
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
