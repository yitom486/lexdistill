import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { sound } from '../utils/audio.js';
import { useAgentGateway } from '../hooks/useAgentGateway.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import type { ContextSnapshot } from '@study-studio/agent-runtime';
import {
  buildTutorBootstrapPrompt,
  buildTutorOfflineReply,
  buildTutorOpeningGreeting,
  getTutorTrackCopy,
} from '../copy/tutor-track-copy.js';

import type { AiTutorContext } from '../stores/tutor-context.js';

export type { AiTutorContext };

import { useTutorStream } from './ai-tutor/useTutorStream.js';
import { useTutorPanelFocus } from './ai-tutor/useTutorPanelFocus.js';
import { useDragPanel, resolvePanelPos } from './ai-tutor/useDragPanel.js';
import { normalizeTutorLanguage, buildTutorClientSnapshot } from './ai-tutor/tutorSnapshot.js';
import { buildQuizMePrompt, buildExpandAskPrompt } from './ai-tutor/tutorQuickPrompts.js';
import { TutorDrawerHeader } from './ai-tutor/TutorDrawerHeader.js';
import { TutorMessageList } from './ai-tutor/TutorMessageList.js';
import { TutorComposer } from './ai-tutor/TutorComposer.js';

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
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useTutorPanelFocus(isOpen, mounted, Boolean(context));

  const activeTab = useStudySessionStore((s) => s.activeTab);
  const profile = useUserProfileStore((s) => s.profile);

  const buildSnapshot = useCallback((): Partial<ContextSnapshot> | undefined => {
    if (!context) return undefined;
    return buildTutorClientSnapshot(context, activeTab, {
      targetLanguage: normalizeTutorLanguage(profile.targetLanguage),
      overallLevel: profile.overallLevel,
    });
  }, [context, activeTab, profile.targetLanguage, profile.overallLevel]);

  const {
    messages,
    setMessages,
    isTyping,
    setIsTyping,
    activeStreamMsgIdRef,
    attachStreamToMessage,
    interruptStream,
    retryOfflineMessage,
  } = useTutorStream({ gateway, buildSnapshot });

  const bootstrappedRef = useRef<string | null>(null);
  useEffect(() => () => { bootstrappedRef.current = null; }, []);
  const { panelPos, handleDragStart, handleDragMove, handleDragEnd } = useDragPanel(widthPx);

  useEffect(() => {
    // 关闭时不清 bootstrappedRef，避免再次打开同一题时重跑 bootstrap 冲掉本地气泡
    if (!isOpen || !context) return;

    const track = normalizeTutorLanguage(profile.targetLanguage);
    const sessionKey = JSON.stringify([track, context.skillTag, context.questionText, context.correctAnswer, context.userAnswer]);
    if (bootstrappedRef.current === sessionKey) return;
    if (bootstrappedRef.current !== null) interruptStream();
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
        text: buildTutorOpeningGreeting(track, context, true),
        timestamp: '刚刚',
        offline: true,
        retryInput: buildTutorBootstrapPrompt(track, context),
      },
    ]);
  }, [isOpen, context, gateway.isConnected, attachStreamToMessage, profile.targetLanguage, interruptStream]);

  // 列表内粘底滚动（用户上翻后不强制拉回），容器不再全局 scrollIntoView

  // Esc 关闭（非模态，无焦点陷阱）
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleInterrupt = () => {
    interruptStream();
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
  };

  const track = normalizeTutorLanguage(profile.targetLanguage);
  const tutorCopy = getTutorTrackCopy(track);
  const handleQuizMe = () => {
    handleSendMessage(buildQuizMePrompt(context?.skillTag));
  };
  const handleExpandAsk = () => {
    handleSendMessage(buildExpandAskPrompt(context?.skillTag));
  };

  if (!mounted || !context) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }
  const panelWidth = Math.min(window.innerWidth, widthPx);
  const { right, top } = resolvePanelPos(panelPos, panelWidth, {
    w: window.innerWidth,
    h: window.innerHeight,
  });

  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="题目导师"
      aria-hidden={!isOpen}
      inert={!isOpen}
      className="fixed z-50 flex flex-col rounded-2xl border border-line-amber-900o15-amber-500o20 bg-paper-soft shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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
        <TutorDrawerHeader
          trackName={tutorCopy.trackName}
          headerHint={tutorCopy.headerHint}
          skillTag={context.skillTag}
          questionText={context.questionText}
          correctAnswer={context.correctAnswer}
          userAnswer={context.userAnswer}
          isGatewayConnected={gateway.isConnected}
          onClose={onClose}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        />

        <TutorMessageList
          messages={messages}
          track={track}
          isTyping={isTyping}
          messagesEndRef={messagesEndRef}
          onChipSend={(q) => handleSendMessage(q)}
          onRetryOffline={retryOfflineMessage}
          onInterrupt={handleInterrupt}
        />

        <TutorComposer
          isTyping={isTyping}
          inputText={inputText}
          onInputChange={setInputText}
          onQuizMe={handleQuizMe}
          onExpandAsk={handleExpandAsk}
          onSend={() => handleSendMessage()}
          onInterrupt={handleInterrupt}
        />
    </div>,
    document.body
  );
}
