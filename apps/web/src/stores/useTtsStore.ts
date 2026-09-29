import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TtsPurpose } from '@study-studio/speech';
import {
  speechStudio,
  type SpeechStudioConfig,
  type TtsGender,
  type SupportedLanguage,
} from '../utils/audio.js';

export interface SpeakOptions {
  lang?: SupportedLanguage;
  gender?: TtsGender;
  rate?: number;
  purpose?: TtsPurpose;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error?: unknown) => void;
}

export interface TtsStoreState extends SpeechStudioConfig {
  isSpeaking: boolean;
  currentText: string;
  setGender: (gender: TtsGender) => void;
  setRate: (rate: number) => void;
  setPreferredService: (service: SpeechStudioConfig['preferredService']) => void;
  setGeminiApiKey: (key: string) => void;
  setAzureKey: (key: string) => void;
  setAzureRegion: (region: string) => void;
  setLocalBaseUrl: (url: string) => void;
  setLocalApiKey: (key: string) => void;
  setVoiceId: (id: string) => void;
  speak: (text: string, options?: SpeakOptions) => Promise<void>;
  stop: () => void;
}

export const useTtsStore = create<TtsStoreState>()(
  persist(
    (set, get) => {
      speechStudio.subscribe(() => {
        set({
          isSpeaking: speechStudio.getIsSpeaking(),
          currentText: speechStudio.getCurrentText(),
        });
      });
      const update = (next: Partial<SpeechStudioConfig>) => {
        speechStudio.configure(next);
        set(next);
      };
      return {
        ...speechStudio.getConfig(),
        isSpeaking: speechStudio.getIsSpeaking(),
        currentText: speechStudio.getCurrentText(),
        setGender: (gender) => update({ gender }),
        setRate: (rate) => update({ rate: Math.max(0.5, Math.min(1.5, rate)) }),
        setPreferredService: (preferredService) => update({ preferredService }),
        setGeminiApiKey: (geminiApiKey) => update({ geminiApiKey: geminiApiKey.trim() }),
        setAzureKey: (azureKey) => update({ azureKey: azureKey.trim() }),
        setAzureRegion: (azureRegion) => update({ azureRegion: azureRegion.trim() }),
        setLocalBaseUrl: (localBaseUrl) => update({ localBaseUrl: localBaseUrl.trim() }),
        setLocalApiKey: (localApiKey) => update({ localApiKey: localApiKey.trim() }),
        setVoiceId: (voiceId) => update({ voiceId: voiceId.trim() }),
        speak: (text, options) => speechStudio.speak(text, {
          ...options,
          lang: options?.lang ?? 'EN',
          gender: options?.gender ?? get().gender,
          rate: options?.rate ?? get().rate,
        }),
        stop: () => speechStudio.stop(),
      };
    },
    {
      name: 'study_studio_tts_config',
      partialize: (state) => ({
        gender: state.gender,
        rate: state.rate,
        preferredService: state.preferredService,
        geminiApiKey: state.geminiApiKey,
        azureKey: state.azureKey,
        azureRegion: state.azureRegion,
        localBaseUrl: state.localBaseUrl,
        localApiKey: state.localApiKey,
        voiceId: state.voiceId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) speechStudio.configure({
          gender: state.gender,
          rate: state.rate,
          preferredService: state.preferredService,
          geminiApiKey: state.geminiApiKey,
          azureKey: state.azureKey,
          azureRegion: state.azureRegion,
          localBaseUrl: state.localBaseUrl,
          localApiKey: state.localApiKey,
          voiceId: state.voiceId,
        });
      },
    },
  ),
);
