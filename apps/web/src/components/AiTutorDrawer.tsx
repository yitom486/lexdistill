import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Send, Bot, User, Square, Wifi, WifiOff, RotateCcw, X, Reply } from 'lucide-react';
import { toast } from 'sonner';
import type { ContextSnapshot } from '@study-studio/agent-runtime';
import { sound } from '../utils/audio.js';
import { useAgentGateway } from '../hooks/useAgentGateway.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import {
  SheetHeader,
} from './ui/sheet.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { ErrorBoundary } from './common/ErrorBoundary.js';
import { MarkdownText } from './common/MarkdownText.js';
import { UnifiedTtsPlayer } from './UnifiedTtsPlayer.js';
import { toSpeakableText } from '../lib/speakable.js';
import { extractFollowUps, extractPredictedFollowUps } from '../lib/followups.js';
import { trackToSpeechLang } from '../config/speech-language.js';
import {
  buildTutorBootstrapPrompt,
  buildTutorOfflineReply,
  buildTutorOpeningGreeting,
  getTutorTrackCopy,
} from '../copy/tutor-track-copy.js';
import { normalizeTrackLanguage, type TrackLanguage } from '../learning/learning-shell.js';

import type { AiTutorContext } from '../stores/tutor-context.js';

export type { AiTutorContext };

interface MessageItem {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  timestamp: string;
  isStreaming?: boolean;
  reasoning?: string;
  /** 本轮 AI 输出来源（网关结构化执行摘要）：直出 / 本地回退 / 未请求模型 */
  source?: 'streamed' | 'fallback' | 'not_requested';
  /** 离线兜底内容：网关恢复后可一键重发转真 AI */
  offline?: boolean;
  retryInput?: string;
  /** 本轮模型调用过的工具（调用即记名，完成即标 done，过程透明）。 */
  toolCalls?: Array<{ callId?: string; toolName: string; done?: boolean }>;
}

