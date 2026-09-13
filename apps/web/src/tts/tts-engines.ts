/**
 * Web Speech 真机引擎：`TtsEngine` 接口在 Web 端的默认实现。
 * 直接委托 `speechStudio` 单例（系统真机音色 + 小外挂降级链），本文件只做
 * 规约请求 ↔ 播放选项的翻译与引擎注册；未来神经引擎实现同一接口即可替换。
 */
import {
  getActiveTtsEngine,
  registerTtsEngine,
  setActiveTtsEngine,
  type TtsEngine,
  type TtsSpeakHandle,
  type TtsSpeakRequest,
} from '@study-studio/speech';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { speechStudio, type SupportedLanguage } from '../utils/audio.js';

function supportedFromBcp47(bcp47: string): SupportedLanguage {
  const lower = bcp47.toLowerCase();
  if (lower.startsWith('ja')) return 'JA';
  if (lower.startsWith('ko')) return 'KO';
  return 'EN';
}

export const webSpeechEngine: TtsEngine = {
  id: 'webspeech',
  label: '系统语音（Web Speech 真机）',

  async speak(request: TtsSpeakRequest): Promise<Result<TtsSpeakHandle, BusinessError>> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return err(
        new BusinessError('E_TTS_UNAVAILABLE', '当前环境不支持语音合成。', 'TOOL_EXECUTION', false)
      );
    }
    let notifyEnd: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      notifyEnd = resolve;
    });
    await speechStudio.speak(request.utteranceText, {
      lang: supportedFromBcp47(request.bcp47),
      gender: request.context.gender,
      rate: request.rate,
      preferredVoiceURI: request.preferredVoiceURI ?? null,
      ...(request.personaName ? { personaName: request.personaName } : {}),
      onEnd: () => notifyEnd(),
      onError: () => notifyEnd(),
    });
    return ok({
      stop: () => speechStudio.stop(),
      finished,
    });
  },

  stopAll(): void {
    speechStudio.stop();
  },

  listVoices(trackLanguage) {
    const lang: SupportedLanguage =
      trackLanguage === 'ja' ? 'JA' : trackLanguage === 'ko' ? 'KO' : 'EN';
    return speechStudio.listVoicesForLang(lang).map((v) => ({
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      voiceURI: v.voiceURI,
    }));
  },
};

let ensured = false;

/** 幂等注册默认引擎（main.tsx 启动时调用一次）。 */
export function ensureTtsEngines(): void {
  if (ensured) return;
  ensured = true;
  registerTtsEngine(webSpeechEngine);
  setActiveTtsEngine('webspeech');
}

export { getActiveTtsEngine, setActiveTtsEngine };
