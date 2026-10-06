import type { TTSGenerateRequest, TTSProvider, VoiceInfo } from 'gemini-tts-studio/server';

export interface VerifiedVoice {
  id: string;
  name: string;
  gender: 'female' | 'male';
  description: string;
}

/**
 * Google Gemini 官方认证可用于多模态语音合成与双人对话的预置音色清单。
 * 过滤未认证的实验性、提示型和地域专属音色（如 ar-001-advisor-1 等），确保 100% 可用。
 */
export const VERIFIED_GEMINI_VOICES: readonly VerifiedVoice[] = [
  { id: 'Aoede', name: 'Aoede', gender: 'female', description: '轻快、自然且富有表现力的通用女声（推荐）' },
  { id: 'Puck', name: 'Puck', gender: 'male', description: '充满活力、清晰明快的通用男声（推荐）' },
  { id: 'Fenrir', name: 'Fenrir', gender: 'male', description: '沉稳、低沉且有磁性的成熟男声' },
  { id: 'Kore', name: 'Kore', gender: 'female', description: '坚定、冷静且清晰的标准女声' },
  { id: 'Charon', name: 'Charon', gender: 'male', description: '温和、沉静且富有知性的解说男声' },
  { id: 'Leda', name: 'Leda', gender: 'female', description: '柔和、亲切的日常对话女声' },
  { id: 'Orus', name: 'Orus', gender: 'male', description: '自信、平稳的叙事男声' },
  { id: 'Zephyr', name: 'Zephyr', gender: 'female', description: '温润、轻柔的助读女声' },
  { id: 'Achernar', name: 'Achernar', gender: 'female', description: '清脆、敏锐的对话女声' },
  { id: 'Alnilam', name: 'Alnilam', gender: 'male', description: '果断、有力的朗读男声' },
  { id: 'Algenib', name: 'Algenib', gender: 'male', description: '明亮、清晰的朗读男声' },
  { id: 'Algieba', name: 'Algieba', gender: 'female', description: '生动、富有变化的表演女声' },
  { id: 'Alkaid', name: 'Alkaid', gender: 'male', description: '平实、质朴的叙事男声' },
];

const CANONICAL_MAP = new Map<string, string>(
  VERIFIED_GEMINI_VOICES.map((v) => [v.id.toLowerCase(), v.id]),
);

/** 将传入的音色 ID 纠正为官方标准 PascalCase 预置名；遇非法实验音色自动安全回退 */
export function normalizeGeminiVoiceName(name?: string, fallback = 'Aoede'): string {
  if (!name || typeof name !== 'string') return fallback;
  const trimmed = name.trim();
  const canonical = CANONICAL_MAP.get(trimmed.toLowerCase());
  if (canonical) return canonical;
  // 已知历史实验性音色安全回退
  const lower = trimmed.toLowerCase();
  if (lower === 'achird' || lower.includes('advisor-10')) return 'Puck';
  if (lower.startsWith('ar-001') || lower.includes('advisor-1')) return 'Aoede';
  return fallback;
}

/** 从远端返回的全量音色中过滤出已认证的预置音色并排序 */
export function filterVerifiedGeminiVoices(remoteVoices: VoiceInfo[]): VoiceInfo[] {
  const result: VoiceInfo[] = [];
  const remoteByName = new Map<string, VoiceInfo>();

  for (const v of remoteVoices) {
    const key = v.id.toLowerCase();
    if (CANONICAL_MAP.has(key)) {
      remoteByName.set(key, v);
    }
  }

  for (const item of VERIFIED_GEMINI_VOICES) {
    const key = item.id.toLowerCase();
    const remote = remoteByName.get(key);
    result.push({
      id: item.id,
      name: item.name,
      gender: item.gender,
      description: remote?.description || item.description,
      provider: 'gemini',
      kind: 'prebuilt',
    });
  }

  return result;
}

/** 包装 Gemini Provider：过滤声音列表为官方认证白名单，并规范化合成音色入参 */
export function withGeminiVoiceFilter(provider: TTSProvider): TTSProvider {
  if (provider.id !== 'gemini') return provider;

  const originalListVoices = provider.listVoices.bind(provider);
  const originalSynthesize = provider.synthesize.bind(provider);
  const originalSynthesizeStream = provider.synthesizeStream?.bind(provider);

  const normalizeParams = (params: TTSGenerateRequest): TTSGenerateRequest => {
    const voiceName = normalizeGeminiVoiceName(params.voiceName);
    const speakers = params.speakers?.map((s) => ({
      ...s,
      voiceName: normalizeGeminiVoiceName(s.voiceName, s.speaker.toLowerCase().includes('2') ? 'Puck' : 'Aoede'),
    }));
    return {
      ...params,
      voiceName,
      ...(speakers ? { speakers } : {}),
    };
  };

  return {
    ...provider,
    async listVoices(...args) {
      try {
        const raw = await originalListVoices(...args);
        const filtered = filterVerifiedGeminiVoices(raw);
        if (filtered.length > 0) return filtered;
      } catch {
        // 远端调用失败或受限时，安全回退到静态认证清单
      }
      return VERIFIED_GEMINI_VOICES.map((v) => ({
        id: v.id,
        name: v.name,
        gender: v.gender,
        description: v.description,
        provider: 'gemini',
        kind: 'prebuilt',
      }));
    },
    async synthesize(params, ...rest) {
      return originalSynthesize(normalizeParams(params), ...rest);
    },
    ...(originalSynthesizeStream ? {
      async synthesizeStream(params, ...rest) {
        return originalSynthesizeStream(normalizeParams(params), ...rest);
      },
    } : {}),
  };
}
