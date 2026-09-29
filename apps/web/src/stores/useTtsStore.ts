import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TtsPurpose } from '@study-studio/speech';
import {
  speechStudio,
  type SpeechStudioConfig,
  type SupportedLanguage,
} from '../utils/audio.js';

export interface SpeakOptions {
  lang?: SupportedLanguage;
  rate?: number;
  purpose?: TtsPurpose;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error?: unknown) => void;
}

export interface TtsStoreState extends SpeechStudioConfig {
  isSpeaking: boolean;
  currentText: string;
  setRate: (rate: number) => void;
  setPreferredService: (service: SpeechStudioConfig['preferredService']) => void;
  setProviderApiKey: (provider: string, key: string) => void;
  setAzureRegion: (region: string) => void;
  setLocalBaseUrl: (url: string) => void;
  setVoiceId: (id: string) => void;
  speak: (text: string, options?: SpeakOptions) => Promise<void>;
  stop: () => void;
}

/** 旧版单独存储厂商 Key；升级时只在本机迁入按服务 ID 索引的偏好。 */
export function migrateTtsPreferences(persisted: unknown): Record<string, unknown> {
  if (!persisted || typeof persisted !== 'object') return { providerApiKeys: {} };
  const saved = persisted as Record<string, unknown>;
  const providerApiKeys: Record<string, string> = {};
  if (saved.providerApiKeys && typeof saved.providerApiKeys === 'object') {
    for (const [provider, key] of Object.entries(saved.providerApiKeys)) {
      if (typeof key === 'string') providerApiKeys[provider] = key;
    }
  }
  const migrations: Array<[string, string]> = [
    ['geminiApiKey', 'gemini'],
    ['azureKey', 'azure'],
    ['localApiKey', 'local'],
  ];
  for (const [field, provider] of migrations) {
    const key = saved[field];
    if (typeof key === 'string' && key && !providerApiKeys[provider]) providerApiKeys[provider] = key;
  }
  const { gender: _legacyGender, ...preferences } = saved;
  return { ...preferences, providerApiKeys };
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
        setRate: (rate) => update({ rate: Math.max(0.5, Math.min(1.5, rate)) }),
        setPreferredService: (preferredService) => update({ preferredService }),
        setProviderApiKey: (provider, key) => update({
          providerApiKeys: { ...get().providerApiKeys, [provider]: key.trim() },
        }),
        setAzureRegion: (azureRegion) => update({ azureRegion: azureRegion.trim() }),
        setLocalBaseUrl: (localBaseUrl) => update({ localBaseUrl: localBaseUrl.trim() }),
        setVoiceId: (voiceId) => update({ voiceId: voiceId.trim() }),
        speak: (text, options) => speechStudio.speak(text, {
          ...options,
          lang: options?.lang ?? 'EN',
          rate: options?.rate ?? get().rate,
        }),
        stop: () => speechStudio.stop(),
      };
    },
    {
      name: 'study_studio_tts_config',
      version: 2,
      migrate: migrateTtsPreferences,
      partialize: (state) => ({
        rate: state.rate,
        preferredService: state.preferredService,
        providerApiKeys: state.providerApiKeys,
        azureRegion: state.azureRegion,
        localBaseUrl: state.localBaseUrl,
        voiceId: state.voiceId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) speechStudio.configure({
          rate: state.rate,
          preferredService: state.preferredService,
          providerApiKeys: state.providerApiKeys,
          azureRegion: state.azureRegion,
          localBaseUrl: state.localBaseUrl,
          voiceId: state.voiceId,
        });
      },
    },
  ),
);
