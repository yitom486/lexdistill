import { azureProvider, geminiProvider, localProvider } from 'gemini-tts-studio/server';
import type { GenerationConfig } from '@lexdistill/protocol';
import { createGenerationTtsRenderer } from './tts-renderer.js';
import type { GenerationAudioRenderer } from '../ports.js';

export interface GenerationAudioEnv {
  GEMINI_API_KEY?: string | undefined;
  GOOGLE_API_KEY?: string | undefined;
  AZURE_TTS_KEY?: string | undefined;
  LEXDISTILL_ENABLE_LOCAL_TTS?: string | undefined;
  STUDY_STUDIO_ENABLE_LOCAL_TTS?: string | undefined;
}

/**
 * P5 生产语音解析：只读宿主环境密钥，不接受模型输入，不记录密钥。
 * 未配置返回 undefined，工具侧如实报 E_AUDIO_UNAVAILABLE，不静默降级。
 * local 需显式 LEXDISTILL_ENABLE_LOCAL_TTS=1 才启用，避免误触本机合成。
 */
export function resolveGenerationAudio(
  config: GenerationConfig,
  env: GenerationAudioEnv = process.env as GenerationAudioEnv,
): GenerationAudioRenderer | undefined {
  const audio = config.audio;
  if (!audio) return undefined;
  const providerId = audio.providerId.trim();
  if (providerId === 'gemini') {
    const key = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? '').trim();
    if (!key) return undefined;
    return createGenerationTtsRenderer(geminiProvider, key, { supportsDialogue: true });
  }
  if (providerId === 'azure') {
    const key = (env.AZURE_TTS_KEY ?? '').trim();
    if (!key) return undefined;
    return createGenerationTtsRenderer(azureProvider, key, { supportsDialogue: false });
  }
  if (providerId === 'local') {
    const localEnabled = (env.LEXDISTILL_ENABLE_LOCAL_TTS ?? env.STUDY_STUDIO_ENABLE_LOCAL_TTS ?? '').trim();
    if (localEnabled !== '1') return undefined;
    return createGenerationTtsRenderer(localProvider, '', { supportsDialogue: false });
  }
  return undefined;
}
