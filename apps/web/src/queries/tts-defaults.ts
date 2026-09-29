import { useQuery } from '@tanstack/react-query';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';

/** 网关下发的 TTS 前端配置（默认服务 + 试音文案，领域包 SSOT）。 */
export interface TtsDefaults {
  defaultProvider: string;
  previewTexts: Record<string, string>;
}

function readDefaults(value: unknown): TtsDefaults {
  if (!value || typeof value !== 'object') throw new Error('网关 TTS 配置返回格式异常。');
  const record = value as Record<string, unknown>;
  const defaultProvider = record['defaultProvider'];
  const previewTexts = record['previewTexts'];
  if (typeof defaultProvider !== 'string' || !defaultProvider) {
    throw new Error('网关未返回默认 TTS 服务。');
  }
  if (!previewTexts || typeof previewTexts !== 'object' || Array.isArray(previewTexts)) {
    throw new Error('网关未返回试音文案配置。');
  }
  const texts: Record<string, string> = {};
  for (const [key, text] of Object.entries(previewTexts)) {
    if (typeof text === 'string' && text.trim()) texts[key] = text;
  }
  return { defaultProvider: defaultProvider.toLowerCase(), previewTexts: texts };
}

/** TTS 默认配置：运行时从网关拉取，前端不持有任何服务/文案字面量。 */
export function useTtsDefaultsQuery() {
  return useQuery({
    queryKey: ['tts-studio', 'defaults', GATEWAY_BASE_URL],
    queryFn: async (): Promise<TtsDefaults> => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/tts-studio/defaults`);
      if (!res.ok) throw new Error(`TTS 配置同步失败 (${res.status})`);
      return readDefaults(await res.json());
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