interface AiTutorDrawerProps {
  isOpen: boolean;
  /** false 时不渲染；true 时即使关闭也 keep-alive */
  mounted?: boolean;
  onClose: () => void;
  context: AiTutorContext | null;
  widthPx?: number;
  onResizePointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

function normalizeTutorLanguage(lang: string): TrackLanguage {
  return normalizeTrackLanguage(lang);
}

// 与网关 agent-router.ts 的 lite 短问阈值对齐（prompt.length <= 24）。
const LITE_SHORT_PROMPT_MAX = 24;
// 追问室所有在线 EXPLAIN 发送统一追加：让模型预测用户接下来最可能问的短问题。
const PREDICTED_FOLLOWUP_SUFFIX =
  '\n\n【输出要求追加】回答末尾另起一段：先单独写一行【追问】，然后写 3 行，预测我接下来最可能想问的短问题（每行一个，以问号结尾，不展开讲解）。';

function buildTutorClientSnapshot(
  ctx: AiTutorContext,
  activeTab: string,
  profile: { targetLanguage: 'ja' | 'en' | 'ko'; overallLevel: string }
): Partial<ContextSnapshot> {
  return {
    targetLanguage: normalizeTutorLanguage(profile.targetLanguage),
    learnerLevel: profile.overallLevel,
    locale: 'zh-CN',
    ui: {
      activeTab,
      openTutor: true,
    },
    focus: {
      kind: 'QUESTION',
      surface: ctx.questionText,
      correctAnswer: ctx.correctAnswer,
      userAnswer: ctx.userAnswer,
      explanation: ctx.explanation,
      skillTag: ctx.skillTag,
    },
    userIntentHint: 'EXPLAIN',
  };
}

export function AiTutorDrawer({
  isOpen,
  mounted = true,
  onClose,
  context,
  widthPx = 448,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}: AiTutorDrawerProps) {
  const gateway = useAgentGateway();
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeStreamMsgIdRef = useRef<string | null>(null);
  const bootstrappedRef = useRef<string | null>(null);

  const activeTab = useStudySessionStore((s) => s.activeTab);
  const profile = useUserProfileStore((s) => s.profile);
  const setLearningThreadId = usePreferencesStore((s) => s.setLearningThreadId);

  const buildSnapshot = useCallback((): Partial<ContextSnapshot> | undefined => {
    if (!context) return undefined;
    return buildTutorClientSnapshot(context, activeTab, {
      targetLanguage: normalizeTutorLanguage(profile.targetLanguage),
      overallLevel: profile.overallLevel,
    });
  }, [context, activeTab, profile.targetLanguage, profile.overallLevel]);

  const attachStreamToMessage = useCallback(
    (aiMsgId: string, input: string, intent: 'EXPLAIN' | 'FREE_COACH' = 'EXPLAIN') => {
      if (!gateway.isConnected) return false;

      const threadId = usePreferencesStore.getState().learningThreadId;

      return gateway.sendTurnStream({
        // 与网关 agent-router.ts 的 lite 短问阈值对齐（prompt.length <= 24）：
        // 短问题走极速规则通道，不追加预测指令；长问题走模型，追加【追问】预测指令。
        input:
          input.length > LITE_SHORT_PROMPT_MAX ? input + PREDICTED_FOLLOWUP_SUFFIX : input,
        intent,
        contextSnapshot: buildSnapshot(),
        agentOptions: {
          preferCodex: true,
          lane: 'learning',
          ephemeral: false,
          ...(threadId ? { threadId } : {}),
        },
        onDelta: (_delta, accumulated) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, text: accumulated } : m))
          );
        },
        onReasoningDelta: (_delta, accumulated) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId ? { ...m, reasoning: accumulated } : m
            )
          );
        },
        onToolCall: (info) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    toolCalls: [
                      ...(m.toolCalls ?? []),
                      {
                        ...(info.callId ? { callId: info.callId } : {}),
                        toolName: info.toolName,
                        done: false,
                      },
                    ],
                  }
                : m
            )
          );
        },
        onComplete: (data) => {
          sound.playCorrect();
          setIsTyping(false);
          activeStreamMsgIdRef.current = null;
          if (data.threadId) setLearningThreadId(data.threadId);
          const outcome = data.outcome ?? data.codexOutcome;
          const source =
            outcome === 'streamed'
              ? ('streamed' as const)
              : outcome === 'fallback'
                ? ('fallback' as const)
                : ('not_requested' as const);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    text: data.finalOutput || m.text,
                    isStreaming: false,
                    source,
                    toolCalls: (m.toolCalls ?? []).map((t) => ({ ...t, done: true })),
                  }
                : m
            )
          );
        },
        onError: () => {
          setIsTyping(false);
          activeStreamMsgIdRef.current = null;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    text:
                      m.text ||
                      '抱歉，导师连接遇到网络异常，请确认网关已启动后重试。',
                    isStreaming: false,
                  }
                : m
            )
          );
        },
      });
    },
    [gateway, buildSnapshot, setLearningThreadId]
  );

  useEffect(() => {
    // 关闭时不清 bootstrappedRef，避免再次打开同一题时重跑 bootstrap 冲掉本地气泡
    if (!isOpen || !context) return;

    const track = normalizeTutorLanguage(profile.targetLanguage);
    const sessionKey = `${track}|${context.skillTag}|${context.questionText}`;
    if (bootstrappedRef.current === sessionKey) return;
    bootstrappedRef.current = sessionKey;

    sound.playClick();
    setInputText('');
    setIsTyping(false);
    activeStreamMsgIdRef.current = null;

    if (gateway.isConnected) {
      const aiMsgId = `ai-boot-${Date.now()}`;
      activeStreamMsgIdRef.current = aiMsgId;
      setMessages([
        {
          id: aiMsgId,
          sender: 'ai',
          text: '',
          timestamp: '刚刚',
          isStreaming: true,
        },
      ]);
      setIsTyping(true);
      const prompt = buildTutorBootstrapPrompt(track, context);
      const sent = attachStreamToMessage(aiMsgId, prompt, 'EXPLAIN');
      if (!sent) {
        setMessages([
          {
            id: 'msg-init-offline',
            sender: 'ai',
            text: buildTutorOpeningGreeting(track, context, true),
            timestamp: '刚刚',
            offline: true,
            retryInput: prompt,
          },
        ]);
        setIsTyping(false);
      }
      return;
    }

    setMessages([
      {
        id: 'msg-init',
        sender: 'ai',
        text: buildTutorOpeningGreeting(track, context, false),
        timestamp: '刚刚',
      },
    ]);
  }, [isOpen, context, gateway.isConnected, attachStreamToMessage, profile.targetLanguage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleInterrupt = () => {
    if (gateway) {
      gateway.interruptTurn('learning');
    }
    setIsTyping(false);
    if (activeStreamMsgIdRef.current) {
      const msgId = activeStreamMsgIdRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                isStreaming: false,
                text: m.text ? m.text + '\n\n*(已终止生成)*' : '*(生成已取消)*',
              }
            : m
        )
      );
      activeStreamMsgIdRef.current = null;
    }
  };

  const handleSendMessage = (textToSend?: string) => {
    const content = (textToSend || inputText).trim();
    if (!content || isTyping) return;

    sound.playClick();
    const userMsgId = `user-${Date.now()}`;
    const aiMsgId = `ai-${Date.now()}`;
    activeStreamMsgIdRef.current = aiMsgId;

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        sender: 'user',
        text: content,
        timestamp: '刚刚',
      },
      {
        id: aiMsgId,
        sender: 'ai',
        text: '',
        timestamp: '刚刚',
        isStreaming: true,
      },
    ]);
    setInputText('');
    setIsTyping(true);

    if (gateway && gateway.isConnected) {
      const sent = attachStreamToMessage(aiMsgId, content, 'EXPLAIN');
      if (sent) return;
    }

    setTimeout(() => {
      const track = normalizeTutorLanguage(profile.targetLanguage);
      const replyText = buildTutorOfflineReply(track, content, context?.skillTag);

      sound.playCorrect();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                text: replyText,
                isStreaming: false,
                offline: true,
                retryInput: content,
              }
            : m
        )
      );
      setIsTyping(false);
      activeStreamMsgIdRef.current = null;
    }, 650);
  };

  /** 离线兜底气泡一键重发：网关恢复后转真 AI，仍未连通则 toast 提示。 */
  const handleRetryOffline = (msg: MessageItem) => {
    if (!msg.retryInput) return;
    if (!gateway.isConnected) {
      gateway.connect();
      toast.info('正在重连网关…连通后可再点一次重发。');
      return;
    }
    sound.playClick();
    setIsTyping(true);
    activeStreamMsgIdRef.current = msg.id;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id ? { ...m, text: '', isStreaming: true, offline: false } : m
      )
    );
    const sent = attachStreamToMessage(msg.id, msg.retryInput, 'EXPLAIN');
    if (!sent) {
      setIsTyping(false);
      activeStreamMsgIdRef.current = null;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, text: msg.text, isStreaming: false, offline: true } : m
        )
      );
      toast.error('网关仍未连通，请确认网关已启动后重试。');
    }
  };

  const track = normalizeTutorLanguage(profile.targetLanguage);
  const tutorCopy = getTutorTrackCopy(track);
  // “就本轮考我”：让 AI 按本次问答现场出一道单选题（对话内考，不进题库，不伪造入库）。
  const handleQuizMe = () => {
    const tag = context?.skillTag ? `关于「${context.skillTag}」` : '';
    handleSendMessage(
      `根据以上${tag}的讲解，出 1 道单选题考我：只给题干和 A-D 四个选项，先别公布答案，等我回答后再批改和讲解。`
    );
  };

  // “拓展追问”：让 AI 按本次问答给出值得深挖的延伸问题（编号短句，回来即变 chips）。
  const handleExpandAsk = () => {
    const tag = context?.skillTag ? `关于「${context.skillTag}」` : '';
    handleSendMessage(
      `基于以上${tag}的讨论，给我 3 个值得深挖的拓展问题：编号，每条一行，以问号结尾，简短，不要展开讲解。`
    );
  };

  // ---- 浮动定位（可任意拖拽）：默认右侧垂直居中，脱离文档流，不挤压主屏 ----
  const [panelPos, setPanelPos] = useState<{ right: number; top: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origRight: number; origTop: number } | null>(null);

  // Esc 关闭（非模态，无焦点陷阱）
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handlePanelDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button,input,select,textarea,a')) return;
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
    const current = panelPos ?? {
      right: 16,
      top: Math.max(8, vh * 0.11),
    };
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origRight: current.right,
      origTop: current.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePanelDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(vw, widthPx);
    const right = Math.min(Math.max(drag.origRight - (e.clientX - drag.startX), -(w - 120)), vw - 120);
    const top = Math.min(Math.max(drag.origTop + (e.clientY - drag.startY), 0), vh - 60);
    setPanelPos({ right, top });
  };

  const handlePanelDragEnd = () => {
    dragState.current = null;
  };

  const isGatewayConnected = gateway.isConnected;

  if (!mounted || !context) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const panelWidth = Math.min(viewportW, widthPx);
  const fallbackPos = { right: 16, top: Math.max(8, viewportH * 0.11) };
  const pos = panelPos ?? fallbackPos;
  const right = Math.min(Math.max(pos.right, -(panelWidth - 120)), viewportW - 120);
  const top = Math.min(Math.max(pos.top, 0), viewportH - 60);

  return createPortal(
    <div
      role="dialog"
      aria-label="AI 导师"
      className="fixed z-50 flex flex-col rounded-2xl border border-line-amber-900o15-amber-500o20 bg-paper-soft shadow-2xl"
      style={{ right, top, width: panelWidth, height: '78vh', display: isOpen ? 'flex' : 'none' }}
    >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整题目导师宽度"
          tabIndex={isOpen ? 0 : -1}
          className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-ew-resize bg-transparent hover:bg-tone-amber-500o35 active:bg-tone-amber-500o50"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        />
        <>
            <SheetHeader
              className="bg-wash-amber-500o10-amber-500o15 p-4 border-b border-line-amber-900o10-amber-500o10 shrink-0 cursor-move select-none"
              onPointerDown={handlePanelDragStart}
              onPointerMove={handlePanelDragMove}
              onPointerUp={handlePanelDragEnd}
              onPointerCancel={handlePanelDragEnd}
            >
              <div className="flex items-center justify-between pr-8">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-tone-amber-500 text-tone-stone-950 shadow-sm">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="flex items-center gap-1.5 text-base font-bold font-serif leading-none tracking-tight text-ink">
                      AI 智能导师专属追问室
                      <Sparkles className="w-3.5 h-3.5 text-accent-ink" />
                    </h2>
                    <p className="text-xs text-ink-ghost">
                      {tutorCopy.headerHint} · 聚焦：{context.skillTag}
                      <span className="ml-1 text-ink-stone-500">· 关闭保留会话</span>
                    </p>
                  </div>
                </div>
                <Badge
                  variant={isGatewayConnected ? 'emerald' : 'outline'}
                  className="text-[10px] gap-1 px-2 py-0.5"
                >
                  {isGatewayConnected ? (
                    <>
                      <Wifi className="w-2.5 h-2.5" />
                      Gateway 实时流式
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-2.5 h-2.5 text-ink-stone-400" />
                      离线演练
                    </>
                  )}
                </Badge>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭"
                  className="rounded-xl p-1.5 text-ink-stone-400 transition-colors hover:bg-veil-stone-200o60 hover:text-tone-stone-700 dark:hover:bg-tone-stone-800 dark:hover:text-ink-stone-200 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </SheetHeader>

            <div className="p-3 bg-wash-amber-50o70-stone-900o70 border-b border-line-amber-900o10-amber-500o10 text-xs space-y-1 shrink-0">
              <Badge variant="amber" className="mb-1">
                📌 正在剖析题干
              </Badge>
              <p className="text-ink-soft font-medium">
                {context.questionText}
              </p>
              <div className="flex items-center gap-3 text-[11px] text-ink-stone-500 pt-0.5">
                <span>
                  标准答案：
                  <strong className="text-ink-emerald-700-emerald-400">
                    {context.correctAnswer}
                  </strong>
                </span>
                {context.userAnswer && (
                  <span>
                    你的提交：
                    <strong className="text-ink-rose-600">{context.userAnswer}</strong>
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <ErrorBoundary
                variant="embedded"
                title="对话渲染遇到临时异常"
                message="导师气泡渲染出现异常，已保护对话资产，可点击重新加载。"
              >
                {messages.map((msg) => {
                const isAi = msg.sender === 'ai';
                // Gemini 式：每条 AI 回答自带追问卡片（预测块 > 正文真问题，上限 3；流式中不算）
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
                        <div className="mb-2 text-[11px] text-ink-ghost border-l-2 border-tone-amber-500o40 pl-2 font-sans">
                          <MarkdownText text={msg.reasoning} />
                        </div>
                      ) : null}
                      {isAi ? (
                        <MarkdownText text={predicted.displayText} />
                      ) : (
                        msg.text
                      )}
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-4 ml-1 bg-tone-amber-500 animate-pulse align-middle" />
                      )}
                      {isAi && (msg.toolCalls?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(msg.toolCalls ?? []).map((t, i) => (
                            <span
                              key={t.callId ?? `${t.toolName}-${i}`}
                              className="inline-block text-[10px] px-1.5 py-0.5 rounded-md border border-line-sky-500o30 text-ink-sky-700-sky-300"
                              title={t.done ? '工具调用完成' : '工具调用中…'}
                            >
                              🔧 {t.toolName}
                              {t.done ? '' : '…'}
                            </span>
                          ))}
                        </div>
                      )}
                      {isAi && !msg.isStreaming && msg.offline && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => handleRetryOffline(msg)}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border border-tone-amber-500o40 text-accent-ink-strong hover:bg-wash-amber-500o10 cursor-pointer"
                            title="网关恢复后重新发送，转真 AI 作答"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            离线回答 · 点击重发
                          </button>
                        </div>
                      )}
                      {isAi && !msg.isStreaming && msg.source && (
                        <div className="mt-2">
                          <span
                            className={`inline-block text-[10px] px-1.5 py-0.5 rounded-md border ${
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
                              onClick={() => handleSendMessage(q)}
                              disabled={isTyping}
                              title="对这个问题感兴趣？点一下直接问"
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-line-amber-500o30 bg-wash-amber-500o5 hover:bg-wash-amber-500o15 text-left text-xs text-ink-mute-deep transition-colors cursor-pointer disabled:opacity-50"
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
                    <span>AI 导师正在实时组织讲解与分析...</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleInterrupt}
                    className="h-6 px-2 text-[11px] text-ink-amber-800-amber-200 hover:bg-tone-amber-500o20 gap-1 rounded"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    停止生成
                  </Button>
                </div>
              )}
              <div ref={messagesEndRef} />
              </ErrorBoundary>
            </div>

            <div className="px-4 py-2 bg-veil-stone-100o60-stone-900o40 border-t border-line-amber-900o10-amber-500o10 flex flex-wrap gap-1.5 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleQuizMe}
                disabled={isTyping}
                className="h-7 rounded-full text-[11px] px-2.5 border-tone-amber-500o50 text-accent-ink-strong"
                title="让 AI 按本次讲解现场出一道单选题"
              >
                📝 就本轮考我一题
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExpandAsk}
                disabled={isTyping}
                className="h-7 rounded-full text-[11px] px-2.5 border-tone-amber-500o50 text-accent-ink-strong"
                title="让 AI 按本次问答给出值得深挖的拓展问题"
              >
                ✨ 拓展追问
              </Button>
            </div>

            <div className="p-3 border-t border-line-accent shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="向 AI 导师追问（例如：请解释和『に関して』的区别）..."
                  className="flex-1 py-2.5 px-3.5 bg-surface-stone-100-stone-900 text-ink rounded-xl border border-line-soft text-xs sm:text-sm outline-none focus:border-tone-amber-500 transition-all"
                />
                {isTyping ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleInterrupt}
                    aria-label="停止"
                    className="border-line-amber-500o30 text-tone-amber-600 hover:bg-wash-amber-500o10"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!inputText.trim()}
                    aria-label="发送"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                )}
              </form>
            </div>
          </>
    </div>,
    document.body
  );
}
