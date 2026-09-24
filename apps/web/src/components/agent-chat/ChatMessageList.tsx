import {
  Bot,
  ListOrdered,
  Play,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Button } from '../ui/button.js';
import { BorderBeam } from '../magicui/index.js';
import { ChatTurnActivity, StreamingReplyPlaceholder } from '../ChatTurnActivity.js';
import { MarkdownText } from '../common/MarkdownText.js';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import { toSpeakableText } from '../../lib/speakable.js';
import { trackToSpeechLang } from '../../config/tts-voice-personas.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';
import { stripTranscriptNoise } from '../../lib/chat-transcript.js';
import { sound } from '../../utils/audio.js';
import type { AgentQueuedSubmissionDto } from '../../queries/useAgentQueries.js';
import type { ChatMessage } from './chat-shared.js';
import { effortLabel } from './chat-shared.js';

interface ChatMessageListProps {
  queueItems: AgentQueuedSubmissionDto[];
  busy: boolean;
  startQueuedTurn: (queuedSubmissionId?: string) => void;
  coachThreadId: string;
  deleteQueueItem: { mutate: (vars: { sessionId: string; queuedId: string }) => void };
  messages: ChatMessage[];
  respondApproval: (
    approvalId: string,
    decision: 'accept' | 'acceptForSession' | 'decline'
  ) => void;
  endRef: React.RefObject<HTMLDivElement | null>;
  coachEffort: string;
  track: TrackLanguage;
}

/** P2-1 拆分：队列横幅 + 消息气泡/审批卡（纯搬运自 AgentChatPanel）。 */
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
    coachEffort,
    track,
  } = props;
  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
      {queueItems.length > 0 ? (
        <div className="rounded-xl border border-line-sky-500o25 bg-wash-sky-500o5 px-2.5 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink-sky-300o90">
              <ListOrdered className="size-3" />
              下一轮队列 · {queueItems.length}
            </div>
            <Button
              type="button"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px] bg-tint-sky-700 hover:bg-tint-sky-600"
              disabled={busy}
              title="立即消费队列"
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
                className="flex items-start gap-1 rounded-lg bg-veil-stone-900o50 px-2 py-1"
              >
                <p className="min-w-0 flex-1 truncate text-[11px] text-tone-stone-300">{q.text}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0 text-ink-stone-500 hover:text-ink-rose-400"
                  title="移出队列"
                  onClick={() => {
                    if (!coachThreadId) return;
                    sound.playClick();
                    deleteQueueItem.mutate({
                      sessionId: coachThreadId,
                      queuedId: q.id,
                    });
                  }}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {messages.map((m) => (
        <div
          key={m.id}
          className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          {m.role === 'system' ? (
            <p className="w-full text-center text-[10px] text-ink-stone-500">{m.text}</p>
          ) : m.role === 'approval' && m.approval ? (
            <div className="w-full max-w-[95%] rounded-xl border border-tone-amber-500o35 bg-wash-amber-500o10 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-ink-amber-400" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="text-[11px] font-medium text-ink-amber-100o90">
                      需要批准 · {m.approval.action}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-stone-400">
                      {m.approval.description}
                    </p>
                  </div>
                  {m.approval.status === 'pending' ? (
                    <div className="space-y-2">
                      {m.approval.expiresAt ? (
                        <p className="text-[10px] text-tone-amber-500o80">
                          约 2 分钟内未操作将自动拒绝
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2.5 text-[11px] bg-tone-emerald-700 hover:bg-tone-emerald-600"
                          onClick={() =>
                            respondApproval(m.approval!.approvalId, 'accept')
                          }
                        >
                          允许
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2.5 text-[11px] bg-wash-emerald-800o80 hover:bg-tone-emerald-700"
                          onClick={() =>
                            respondApproval(
                              m.approval!.approvalId,
                              'acceptForSession'
                            )
                          }
                        >
                          本会话允许
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px] border-tone-stone-600"
                          onClick={() =>
                            respondApproval(m.approval!.approvalId, 'decline')
                          }
                        >
                          拒绝
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-ink-stone-500">
                      {m.approval.status === 'accepted'
                        ? '已允许'
                        : m.approval.status === 'accepted_session'
                          ? '已允许（本会话）'
                          : m.approval.status === 'timed_out'
                            ? '已超时自动拒绝'
                            : m.approval.status === 'cancelled'
                              ? '已取消'
                              : '已拒绝'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
          {m.role !== 'user' && (
            <div
              className={`mt-0.5 w-7 h-7 rounded-full bg-tone-stone-800 flex items-center justify-center shrink-0 ${
                m.streaming ? 'ring-2 ring-halo-sky-400o40' : ''
              }`}
            >
              <Bot
                className={`w-3.5 h-3.5 ${
                  m.streaming ? 'text-ink-sky-300' : 'text-ink-emerald-400'
                }`}
              />
            </div>
          )}
          {(() => {
            const waitingFirstToken =
              m.role !== 'user' &&
              Boolean(m.streaming) &&
              !m.text.trim() &&
              !m.reasoning &&
              !m.toolCalls?.length;
            return (
          <div
            className={`relative max-w-[88%] rounded-2xl text-[13px] leading-relaxed ${ m.role === 'user' ? 'bg-wash-sky-700o25 border border-line-sky-600o30 px-3 py-2 text-surface-stone-50' : waitingFirstToken ? 'px-1 py-1 text-ink-stone-200' : m.streaming ? 'overflow-hidden border border-line-sky-500o25 bg-veil-stone-900o40 px-3 py-2 text-ink-stone-200' : 'px-3 py-2 bg-transparent text-ink-stone-200' }`}
          >
            {m.role !== 'user' && m.streaming && !waitingFirstToken ? (
              <BorderBeam
                size={140}
                duration="var(--motion-border-beam-agent-message-duration)"
                colorFrom="var(--visual-agent-beam-from)"
                colorTo="var(--visual-agent-beam-to)"
                borderWidth={1.25}
              />
            ) : null}
            {m.role !== 'user' ? (
              <ChatTurnActivity
                streaming={Boolean(m.streaming)}
                {...(m.reasoning ? { reasoning: m.reasoning } : {})}
                effortLabel={effortLabel(coachEffort)}
                {...(m.toolCalls ? { toolCalls: m.toolCalls } : {})}
              />
            ) : null}
            {m.role === 'user' ? (
              <div className="whitespace-pre-wrap">{stripTranscriptNoise(m.text)}</div>
            ) : waitingFirstToken ? (
              <StreamingReplyPlaceholder />
            ) : (
              <div>
                <MarkdownText text={m.text} surface="dark" />
                {m.streaming && m.text ? (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 align-middle bg-wash-sky-400o80 animate-pulse" />
                ) : null}
                {!m.streaming && (() => {
                  const speakable = toSpeakableText(m.text, track);
                  return speakable ? (
                    <div className="mt-1">
                      <UnifiedTtsPlayer
                        variant="inline"
                        text={speakable}
                        lang={trackToSpeechLang(track)}
                      />
                    </div>
                  ) : null;
                })()}
              </div>
            )}
            {!m.streaming && m.source ? (
              <div className="mt-1.5 text-[10px] text-tone-stone-600">
                via {m.source === 'codex' ? 'Agent' : m.source}
              </div>
            ) : null}
          </div>
            );
          })()}
            </>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
