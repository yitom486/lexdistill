import { useCallback, useRef, useState } from 'react';
import { useAgentGateway } from './useAgentGateway.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';

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

/** 注册表探测缓存（60s）：固定任务发送前确认网关真有这些工具，没有就地提示，不断活路靠网关 fail-fast。 */
let cachedRegistryTools: { at: number; names: string[] } | null = null;

async function missingRegistryTools(wanted: readonly string[]): Promise<string[]> {
  const now = Date.now();
  if (!cachedRegistryTools || now - cachedRegistryTools.at > 60_000) {
    try {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/tools`);
      // 网关可达但无此端点（404 等）= 旧构建：全部按缺失拦截，不放行。
      if (!res.ok) return [...wanted];
      const data = (await res.json()) as { tools?: unknown };
      const names = Array.isArray(data.tools) ? data.tools.filter((name): name is string => typeof name === 'string') : [];
      cachedRegistryTools = { at: now, names };
    } catch {
      // 连不上网关才放行（网关侧 fail-fast 兜底）；可达必严查。
      return [];
    }
  }
  const have = new Set(cachedRegistryTools.names);
  return wanted.filter(name => !have.has(name));
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
        lane: 'learning',
        ephemeral: false,
        ...(threadId ? { threadId } : {}),
        ...(coachModelId ? { model: coachModelId } : {}),
        ...(coachEffort ? { effort: coachEffort } : {}),
        // 固定任务 id（网关按中央目录解析）；tools 字面量保留作旧网关兼容。
        task: 'vocabulary.explain',
        tools: ['vocabulary.learning.context', 'vocabulary.learning.submit', 'dictionary.lookup'],
        ...(prefs.agentRuntimeId ? { runtimeId: prefs.agentRuntimeId } : {}),
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

  /** 发送前预检：网关缺任务工具就地提示并拦截，不浪费模型轮次；探测失败放行（网关 fail-fast 兜底）。 */
  const ensureTaskTools = useCallback(async (wanted: readonly string[]): Promise<boolean> => {
    const missing = await missingRegistryTools(wanted);
    if (missing.length === 0) return true;
    const aiMsg: WordTutorMessage = { id: `wta-${++idRef.current}`, sender: 'ai',
      text: `网关缺少任务所需工具（${missing.join('、')}），请把网关更新到最新构建后重启，再重发一次。本次未发送。` };
    setMessages(previous => [...previous, aiMsg]);
    return false;
  }, []);

  return { messages, isTyping, connected: gateway.isConnected, send, stop, ensureTaskTools };
}
