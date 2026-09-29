import { useTtsStore, type SpeakOptions } from '../stores/useTtsStore.js';

export interface UseTtsReturn {
  isSpeaking: boolean;
  currentText: string;
  rate: number;
  speak: (text: string, options?: SpeakOptions) => Promise<void>;
  stop: () => void;
  setRate: (rate: number) => void;
}

/**
 * 统一的 TTS Hook (直接代理底层 Zustand useTtsStore)
 */
export function useTts(): UseTtsReturn {
  const isSpeaking = useTtsStore((s) => s.isSpeaking);
  const currentText = useTtsStore((s) => s.currentText);
  const rate = useTtsStore((s) => s.rate);
  const speak = useTtsStore((s) => s.speak);
  const stop = useTtsStore((s) => s.stop);
  const setRate = useTtsStore((s) => s.setRate);

  return {
    isSpeaking,
    currentText,
    rate,
    speak,
    stop,
    setRate,
  };
}
