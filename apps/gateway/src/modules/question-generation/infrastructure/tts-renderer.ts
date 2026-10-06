import type { TTSProvider } from 'gemini-tts-studio/server';
import { BusinessError } from '@study-studio/shared';
import type { GenerationAudioRenderer } from '../ports.js';

/** Provider and credentials are selected by the host, never supplied by a model tool call. */
export function createGenerationTtsRenderer(provider: TTSProvider, apiKey: string, capabilities: { supportsDialogue: boolean } = { supportsDialogue: provider.id === 'gemini' }): GenerationAudioRenderer {
  return {
    async render({ material, language, settings, signal }) {
      if (provider.id !== settings.providerId) throw new BusinessError('E_AUDIO_PROVIDER', '语音服务与任务配置不一致', 'VALIDATION');
      signal.throwIfAborted();
      const dialogue = material.mode === 'DIALOGUE';
      if (dialogue && !capabilities.supportsDialogue) throw new BusinessError('E_AUDIO_DIALOGUE_UNSUPPORTED', '所选语音服务不支持一次合成男女双人对话，请选择支持的服务', 'VALIDATION');
      let response: Awaited<ReturnType<TTSProvider['synthesize']>>;
      try { response = await provider.synthesize({ provider: provider.id, model: settings.modelId, speed: settings.speed,
        languageCode: { ja: 'ja-JP', en: 'en-US', ko: 'ko-KR' }[language],
        text: material.turns.map(t => dialogue ? `${t.speaker}: ${t.text.replace(/\s+/g, ' ')}` : t.text).join('\n'),
        ...(dialogue ? { speakers: [{ speaker: 'MALE', voiceName: settings.maleVoice }, { speaker: 'FEMALE', voiceName: settings.femaleVoice }] }
          : { voiceName: settings.narratorVoice }),
      }, apiKey, { signal }); }
      catch {
        signal.throwIfAborted();
        // Upstream error text can contain credentials or request headers.
        throw new BusinessError('E_AUDIO_SYNTHESIS', '语音服务生成失败，请检查服务配置、网络和可用额度', 'NETWORK', true);
      }
      signal.throwIfAborted();
      return { bytes: response.audioBuffer, mimeType: response.mimeType };
    },
  };
}
