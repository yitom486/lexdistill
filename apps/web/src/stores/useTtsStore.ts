import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createMigratedStorage } from './store-storage.js';
import type { TtsPurpose } from '@lexdistill/speech';
import {
  speechStudio,
  type SpeechStudioConfig,
  type SupportedLanguage,
  type TtsRequestDescriptor,
} from '../utils/audio.js';

export interface SpeakOptions {
  lang?: SupportedLanguage;
  rate?: number;
  purpose?: TtsPurpose;
  voiceId?: string;
  modelId?: string;
  speaker?: string | undefined;
  gender?: 'male' | 'female' | 'neutral' | undefined;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error?: unknown) => void;
}

export interface LastTtsAudioInfo {
  provider: string;
  voice: string;
  model?: string | undefined;
  mimeType: string;
}

export interface ReplayOptions {
  lang?: SupportedLanguage;
  rate?: number;
  purpose?: TtsPurpose;
  voiceId?: string;
  modelId?: string;
  speaker?: string | undefined;
  gender?: 'male' | 'female' | 'neutral' | undefined;
  onEnd?: () => void;
  onError?: (error?: unknown) => void;
}

export interface TtsStoreState extends SpeechStudioConfig {
  isSpeaking: boolean;
  isStreaming: boolean;
  streamedSeconds: number;
  streamedChunks: number;
  currentText: string;
  stopEpoch: number;
  hasLastAudio: boolean;
  lastAudioInfo: LastTtsAudioInfo | null;
  lastRequest: TtsRequestDescriptor | null;
  setRate: (rate: number) => void;
  setPreferredService: (service: SpeechStudioConfig['preferredService']) => void;
  setProviderApiKey: (provider: string, key: string) => void;
  setBackupApiKey: (provider: string, key: string) => void;
  setAzureRegion: (region: string) => void;
  setLocalBaseUrl: (url: string) => void;
  setVoiceId: (id: string) => void;
  setVoiceIdMale: (id: string) => void;
  setVoiceIdFemale: (id: string) => void;
  setModelId: (id: string) => void;
  setSaveAudioCache: (enabled: boolean) => void;
  speak: (text: string, options?: SpeakOptions) => Promise<void>;
  stop: () => void;
  /** 本地缓存命中时免费重播，无缓存返回 false（调用方转合成）。 */
  replayLast: (options?: Pick<ReplayOptions, 'onEnd' | 'onError'>) => Promise<boolean>;
  /** 当前组合是否可免费重播（与 speak 共用归一化规则）。 */
  canReplay: (text: string, options?: ReplayOptions) => boolean;
  downloadLastAudio: () => boolean;
}

function normalizeVoicePref(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === 'achernar') return 'Achernar';
  if (lower === 'aoede') return 'Aoede';
  if (lower === 'puck') return 'Puck';
  if (lower === 'fenrir') return 'Fenrir';
  if (lower === 'charon') return 'Charon';
  if (lower === 'kore') return 'Kore';
  if (lower === 'achird' || lower.includes('advisor-10')) return 'Puck';
  if (lower.startsWith('ar-001') || lower.includes('advisor-1')) return 'Aoede';
  return trimmed;
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
  const modelId = typeof preferences['modelId'] === 'string' ? (preferences['modelId'] as string) : '';
  const saveAudioCache = preferences['saveAudioCache'] !== false;
  const backupApiKeys: Record<string, string> = {};
  if (saved.backupApiKeys && typeof saved.backupApiKeys === 'object') {
    for (const [provider, key] of Object.entries(saved.backupApiKeys)) {
      if (typeof key === 'string') backupApiKeys[provider] = key;
    }
  }
  const voiceId = preferences['voiceId'] ? normalizeVoicePref(preferences['voiceId']) : undefined;
  const voiceIdMale = preferences['voiceIdMale'] ? normalizeVoicePref(preferences['voiceIdMale']) : undefined;
  const voiceIdFemale = preferences['voiceIdFemale'] ? normalizeVoicePref(preferences['voiceIdFemale']) : undefined;
  return {
    ...preferences,
    ...(voiceId ? { voiceId } : {}),
    ...(voiceIdMale ? { voiceIdMale } : {}),
    ...(voiceIdFemale ? { voiceIdFemale } : {}),
    providerApiKeys,
    backupApiKeys,
    modelId,
    saveAudioCache,
  };
}

