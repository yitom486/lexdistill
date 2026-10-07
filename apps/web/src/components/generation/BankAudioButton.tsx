import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button.js';
import { GATEWAY_BASE_URL } from '../../lib/api-client.js';
import { QUERY_KEYS } from '../../queries/query-keys.js';
import { useUserProfileStore } from '../../stores/useUserProfileStore.js';
import { useGenerationAudioMutation } from '../../queries/generation.js';

/**
 * 听力播放键：取网关音频字节→按 MIME 拼 Blob（PCM 包 WAV 头）→ 原生 Audio 播放；
 * 播完按既有口径记录听力时长。台词是否可见由父级按复盘资格与盲听遮罩决定。
 */
export function BankAudioButton({ userId, taskId, materialId, language, turns }: {
  userId: string; taskId: string; materialId: string; language: string;
  turns: Array<{ speaker: string; text: string }> | null;
}) {
  const audio = useGenerationAudioMutation();
  const queryClient = useQueryClient();
  const objectUrl = useRef<string | null>(null);
  const element = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record = useMutation({
    mutationFn: async (durationMs: number) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/task/activity/${encodeURIComponent(userId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listeningMinutes: durationMs / 60000, language: language.toLowerCase() }),
      });
      if (!res.ok) throw new Error('听力时长保存失败');
    },
    onSuccess: () => {
      void useUserProfileStore.getState().fetchProfile(userId);
      for (const key of [QUERY_KEYS.DAILY_TASK, QUERY_KEYS.DAILY_PLAN, QUERY_KEYS.ACTIVITY_HISTORY]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  useEffect(() => () => {
    element.current?.pause();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const play = async () => {
    setError(null);
    try {
      element.current?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const asset = await audio.mutateAsync({ userId, taskId, materialId });
      const url = (objectUrl.current = asset.url);
      const startedAt = performance.now();
      const el = new Audio(url);
      element.current = el;
      el.onended = () => {
        setPlaying(false);
        record.mutate(Math.max(0, performance.now() - startedAt));
      };
      el.onerror = () => {
        setPlaying(false);
        setError('音频播放失败，请重试。');
      };
      setPlaying(true);
      await el.play();
    } catch (cause) {
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : '音频加载失败');
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={() => void play()} disabled={audio.isPending || playing} aria-label="播放听力">
        {audio.isPending ? '加载中…' : playing ? '播放中…' : '播放听力'}
      </Button>
      {error && <p role="alert" className="text-xs text-ink-rose-600">{error}</p>}
      {turns && (
        <ol className="space-y-1 rounded-lg border border-line bg-surface p-3 text-sm leading-6 text-ink">
          {turns.map((turn, index) => (
            <li key={index}><span className="text-xs font-semibold text-ink-muted">{turn.speaker}</span> {turn.text}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
