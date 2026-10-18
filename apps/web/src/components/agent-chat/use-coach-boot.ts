import { useEffect, useRef } from 'react';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import {
  mapThreadItemsToBubbles,
  stripTranscriptNoise,
} from '../../lib/chat-transcript.js';
import { buildTutorFreeGreeting } from '../../copy/tutor-track-copy.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';
import type { ChatMessage } from './chat-shared.js';

import type { AgentSessionItemDto } from '../../queries/useAgentQueries.js';

interface CoachBootOptions {
  track: TrackLanguage;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  coachThreadId: string;
  threadItems: AgentSessionItemDto[];
  threadItemsFetched: boolean;
  supportsThreadsOrHistory: boolean;
}

/**
 * 自由导师消息启动：偏好水合后问候/恢复提示 + 历史 thread 映射为气泡。
 * 与发送/队列/审批生命周期无关，只负责初始与恢复展示。
 */
export function useCoachBootMessages({
  track,
  setMessages,
  coachThreadId,
  threadItems,
  threadItemsFetched,
  supportsThreadsOrHistory,
}: CoachBootOptions) {
  const bootedRef = useRef(false);
  /** 当前问候语所用的语种轨道；null 表示显示的不是开场问候（如会话恢复中）。 */
  const greetingTrackRef = useRef<TrackLanguage | null>(null);

  // 偏好水合后再决定问候语 / 恢复提示，避免先闪 greeting 再被 thread items 覆盖
  useEffect(() => {
    if (bootedRef.current) return;
    const boot = () => {
      if (bootedRef.current) return;
      bootedRef.current = true;
      const threadId = usePreferencesStore.getState().coachThreadId;
      if (threadId && supportsThreadsOrHistory) {
        greetingTrackRef.current = null;
        setMessages([
          {
            id: 'resume',
            role: 'system',
            text: '正在恢复上次会话…',
          },
        ]);
      } else {
        greetingTrackRef.current = track;
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
  }, [track, setMessages, supportsThreadsOrHistory]);

  // 切换目标语种：只重写「还停在开场问候」的那条，已发生的对话不受影响。
  // 缺这一步时，先开英语再切日语，顶栏已是日语导师而问候仍是英语文案。
  useEffect(() => {
    const shownTrack = greetingTrackRef.current;
    if (shownTrack === null || shownTrack === track) return;
    greetingTrackRef.current = track;
    setMessages((prev) => {
      const only = prev.length === 1 ? prev[0] : undefined;
      if (!only || only.role !== 'assistant' || only.streaming) return prev;
      if (!only.id.startsWith('open')) return prev;
      return [
        {
          id: `open_${Date.now()}`,
          role: 'assistant',
          text: buildTutorFreeGreeting(track),
        },
      ];
    });
  }, [track, setMessages]);

  // 选中 / 恢复历史会话：把 items 映射成聊天气泡
  useEffect(() => {
    if (!coachThreadId) return;
    if (threadItems.length) {
      const mapped: ChatMessage[] = mapThreadItemsToBubbles(threadItems).map((b) => ({
        ...b,
        text: b.role === 'user' ? stripTranscriptNoise(b.text) : b.text,
      }));
      if (mapped.length) setMessages((prev) => prev.some((message) => message.streaming) ? prev : mapped);
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
  }, [coachThreadId, threadItems, threadItemsFetched, track, setMessages]);
}
