import { useCallback, useRef, useState } from 'react';
import { useAgentGateway } from './useAgentGateway.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';

export interface WordTutorMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  isStreaming?: boolean;
  toolCalls?: Array<{ callId?: string; toolName: string; done?: boolean }>;
}

interface WordTutorTarget {
  word: string;
  reading: string;
  meaning: string;
  usage: string;
}

/** 单词内嵌 AI 会话：流式输出逐字进组件；模型调工具落库后刷新词汇查询，内容立变。 */
export function useWordTutor(target: WordTutorTarget, options?: { onComplete?: () => void }) {
  const gateway = useAgentGateway();
  const [messages, setMessages] = useState<WordTutorMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const idRef = useRef(0);

  const send = useCallback((input: string) => {
    const text = input.trim();
    if (!text || !gateway.isConnected) return false;
    const userMsg: WordTutorMessage = { id: `wtu-${++idRef.current}`, sender: 'user', text };
    const aiMsg: WordTutorMessage = { id: `wta-${idRef.current}`, sender: 'ai', text: '', isStreaming: true };
    setMessages(previous => [...previous, userMsg, aiMsg]);
    setIsTyping(true);
    const profile = useUserProfileStore.getState().profile;
    const prefs = usePreferencesStore.getState();
    const threadId = prefs.learningThreadId;
    const coachModelId = prefs.coachModelId;
    const coachEffort = prefs.coachEffort;
    const snapshot = {
      targetLanguage: normalizeTrackLanguage(profile.targetLanguage),
      learnerLevel: profile.overallLevel,
      locale: 'zh-CN',
      ui: { activeTab: 'CARDS', openTutor: false },
      focus: {
        kind: 'QUESTION',
        surface: `请讲透「${target.word}」（${target.reading || '无读音'}）：${target.meaning}。${target.usage}`,
        correctAnswer: target.word,
        explanation: target.usage,
        skillTag: '生词精学 · 讲透',
      },
      userIntentHint: 'EXPLAIN',
    };
    return gateway.sendTurnStream({
      input: text,
      intent: 'EXPLAIN',
      contextSnapshot: snapshot,
      agentOptions: {
        preferCodex: true,
        lane: 'learning',
        ephemeral: false,
        ...(threadId ? { threadId } : {}),
        ...(coachModelId ? { model: coachModelId } : {}),
        ...(coachEffort ? { effort: coachEffort } : {}),
      },
      onDelta: (_delta, accumulated) => {
        setMessages(previous => previous.map(message => message.id === aiMsg.id ? { ...message, text: accumulated } : message));
      },
      onToolCall: (info) => {
        setMessages(previous => previous.map(message => message.id === aiMsg.id
          ? { ...message, toolCalls: [...(message.toolCalls ?? []), { ...(info.callId ? { callId: info.callId } : {}), toolName: info.toolName, done: false }] }
          : message));
      },
      onComplete: (data) => {
        setIsTyping(false);
        if (data.threadId) usePreferencesStore.getState().setLearningThreadId(data.threadId);
        setMessages(previous => previous.map(message => message.id === aiMsg.id
          ? { ...message, text: data.finalOutput || message.text, isStreaming: false, toolCalls: (message.toolCalls ?? []).map(tool => ({ ...tool, done: true })) }
          : message));
        options?.onComplete?.();
      },
      onError: () => {
        setIsTyping(false);
        setMessages(previous => previous.map(message => message.id === aiMsg.id
          ? { ...message, text: message.text || '抱歉，导师连接遇到网络异常，请确认网关已启动后重试。', isStreaming: false }
          : message));
      },
    });
  }, [gateway, target, options?.onComplete]);

  const stop = useCallback(() => {
    gateway.interruptTurn('learning');
    setIsTyping(false);
    setMessages(previous => previous.map(message => message.isStreaming ? { ...message, isStreaming: false } : message));
  }, [gateway]);

  return { messages, isTyping, connected: gateway.isConnected, send, stop };
}
