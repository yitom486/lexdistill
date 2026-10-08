import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { trackToSpeechLang } from '../config/speech-language.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import { speechStudio } from '../utils/audio.js';

/** 只管理此学习内容发起的朗读；离开时不打断其他入口接管的播放。 */
export function useStudySpeech(text: string, language: 'ja' | 'en' | 'ko', scopeKey: string, speaker?: string) {
  const speaking = useTtsStore(state => state.isSpeaking);
  const currentText = useTtsStore(state => state.currentText);
  const stopEpoch = useTtsStore(state => state.stopEpoch);
  const ownedEpoch = useRef<number | null>(null);
  const playing = speaking && currentText === text && ownedEpoch.current === stopEpoch;

  useEffect(() => () => {
    if (ownedEpoch.current === speechStudio.getStopEpoch() && speechStudio.getIsSpeaking()) {
      useTtsStore.getState().stop();
    }
    ownedEpoch.current = null;
  }, [scopeKey, text, language, speaker]);

  const toggle = () => {
    if (!text.trim()) return;
    if (ownedEpoch.current === speechStudio.getStopEpoch() && speechStudio.getIsSpeaking()) {
      useTtsStore.getState().stop();
      return;
    }
    const request = useTtsStore.getState().speak(text, {
      lang: trackToSpeechLang(language), purpose: 'preview', ...(speaker ? { speaker } : {}),
    });
    ownedEpoch.current = speechStudio.getStopEpoch();
    // 常规合成与播放错误由已有语音引擎展示，这里只处理意外的 Promise 拒绝。
    void request.catch(() => toast.error('朗读失败，请检查语音设置后重试。'));
  };

  return { playing, toggle };
}
