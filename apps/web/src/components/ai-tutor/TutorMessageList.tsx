import React, { useCallback, useMemo } from 'react';
import { RotateCcw, Reply, Wrench } from 'lucide-react';
import { ChatEmptyState, ChatMessageList as YitomChatMessageList } from '@yitom/chat-ui';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import { toSpeakableText } from '../../lib/speakable.js';
import { trackToSpeechLang } from '../../config/speech-language.js';
import { extractFollowUps, extractPredictedFollowUps } from '../../lib/followups.js';
import { getPlatform } from '../../platform/capabilities.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';
import type { TutorStreamMessage } from './useTutorStream.js';
import { adaptTutorMessages } from './tutor-message-adapter.js';

interface TutorMessageListProps {
  messages: TutorStreamMessage[];
  track: TrackLanguage;
  isTyping: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onChipSend: (question: string) => void;
  onRetryOffline: (msg: TutorStreamMessage) => void;
  /** 由抽屉的输入区提供停止入口；列表本身不再渲染停止行 */
  onInterrupt: () => void;
}

/**
 * 题目导师消息流：渲染编排交给 `@yitom/chat-ui` 的 `ChatMessageList`
 * （历史窗口、贴底、思考折叠、Markdown、回到底部）。
 *
 * 导师专属的部分通过尾部插槽保留：工具证据、来源徽标、离线/失败重发、
 * 逐条朗读、追问 chips。头像与琥珀气泡随统一渲染退役——身份由抽屉顶栏承担。
 */
export function TutorMessageList(props: TutorMessageListProps) {
  const { messages, track, isTyping, messagesEndRef, onChipSend, onRetryOffline } = props;
  const theme = usePreferencesStore((s) => s.theme);

  const adapted = useMemo(() => adaptTutorMessages(messages), [messages]);
  const originalById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // 桌面端外链必须交给系统浏览器，否则会在 webview 里就地导航
  const handleLinkClick = useCallback((href: string) => {
    void getPlatform().openExternalUrl(href);
    return true;
  }, []);

  return (
    <YitomChatMessageList
      messages={adapted}
      threadId="tutor-drawer"
      prompting={isTyping}
      theme={theme === 'dark' ? 'dark' : 'light'}
      resolveMarkProposal={() => {}}
      className="flex-1"
      bottomRef={messagesEndRef}
      onLinkClick={handleLinkClick}
      emptyState={
        <ChatEmptyState
          title="题目导师"
          description="围绕当前题目追问，或换个说法再问一次。"
          hint="Enter 发送 · Shift+Enter 换行"
        />
      }
      renderMessageFooter={(message) => {
        const original = originalById.get(message.id);
        if (!original || original.sender !== 'ai') return null;

        const streaming = Boolean(original.isStreaming);
        const settled = !streaming && Boolean(original.text.trim());
        const predicted = settled ? extractPredictedFollowUps(original.text) : { chips: [] as string[], displayText: original.text };
        const speakable = settled ? toSpeakableText(predicted.displayText, track) : '';
        const tools = original.toolCalls ?? [];

        const chips: string[] = [...predicted.chips];
        if (settled) {
          for (const question of extractFollowUps(predicted.displayText)) {
            if (!chips.includes(question)) chips.push(question);
            if (chips.length >= 3) break;
          }
        }

        if (tools.length === 0 && !settled) return null;
        if (tools.length === 0 && !original.source && !original.offline && !original.failed && !speakable && chips.length === 0) {
          return null;
        }

        return (
          <div className="mt-1.5 space-y-2">
            {tools.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tools.map((tool, index) => (
                  <span
                    key={tool.callId ?? `${tool.toolName}-${index}`}
                    className="inline-flex items-center gap-1 rounded-md border border-line-sky-500o30 px-1.5 py-0.5 text-xs text-ink-sky-700-sky-300"
                    title={tool.done ? '工具调用完成' : '工具调用中…'}
                  >
                    <Wrench className="h-2.5 w-2.5" />
                    {tool.toolName}
                    {tool.done ? '' : '…'}
                  </span>
                ))}
              </div>
            ) : null}

            {settled && (original.offline || original.failed) ? (
              <button
                type="button"
                onClick={() => onRetryOffline(original)}
                disabled={isTyping}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-tone-amber-500o40 px-1.5 py-0.5 text-xs text-accent-ink-strong hover:bg-wash-amber-500o10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                title="连接恢复后重新发送"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                {original.failed ? '回复失败 · 重试' : '离线回答 · 点击重发'}
              </button>
            ) : null}

            {settled && original.source ? (
              <span
                className={`inline-block rounded-md border px-1.5 py-0.5 text-xs ${
                  original.source === 'streamed'
                    ? 'border-line-emerald-500o30 text-ink-emerald-600-emerald-400'
                    : original.source === 'fallback'
                      ? 'border-tone-amber-500o40 text-accent-ink-strong'
                      : 'border-line-stone-300-stone-700 text-ink-stone-400'
                }`}
                title={
                  original.source === 'streamed'
                    ? '本轮由模型实时生成'
                    : original.source === 'fallback'
                      ? '模型未响应，当前为本地规则回退内容'
                      : '本轮未请求模型'
                }
              >
                {original.source === 'streamed' ? 'AI 直出' : original.source === 'fallback' ? '本地回退' : '本地应答'}
              </span>
            ) : null}

            {speakable ? (
              <UnifiedTtsPlayer variant="inline" text={speakable} lang={trackToSpeechLang(track)} />
            ) : null}

            {chips.length > 0 ? (
              <div className="space-y-1.5 border-t border-line-amber-900o10-amber-500o10 pt-2 font-sans">
                {chips.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => onChipSend(question)}
                    disabled={isTyping}
                    title="对这个问题感兴趣？点一下直接问"
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-line-amber-500o30 bg-wash-amber-500o5 px-3 py-2 text-left text-xs text-ink-mute-deep transition-colors hover:bg-wash-amber-500o15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
                  >
                    <span className="leading-relaxed">{question}</span>
                    <Reply className="h-3.5 w-3.5 shrink-0 text-accent-ink" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      }}
    />
  );
}
