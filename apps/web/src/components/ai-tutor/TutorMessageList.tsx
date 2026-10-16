import React from 'react';
import { useChatScroll } from '../agent-chat/use-chat-scroll.js';
import { ArrowDown, Bot, User, Square, RotateCcw, Reply, Wrench } from 'lucide-react';
import { Button } from '../ui/button.js';
import { MarkdownText } from '../common/MarkdownText.js';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import { toSpeakableText } from '../../lib/speakable.js';
import { trackToSpeechLang } from '../../config/speech-language.js';
import { extractFollowUps, extractPredictedFollowUps } from '../../lib/followups.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';
import type { TutorStreamMessage } from './useTutorStream.js';

interface TutorMessageListProps {
  messages: TutorStreamMessage[];
  track: TrackLanguage;
  isTyping: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onChipSend: (question: string) => void;
  onRetryOffline: (msg: TutorStreamMessage) => void;
  onInterrupt: () => void;
}

/** 题目导师消息流：气泡 + 工具证据 + 离线重发 + 追问 chips + 输入态打断。*/
export function TutorMessageList(props: TutorMessageListProps) {
  const { messages: items, track, isTyping, messagesEndRef, onChipSend, onRetryOffline, onInterrupt } = props;
  const { scrollRef, stickToLatest, handleScroll, jumpToLatest } = useChatScroll(items, isTyping);

  return (
    <>
      <div ref={scrollRef} onScroll={handleScroll} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto p-4 space-y-4">
        {items.map((msg) => {
          const isAi = msg.sender === 'ai';
          // 每条 AI 回答自带追问卡片（预测块 > 正文真问题，上限 3；流式中不算）
          const predicted =
            isAi && !msg.isStreaming && msg.text.trim()
              ? extractPredictedFollowUps(msg.text)
              : { chips: [] as string[], displayText: msg.text };
          const mergedCards: string[] = [...predicted.chips];
          if (isAi && !msg.isStreaming && msg.text.trim()) {
            for (const q of extractFollowUps(predicted.displayText)) {
              if (!mergedCards.includes(q)) mergedCards.push(q);
              if (mergedCards.length >= 3) break;
            }
          }
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 ${isAi ? '' : 'flex-row-reverse'}`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs ${
                  isAi
                    ? 'bg-tone-amber-500 text-tone-stone-950 font-bold'
                    : 'bg-tone-stone-700 text-tone-white'
                }`}
              >
                {isAi ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>
              <div
                className={`transition-colors max-w-[85%] p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${ isAi ? 'bg-tone-white dark:bg-veil-stone-900o90 text-ink-soft border border-line-accent shadow-sm rounded-tl-none font-serif' : 'bg-tone-amber-500 text-tone-stone-950 font-medium rounded-tr-none shadow-sm' }`}
              >
                {isAi && msg.reasoning ? (
                  <div className="mb-2 text-xs text-ink-ghost border-l-2 border-tone-amber-500o40 pl-2 font-sans">
                    <MarkdownText text={msg.reasoning} />
                  </div>
                ) : null}
                {isAi ? (
                  <MarkdownText text={predicted.displayText} />
                ) : (
                  msg.text
                )}
                {msg.isStreaming && (
                  <span className="inline-block w-1.5 h-4 ml-1 bg-tone-amber-500 animate-pulse motion-reduce:animate-none align-middle" aria-hidden />
                )}
                {isAi && (msg.toolCalls?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(msg.toolCalls ?? []).map((t, i) => (
                      <span
                        key={t.callId ?? `${t.toolName}-${i}`}
                        className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md border border-line-sky-500o30 text-ink-sky-700-sky-300"
                        title={t.done ? '工具调用完成' : '工具调用中…'}
                      >
                        <Wrench className="w-2.5 h-2.5" />
                        {t.toolName}
                        {t.done ? '' : '…'}
                      </span>
                    ))}
                  </div>
                )}
                {isAi && !msg.isStreaming && (msg.offline || msg.failed) && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => onRetryOffline(msg)}
                      disabled={isTyping}
                      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md border border-tone-amber-500o40 text-accent-ink-strong hover:bg-wash-amber-500o10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      title="连接恢复后重新发送"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      {msg.failed ? '回复失败 · 重试' : '离线回答 · 点击重发'}
                    </button>
                  </div>
                )}
                {isAi && !msg.isStreaming && msg.source && (
                  <div className="mt-2">
                    <span
                      className={`inline-block text-xs px-1.5 py-0.5 rounded-md border ${
                        msg.source === 'streamed'
                          ? 'border-line-emerald-500o30 text-ink-emerald-600-emerald-400'
                          : msg.source === 'fallback'
                            ? 'border-tone-amber-500o40 text-accent-ink-strong'
                            : 'border-line-stone-300-stone-700 text-ink-stone-400'
                      }`}
                      title={
                        msg.source === 'streamed'
                          ? '本轮由模型实时生成'
                          : msg.source === 'fallback'
                            ? '模型未响应，当前为本地规则回退内容'
                            : '本轮未请求模型'
                      }
                    >
                      {msg.source === 'streamed'
                        ? 'AI 直出'
                        : msg.source === 'fallback'
                          ? '本地回退'
                          : '本地应答'}
                    </span>
                  </div>
                )}
                {isAi && !msg.isStreaming && (() => {
                  // 朗读只读正文：预测块是中文问题串，用日语声音硬读是灾难
                  const speakable = toSpeakableText(predicted.displayText, track);
                  return speakable ? (
                    <div className="mt-1.5">
                      <UnifiedTtsPlayer
                        variant="inline"
                        text={speakable}
                        lang={trackToSpeechLang(track)}
                      />
                    </div>
                  ) : null;
                })()}
                {isAi && !msg.isStreaming && mergedCards.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-line-amber-900o10-amber-500o10 space-y-1.5 font-sans">
                    {mergedCards.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onChipSend(q)}
                        disabled={isTyping}
                        title="对这个问题感兴趣？点一下直接问"
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-line-amber-500o30 bg-wash-amber-500o5 hover:bg-wash-amber-500o15 text-left text-xs text-ink-mute-deep transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <span className="leading-relaxed">{q}</span>
                        <Reply className="w-3.5 h-3.5 shrink-0 text-accent-ink" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-wash-amber-500o10 border border-tone-amber-500o20 text-xs text-accent-ink-strong">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 animate-spin" />
              <span>导师正在组织讲解…</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onInterrupt}
              className="h-6 px-2 text-xs text-ink-amber-800-amber-200 hover:bg-tone-amber-500o20 gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <Square className="w-3 h-3 fill-current" />
              停止生成
            </Button>
          </div>
        )}
        {!stickToLatest ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="sticky bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-paper-soft px-2.5 py-1 text-xs text-ink-soft shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ArrowDown className="size-3" />
            回到最新
          </button>
        ) : null}
        <div ref={messagesEndRef} />
      </div>
    </>
  );
}
