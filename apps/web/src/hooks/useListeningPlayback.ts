import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTts } from './useTts.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { QUERY_KEYS } from '../queries/query-keys.js';
import type { SupportedLanguage } from '../utils/audio.js';

export function useListeningPlayback(text: string, language: SupportedLanguage) {
  const tts = useTts();
  const [playing, setPlaying] = useState(false);
  const generation = useRef(0);
  const owned = useRef(false);
  const client = useQueryClient();
  const userId = useUserProfileStore(s => s.profile.userId);
  const record = useMutation({
    mutationFn: async (durationMs: number) => {
      const response = await fetch(`${GATEWAY_BASE_URL}/api/task/activity/${encodeURIComponent(userId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listeningMinutes: durationMs / 60000, language: language.toLowerCase() }),
      });
      if (!response.ok) throw new Error('听力时长保存失败');
    },
    onSuccess: () => {
      void useUserProfileStore.getState().fetchProfile(userId);
      for (const key of [QUERY_KEYS.DAILY_TASK, QUERY_KEYS.DAILY_PLAN, QUERY_KEYS.ACTIVITY_HISTORY]) {
        void client.invalidateQueries({ queryKey: key });
      }
    },
    onError: error => toast.error(error.message),
  });
  const stop = () => {
    generation.current++;
    if (owned.current && useTtsStore.getState().currentText === text) tts.stop();
    owned.current = false;
    setPlaying(false);
  };
  useEffect(() => {
    setPlaying(false);
    return () => {
      generation.current++;
      if (owned.current && useTtsStore.getState().currentText === text) tts.stop();
      owned.current = false;
    };
  }, [text, language, tts.stop]);
  const play = async () => {
    if (!text.trim()) return;
    const token = ++generation.current;
    let startedAt: number | undefined;
    owned.current = true;
    setPlaying(true);
    try {
      await tts.speak(text, {
        lang: language, purpose: 'dictation',
        onStart: () => { if (generation.current === token) startedAt = performance.now(); },
        onEnd: () => {
          if (generation.current !== token) return;
          owned.current = false;
          setPlaying(false);
          if (startedAt !== undefined) record.mutate(Math.max(0, performance.now() - startedAt));
        },
        onError: () => {
          if (generation.current !== token) return;
          owned.current = false;
          setPlaying(false);
          toast.error('音频播放失败，请检查语音设置后重试。');
        },
      });
    } catch {
      if (generation.current === token) { owned.current = false; setPlaying(false); }
    }
  };
  return { playing, play, stop, rate: tts.rate, setRate: tts.setRate };
}