export const useTtsStore = create<TtsStoreState>()(
  persist(
    (set, get) => {
      const syncPlayback = (): void => {
        const last = speechStudio.getLastAudio();
        set({
          isSpeaking: speechStudio.getIsSpeaking(),
          isStreaming: speechStudio.getIsStreaming(),
          streamedSeconds: speechStudio.getStreamedSeconds(),
          streamedChunks: speechStudio.getStreamedChunks(),
          currentText: speechStudio.getCurrentText(),
          stopEpoch: speechStudio.getStopEpoch(),
          hasLastAudio: last !== null,
          lastAudioInfo: last
            ? {
                provider: last.provider,
                voice: last.voice,
                ...(last.model ? { model: last.model } : {}),
                mimeType: last.mimeType,
              }
            : null,
          lastRequest: speechStudio.getLastRequest(),
        });
      };
      speechStudio.subscribe(syncPlayback);
      const update = (next: Partial<SpeechStudioConfig>) => {
        speechStudio.configure(next);
        set(next);
      };
      return {
        ...speechStudio.getConfig(),
        isSpeaking: speechStudio.getIsSpeaking(),
        isStreaming: speechStudio.getIsStreaming(),
        streamedSeconds: speechStudio.getStreamedSeconds(),
        streamedChunks: speechStudio.getStreamedChunks(),
        currentText: speechStudio.getCurrentText(),
        stopEpoch: speechStudio.getStopEpoch(),
        hasLastAudio: speechStudio.getLastAudio() !== null,
        lastAudioInfo: null,
        lastRequest: null,
        setRate: (rate) => update({ rate: Math.max(0.5, Math.min(1.5, rate)) }),
        setPreferredService: (preferredService) => update({ preferredService }),
        setProviderApiKey: (provider, key) => update({
          providerApiKeys: { ...get().providerApiKeys, [provider]: key.trim() },
        }),
        setBackupApiKey: (provider, key) => update({
          backupApiKeys: { ...get().backupApiKeys, [provider]: key.trim() },
        }),
        setAzureRegion: (azureRegion) => update({ azureRegion: azureRegion.trim() }),
        setLocalBaseUrl: (localBaseUrl) => update({ localBaseUrl: localBaseUrl.trim() }),
        voiceId: speechStudio.getConfig().voiceId || 'Aoede',
        voiceIdMale: speechStudio.getConfig().voiceIdMale || 'Puck',
        voiceIdFemale: speechStudio.getConfig().voiceIdFemale || 'Aoede',
        setVoiceId: (voiceId) => update({ voiceId: voiceId.trim() }),
        setVoiceIdMale: (voiceIdMale) => update({ voiceIdMale: voiceIdMale.trim() }),
        setVoiceIdFemale: (voiceIdFemale) => update({ voiceIdFemale: voiceIdFemale.trim() }),
        setModelId: (modelId) => update({ modelId: modelId.trim() }),
        setSaveAudioCache: (saveAudioCache) => update({ saveAudioCache }),
        speak: (text, options) => speechStudio.speak(text, {
          ...options,
          // 不强制默认语种：缺省即自动识别（网关行为），调用方传轨道语种仅作提示。
          rate: options?.rate ?? get().rate,
        }),
        stop: () => speechStudio.stop(),
        replayLast: (options) => speechStudio.replayLast(options),
        canReplay: (text, options) => speechStudio.canReplay(text, {
          ...options,
          rate: options?.rate ?? get().rate,
        }),
        downloadLastAudio: () => speechStudio.downloadLastAudio(),
      };
    },
    {
      name: 'lexdistill_tts_config',
      storage: createMigratedStorage(['study_studio_tts_config']),
      version: 2,
      migrate: migrateTtsPreferences,
      partialize: (state) => ({
        rate: state.rate,
        preferredService: state.preferredService,
        providerApiKeys: state.providerApiKeys,
        backupApiKeys: state.backupApiKeys,
        azureRegion: state.azureRegion,
        localBaseUrl: state.localBaseUrl,
        voiceId: state.voiceId,
        voiceIdMale: state.voiceIdMale,
        voiceIdFemale: state.voiceIdFemale,
        modelId: state.modelId,
        saveAudioCache: state.saveAudioCache,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) speechStudio.configure({
          rate: state.rate,
          preferredService: state.preferredService,
          providerApiKeys: state.providerApiKeys,
          backupApiKeys: state.backupApiKeys ?? {},
          azureRegion: state.azureRegion,
          localBaseUrl: state.localBaseUrl,
          voiceId: state.voiceId || 'Aoede',
          voiceIdMale: state.voiceIdMale || 'Puck',
          voiceIdFemale: state.voiceIdFemale || 'Aoede',
          modelId: state.modelId,
          saveAudioCache: state.saveAudioCache ?? true,
        });
      },
    },
  ),
);
