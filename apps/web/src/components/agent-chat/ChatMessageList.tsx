import React, { useMemo } from 'react';
import { ChatEmptyState, ChatMessageList as YitomChatMessageList } from '@yitom/chat-ui';
import { ListOrdered, Play, X } from 'lucide-react';
import { Button } from '../ui/button.js';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import { toSpeakableText } from '../../lib/speakable.js';
import { trackToSpeechLang } from '../../config/speech-language.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';
import { sound } from '../../utils/audio.js';
import type { AgentQueuedSubmissionDto } from '../../queries/useAgentQueries.js';
import type { ChatMessage as LexChatMessage } from './chat-shared.js';
import { adaptLexMessagesToYitom } from './chat-message-adapter.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { getTutorTrackCopy } from '../../copy/tutor-track-copy.js';

interface ChatMessageListProps {
  queueItems: AgentQueuedSubmissionDto[];
  busy: boolean;
  startQueuedTurn: (queuedSubmissionId?: string) => void;
  coachThreadId: string;
  deleteQueueItem: { mutate: (vars: { sessionId: string; queuedId: string }) => void };
  messages: LexChatMessage[];
  respondApproval: (
    approvalId: string,
    decision: 'accept' | 'acceptForSession' | 'decline'
  ) => void;
  endRef?: React.RefObject<HTMLDivElement | null>;
  coachEffort: string;
  track: TrackLanguage;
}

function sourceLabel(source: string): string {
  if (source === 'agent' || source === 'codex') return '由 AI 生成';
  return '本地整理';
}

/**
 * 消息列表宿主薄适配：
 * 通用编排（assistant-ui 视口、历史分页、贴底跟滚、回到底部、运行状态行、
 * 工作记录与审批卡）全部交给 @yitom/chat-ui 的 `ChatMessageList`；这里只留
 * 状态订阅、消息结构转换、排队条，以及逐条朗读/来源标签的尾部插槽。
 */
export function ChatMessageList(props: ChatMessageListProps) {
  const {
    queueItems,
    busy,
    startQueuedTurn,
    coachThreadId,
    deleteQueueItem,
    messages,
    respondApproval,
    endRef,
    track,
  } = props;

  const currentTheme = usePreferencesStore((s) => s.theme);
  const theme = currentTheme === 'dark' ? 'dark' : 'light';
  const threadId = coachThreadId || 'coach-default';
  const copy = getTutorTrackCopy(track);

  const { messages: yitomMessages, pendingPermission } = useMemo(
    () => adaptLexMessagesToYitom(messages),
    [messages]
  );

  // 尾部插槽按 id 回查原始消息：朗读要正文以外的元数据（来源、是否仍在流式）
  const originalById = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages]
  );

  const pendingApprovalId = useMemo(() => {
    const appr = messages.find((m) => m.role === 'approval' && m.approval?.status === 'pending');
    return appr?.approval?.approvalId ?? null;
  }, [messages]);

  const handlePermissionRespond = (optionId: string | null) => {
    if (!pendingApprovalId) return;
    if (optionId === 'accept' || optionId === 'acceptForSession' || optionId === 'decline') {
      respondApproval(pendingApprovalId, optionId);
    } else {
      respondApproval(pendingApprovalId, 'decline');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {queueItems.length > 0 ? (
        <div className="shrink-0 border-b border-line-sky-500o25 bg-wash-sky-500o5 px-3 py-1.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink-sky-700-sky-300">
              <ListOrdered className="size-3" />
              排队中 · {queueItems.length}
            </div>
            <Button
              type="button"
              size="sm"
              className="h-6 gap-1 px-2 text-xs bg-tint-sky-700 hover:bg-tint-sky-600"
              disabled={busy}
              title="立即开始"
              onClick={() => startQueuedTurn()}
            >
              <Play className="size-3" />
              开始
            </Button>
          </div>
          <div className="space-y-1">
            {queueItems.map((q) => (
              <div
                key={q.id}
                className="flex items-start gap-1 rounded-lg bg-surface-stone-100-stone-900 px-2 py-1"
              >
                <p className="min-w-0 flex-1 truncate text-xs text-ink-soft">{q.text}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0 text-ink-ghost hover:text-ink-rose-600-rose-400"
                  title="移出队列"
                  aria-label="移出队列"
                  onClick={() => {
                    if (!coachThreadId) return;
                    sound.playClick();
                    deleteQueueItem.mutate({ sessionId: coachThreadId, queuedId: q.id });
                  }}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <YitomChatMessageList
        messages={yitomMessages}
        threadId={threadId}
        prompting={busy}
        pendingPermission={pendingPermission}
        theme={theme}
        resolveMarkProposal={() => {}}
        onPermissionRespond={handlePermissionRespond}
        {...(endRef ? { bottomRef: endRef } : {})}
        className="flex-1"
        emptyState={
          <ChatEmptyState
            title={`${copy.trackName}导师`}
            description={`围绕${copy.levelScheme}的语法辨析、例句造句或备考建议，直接问就行。`}
            hint="Enter 发送 · Shift+Enter 换行"
          />
        }
        renderMessageFooter={(message) => {
          const original = originalById.get(message.id);
          const speakable =
            message.role === 'agent' && !message.streaming && message.text.trim()
              ? toSpeakableText(message.text, track)
              : null;
          const source = original?.source && message.role === 'agent' ? sourceLabel(original.source) : null;
          if (!speakable && !source) return null;
          return (
            <div className="mt-1 flex items-center gap-2">
              {speakable ? (
                <UnifiedTtsPlayer
                  variant="inline"
                  text={speakable}
                  lang={trackToSpeechLang(track)}
                />
              ) : null}
              {source ? <span className="text-xs text-ink-ghost">{source}</span> : null}
            </div>
          );
        }}
      />
    </div>
  );
}
