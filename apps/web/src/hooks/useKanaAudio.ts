import { useCallback } from 'react';
import { kanaAudioUrl, playKanaText, resolveKanaIds } from '../lib/kana-audio.js';

/**
 * 假名内置发音 hook：全站假名按钮统一入口。
 * playText(text)：纯假名字串播内置（单字/整行），解不出或缺音频返回 false，
 * 调用方自行回退实时 TTS。
 */
export function useKanaAudio() {
  const playText = useCallback(
    (
      text: string,
      options?: { onEnd?: () => void; onError?: (error?: unknown) => void; sequence?: boolean },
    ) => playKanaText(text, options),
    [],
  );
  const hasAudio = useCallback(
    (text: string) => {
      const chars = [...text.trim()];
      return chars.length > 0 && chars.every((ch) => hasKanaAudioByChar(ch));
    },
    [],
  );
  return { playText, hasAudio };
}

function hasKanaAudioByChar(ch: string): boolean {
  const ids = resolveKanaIds(ch);
  return !!ids && ids.length === 1 && kanaAudioUrl(ids[0]!) !== null;
}
