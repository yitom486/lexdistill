import { azureProvider, createTTSApp, geminiProvider, localProvider, type TTSProvider } from 'gemini-tts-studio/server';
import { withTtsErrorMessages } from './tts-errors.js';
import { withGeminiVoiceFilter } from './gemini-voices.js';

export function createTtsRoutes(providers: TTSProvider[] = [geminiProvider, azureProvider, localProvider]) {
  return createTTSApp({
    prefix: '/api/tts-studio', corsOrigins: false, enableLogger: false,
    extraProviders: providers.map((p) => withTtsErrorMessages(withGeminiVoiceFilter(p))),
  });
}
