import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TtsPurpose } from '@study-studio/speech';
import {
  speechStudio,
  type TtsGender,
  type SupportedLanguage,
} from '../utils/audio.js';

export interface SpeakOptions {
  lang?: SupportedLanguage | undefined;
  gender?: TtsGender | undefined;
  rate?: number | undefined;
  /** 朗读用途（听写更慢等），透传 tts-core 规约器；缺省 general。 */
  purpose?: TtsPurpose | undefined;
  onStart?: (() => void) | undefined;
  onEnd?: (() => void) | undefined;
  onError?: ((err?: unknown) => void) | undefined;
}

export type VoicePrefKey = `${SupportedLanguage}_${TtsGender}`;

export function voicePrefKey(lang: SupportedLanguage, gender: TtsGender): VoicePrefKey {
  return `${lang}_${gender}`;
}

export type TtsProxyProvider = 'openai-compatible' | 'azure-speech';

export interface TtsStoreState {
  // 持久化字段
  gender: TtsGender;
  rate: number;
  customPluginUrl: string;
  isCustomPluginEnabled: boolean;
  /** 外挂端点 API Key（仅存本机 localStorage）。 */
  customPluginApiKey: string;
  /** 外挂端点音色 id（空则按性别回填）。 */
  customPluginVoiceId: string;
  /** 网关代理的 TTS 服务商（启用小外挂时生效）。 */
  proxyProvider: TtsProxyProvider;
  /** Azure Speech 区域（如 japaneast）。 */
  proxyRegion: string;
  /** Azure 说话风格（如 cheerful；须为所选音色支持的风格）。 */
  azureStyle: string;
  /** Azure 女声音色 id（空=按女声默认）。 */
  azureFemaleVoiceId: string;
  /** Azure 男声音色 id（空=按男声默认）。 */
  azureMaleVoiceId: string;
  /** 按语种+性别记住用户手动选择的系统音色 URI */
  preferredVoices: Partial<Record<VoicePrefKey, string>>;

  // 内存运行时字段
  isSpeaking: boolean;
  currentText: string;

  // 动作
  setGender: (gender: TtsGender) => void;
  setRate: (rate: number) => void;
  setCustomPluginConfig: (url: string, enabled: boolean) => void;
  setCustomPluginAuth: (apiKey: string, voiceId: string) => void;
  setProxyProvider: (provider: TtsProxyProvider) => void;
  setProxyRegion: (region: string) => void;
  setAzureStyle: (style: string) => void;
  setAzureGenderVoice: (gender: TtsGender, voiceId: string) => void;
  setPreferredVoice: (lang: SupportedLanguage, gender: TtsGender, voiceURI: string | null) => void;
  speak: (text: string, options?: SpeakOptions) => Promise<void>;
  stop: () => void;
}

