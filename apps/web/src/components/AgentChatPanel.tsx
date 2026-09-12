import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAgentGateway } from '../hooks/useAgentGateway.js';
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
  useArchiveCodexThreadMutation,
  useCompactCodexThreadMutation,
  useCodexCollaborationModesQuery,
  useCodexModelsQuery,
  useCodexQueueQuery,
  useCodexSkillsQuery,
  useCodexRateLimitsQuery,
  useCodexMcpServersQuery,
  useCodexStatusQuery,
  useCodexThreadItemsQuery,
  useCodexThreadsQuery,
  useCodexRealtimeInvalidation,
  useDeleteCodexQueueItemMutation,
  useForkCodexThreadMutation,
  useQueueCodexMessageMutation,
  CODEX_QUERY_KEYS,
} from '../queries/useCodexQueries.js';
import { useQueryClient } from '@tanstack/react-query';
import { ChatPanelHeader } from './agent-chat/ChatPanelHeader.js';
import { ChatMessageList } from './agent-chat/ChatMessageList.js';
import { ChatComposer } from './agent-chat/ChatComposer.js';
import { useChatTurn } from './agent-chat/use-chat-turn.js';
import {
  FALLBACK_EFFORTS,
  type ChatMessage,
  type CodexTurnHealth,
} from './agent-chat/chat-shared.js';

interface AgentChatPanelProps {
  className?: string;
  onClose?: () => void;
}

/**
 * 对齐 Inkdown / Codex VS Code 风格：顶栏状态 + 底栏 mode/model/thinking + 流式气泡。
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

  const { data: codexStatus, refetch: refetchCodexStatus } = useCodexStatusQuery();
  const { data: models = [], isFetching: modelsLoading } = useCodexModelsQuery(
    Boolean(gateway.isConnected)
  );
  const { data: threadsData, refetch: refetchThreads } = useCodexThreadsQuery(
    Boolean(gateway.isConnected)
  );
  const threads = threadsData?.threads ?? [];
  const { data: collabModes = [] } = useCodexCollaborationModesQuery(
    Boolean(gateway.isConnected)
  );
  const { data: threadItems = [], isFetched: threadItemsFetched } = useCodexThreadItemsQuery(
    coachThreadId || null,
    Boolean(coachThreadId) && Boolean(gateway.isConnected)
  );
  const archiveThread = useArchiveCodexThreadMutation();
  const compactThread = useCompactCodexThreadMutation();
  const forkThread = useForkCodexThreadMutation();
  useCodexRealtimeInvalidation();
  const queueMessage = useQueueCodexMessageMutation();
  const deleteQueueItem = useDeleteCodexQueueItemMutation();
  const { data: queueItems = [] } = useCodexQueueQuery(
    coachThreadId || null,
    Boolean(coachThreadId) && Boolean(gateway.isConnected)
  );
  const { data: skills = [] } = useCodexSkillsQuery(Boolean(gateway.isConnected));
  const { data: rateLimits } = useCodexRateLimitsQuery(Boolean(gateway.isConnected));
  const { data: mcpServers = [] } = useCodexMcpServersQuery(Boolean(gateway.isConnected));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [composerSettingsOpen, setComposerSettingsOpen] = useState(false);
  const [codexTurnHealth, setCodexTurnHealth] = useState<CodexTurnHealth>({ state: 'idle' });
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
  useEffect(() => {
    if (bootedRef.current) return;
    const boot = () => {
      if (bootedRef.current) return;
      bootedRef.current = true;
      const threadId = usePreferencesStore.getState().coachThreadId;
      if (threadId) {
        setMessages([
          {
            id: 'resume',
            role: 'system',
            text: '正在恢复上次 Codex 会话…',
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

  const snapshot = useCallback(() => {
    return {
      targetLanguage: track,
      learnerLevel: profile.overallLevel,
      locale: 'zh-CN' as const,
      ui: { activeTab, openTutor: true },
      userIntentHint: 'FREE_COACH' as const,
    };
  }, [track, profile.overallLevel, activeTab]);

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
      { threadId: coachThreadId, message: text },
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
    retryLastCodexTurn,
    respondApproval,
    interrupt,
  } = useChatTurn({
    gateway,
    busy,
    setBusy,
    setMessages,
    setCodexTurnHealth,
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
    refetchCodexStatus,
  });
  const connected = gateway.isConnected;
  const authLinked = Boolean(codexStatus?.linked);
  const modelLabel =
    selectedModel?.displayName || coachModelId || (modelsLoading ? '加载中…' : '本机默认');

  const composerSettingsNonDefault = Boolean(
    Boolean(coachCollaborationMode) ||
      (coachApprovalPolicy && coachApprovalPolicy !== 'never') ||
      (coachEffort && coachEffort !== 'medium')
  );

  return (
    <div
      className={`flex flex-col h-full min-h-[420px] rounded-xl border border-tone-stone-800o80 bg-surface-midnight-fixed text-tone-stone-100 overflow-hidden shadow-xl ${className}`}
    >
        <ChatPanelHeader
          connected={connected}
          authLinked={authLinked}
          codexStatus={codexStatus}
          codexTurnHealth={codexTurnHealth}
          lastCoachPrompt={lastCoachPromptRef.current}
          busy={busy}
          retryLastCodexTurn={retryLastCodexTurn}
          rateLimits={rateLimits}
          track={track}
          coachThreadId={coachThreadId}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          refetchThreads={() => void refetchThreads()}
          threads={threads}
          startNewChat={startNewChat}
          openThread={openThread}
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
          enqueueQueued={enqueueQueued}
          interrupt={interrupt}
          queueMessage={queueMessage}
          coachThreadId={coachThreadId}
          codexStatus={codexStatus}
        />
      </div>
  );
}
