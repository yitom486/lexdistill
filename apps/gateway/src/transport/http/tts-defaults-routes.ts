import { Hono } from 'hono';
import { listProviders } from 'gemini-tts-studio/server';
import { TTS_PREVIEW_TEXTS } from '@study-studio/speech';

/**
 * TTS 前端配置 SSOT 出口：默认服务取包注册表首项（包变更顺序/增减厂商，
 * 前端自动跟随，网关内不复刻任何字面量）；试音文案由领域包直供。
 */
export function createTtsDefaultsRoutes() {
  return new Hono().get('/api/tts-studio/defaults', (c) => {
    const defaultProvider = listProviders()[0]?.id ?? '';
    return c.json({ defaultProvider, previewTexts: TTS_PREVIEW_TEXTS });
  });
}
