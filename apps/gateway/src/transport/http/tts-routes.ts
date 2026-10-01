import { azureProvider, createTTSApp, geminiProvider, localProvider, type TTSProvider } from 'gemini-tts-studio/server';
import { withTtsErrorMessages } from './tts-errors.js';

export function createTtsRoutes(providers: TTSProvider[] = [geminiProvider, azureProvider, localProvider]) {
  return createTTSApp({
    prefix: '/api/tts-studio', corsOrigins: false, enableLogger: false,
    extraProviders: providers.map(withTtsErrorMessages),
  });
}
