/** Package-backed TTS adapter. Provider logic and fallback stay in gemini-tts-studio. */
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

export const studioTtsEngine: TtsEngine = {
  id: 'gemini-tts-studio',
  label: 'TTS Studio',

  async speak(request: TtsSpeakRequest): Promise<Result<TtsSpeakHandle, BusinessError>> {
    let notifyEnd: () => void = () => {};
    let playbackError: BusinessError | null = null;
    const finished = new Promise<void>((resolve) => { notifyEnd = resolve; });
    await speechStudio.speak(request.utteranceText, {
      lang: supportedFromBcp47(request.bcp47),
      rate: request.rate,
      ...(request.personaName ? { personaName: request.personaName } : {}),
      onEnd: notifyEnd,
      onError: (error) => {
        playbackError = error instanceof BusinessError
          ? error
          : new BusinessError('E_TTS_PLAYBACK', '语音播放失败。', 'TOOL_EXECUTION', false);
        notifyEnd();
      },
    });
    if (playbackError) return err(playbackError);
    return ok({ stop: () => speechStudio.stop(), finished });
  },

  stopAll(): void { speechStudio.stop(); },
};

let ensured = false;

export function ensureTtsEngines(): void {
  if (ensured) return;
  ensured = true;
  registerTtsEngine(studioTtsEngine);
  setActiveTtsEngine(studioTtsEngine.id);
}

export { getActiveTtsEngine, setActiveTtsEngine };