export const useTtsStore = create<TtsStoreState>()(
  persist(
    (set, get) => {
      // 监听底层 SpeechStudioEngine 的状态变更，双向保持同步
      speechStudio.subscribe(() => {
        const isSpeaking = speechStudio.getIsSpeaking();
        const currentText = speechStudio.getCurrentText();
        const engineGender = speechStudio.getGender();
        const engineRate = speechStudio.getRate();

        set((state) => {
          if (
            state.isSpeaking === isSpeaking &&
            state.currentText === currentText &&
            state.gender === engineGender &&
            state.rate === engineRate
          ) {
            return state;
          }
          return {
            isSpeaking,
            currentText,
            gender: engineGender,
            rate: engineRate,
          };
        });
      });

      return {
        gender: speechStudio.getGender(),
        rate: speechStudio.getRate(),
        customPluginUrl: speechStudio.getCustomPluginConfig().url,
        isCustomPluginEnabled: speechStudio.getCustomPluginConfig().enabled,
        customPluginApiKey: speechStudio.getCustomPluginAuth().apiKey,
        customPluginVoiceId: speechStudio.getCustomPluginAuth().voiceId,
        proxyProvider: speechStudio.getProxyConfig().provider,
        proxyRegion: speechStudio.getProxyConfig().region,
        azureStyle: speechStudio.getProxyConfig().style,
        azureFemaleVoiceId: speechStudio.getProxyConfig().femaleVoiceId,
        azureMaleVoiceId: speechStudio.getProxyConfig().maleVoiceId,
        preferredVoices: {},
        isSpeaking: speechStudio.getIsSpeaking(),
        currentText: speechStudio.getCurrentText(),

        setGender: (gender: TtsGender) => {
          speechStudio.setGender(gender);
          set({ gender });
        },

        setRate: (rate: number) => {
          speechStudio.setRate(rate);
          set({ rate });
        },

        setCustomPluginConfig: (url: string, enabled: boolean) => {
          speechStudio.setCustomPluginConfig(url, enabled);
          set({ customPluginUrl: url, isCustomPluginEnabled: enabled });
        },

        setCustomPluginAuth: (apiKey: string, voiceId: string) => {
          speechStudio.setCustomPluginAuth(apiKey, voiceId);
          set({ customPluginApiKey: apiKey, customPluginVoiceId: voiceId });
        },

        setProxyProvider: (provider: TtsProxyProvider) => {
          speechStudio.setProxyConfig(provider, get().proxyRegion, get().azureStyle);
          set({ proxyProvider: provider });
        },

        setProxyRegion: (region: string) => {
          speechStudio.setProxyConfig(get().proxyProvider, region, get().azureStyle);
          set({ proxyRegion: region });
        },

        setAzureStyle: (style: string) => {
          speechStudio.setProxyConfig(get().proxyProvider, get().proxyRegion, style);
          set({ azureStyle: style });
        },

        setAzureGenderVoice: (gender: TtsGender, voiceId: string) => {
          const config = speechStudio.getProxyConfig();
          speechStudio.setProxyConfig(config.provider, config.region, config.style, {
            ...(gender === 'MALE' ? { maleVoiceId: voiceId } : { femaleVoiceId: voiceId }),
          });
          set(
            gender === 'MALE' ? { azureMaleVoiceId: voiceId } : { azureFemaleVoiceId: voiceId }
          );
        },

        setPreferredVoice: (lang, gender, voiceURI) => {
          const key = voicePrefKey(lang, gender);
          set((state) => {
            const next = { ...state.preferredVoices };
            if (!voiceURI) {
              delete next[key];
            } else {
              next[key] = voiceURI;
            }
            return { preferredVoices: next };
          });
        },

        speak: async (text: string, options?: SpeakOptions) => {
          const current = get();
          const lang = options?.lang || 'EN';
          const gender = options?.gender || current.gender;
          const preferredVoiceURI =
            current.preferredVoices[voicePrefKey(lang, gender)] ?? null;
          await speechStudio.speak(text, {
            lang,
            gender,
            rate: options?.rate || current.rate,
            preferredVoiceURI,
            ...(options?.purpose ? { purpose: options.purpose } : {}),
            onStart: options?.onStart,
            onEnd: options?.onEnd,
            onError: options?.onError,
          });
        },

        stop: () => {
          speechStudio.stop();
          set({ isSpeaking: false, currentText: '' });
        },
      };
    },
    {
      name: 'study_studio_tts_config',
      partialize: (state) => ({
        gender: state.gender,
        rate: state.rate,
        customPluginUrl: state.customPluginUrl,
        isCustomPluginEnabled: state.isCustomPluginEnabled,
        customPluginApiKey: state.customPluginApiKey,
        customPluginVoiceId: state.customPluginVoiceId,
        proxyProvider: state.proxyProvider,
        proxyRegion: state.proxyRegion,
        azureStyle: state.azureStyle,
        azureFemaleVoiceId: state.azureFemaleVoiceId,
        azureMaleVoiceId: state.azureMaleVoiceId,
        preferredVoices: state.preferredVoices,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          speechStudio.setGender(state.gender);
          speechStudio.setRate(state.rate);
          speechStudio.setCustomPluginConfig(state.customPluginUrl, state.isCustomPluginEnabled);
          speechStudio.setCustomPluginAuth(state.customPluginApiKey, state.customPluginVoiceId);
          speechStudio.setProxyConfig(state.proxyProvider, state.proxyRegion, state.azureStyle, {
            ...(state.azureFemaleVoiceId ? { femaleVoiceId: state.azureFemaleVoiceId } : {}),
            ...(state.azureMaleVoiceId ? { maleVoiceId: state.azureMaleVoiceId } : {}),
          });
        }
      },
    }
  )
);
