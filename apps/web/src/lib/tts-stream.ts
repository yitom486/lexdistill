/**
 * 网关流式 TTS 客户端：只连自研 Gateway `POST /api/tts-studio/tts/stream`（SSE）。
 *
 * 全站唯一语音合成通道（一次性 `/tts/unified` 已下线）：边下边播，
 * 无 synthesizeStream 的厂商由网关自动降级为单包，前端同一套解析。
 */

import { GATEWAY_BASE_URL } from './api-client.js';
import { base64ToBytes, parsePcmRate } from './pcm-audio.js';

export interface TtsStreamBody {
  provider: string;
  text: string;
  voiceName: string;
  model?: string | undefined;
  languageCode?: string | undefined;
  region?: string | undefined;
  endpoint?: string | undefined;
  speed?: number | undefined;
}

export interface TtsStreamChunk {
  bytes: Uint8Array;
  sampleRate: number;
  mimeType: string;
  index: number;
}

export interface TtsStreamResult {
  chunks: Uint8Array[];
  sampleRate: number;
  mimeType: string;
}

/** 网关下发的 SSE 事件（成功分片 / 完成 / 结构化失败）。 */
export type TtsStreamEvent =
  | { audio: string; mimeType?: string }
  | { done: true; mimeType?: string }
  | { error: string; code?: string; retryable?: boolean };

/** 携带网关错误码的流式失败，便于上层翻译为 BusinessError。 */
export class TtsStreamError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(message: string, code = 'E_TTS_UPSTREAM', retryable = true) {
    super(message);
    this.name = 'TtsStreamError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * 一次合成请求的归一化描述：voice/model 为引擎实际使用的解析值，
 * voiceAuto/modelAuto 记录用户当时是否处于“自动选择”（未锁定）。
 */
export interface TtsRequestDescriptor {
  text: string;
  provider: string;
  voice: string;
  voiceAuto: boolean;
  model: string;
  modelAuto: boolean;
  lang: string;
  rate: number;
  purpose: string;
}

/**
 * 本地缓存是否可直接重播：文本/服务/语种/语速/用途必须完全一致；
 * 音色与模型按“显式锁定必须相同，自动模式沿用上次自动结果”的规则匹配。
 * 命中即免费重播本地 Blob，不再发请求、不再计费。
 */
export function matchTtsRequest(last: TtsRequestDescriptor | null, current: TtsRequestDescriptor | null): boolean {
  if (!last || !current) return false;
  if (current.text !== last.text) return false;
  if (current.provider !== last.provider) return false;
  if (current.lang !== last.lang) return false;
  if (current.rate !== last.rate) return false;
  if (current.purpose !== last.purpose) return false;
  if (current.voice ? current.voice !== last.voice : !last.voiceAuto) return false;
  if (current.provider === 'gemini' && (current.model ? current.model !== last.model : !last.modelAuto)) return false;
  return true;
}

/**
 * 组装流式请求体。网关强制要求 voiceName（gemini 还要求 model），
 * 缺失时直接抛错、不发请求，避免无意义的 400 计费往返。
 */
export function buildTtsStreamBody(input: {
  provider: string;
  text: string;
  voiceName: string;
  model?: string;
  languageCode?: string;
  region?: string;
  endpoint?: string;
  speed?: number;
}): TtsStreamBody {
  const provider = (input.provider || 'gemini').toLowerCase();
  const text = (input.text || '').trim();
  if (!text) throw new TtsStreamError('朗读文本不能为空。', 'E_TTS_TEXT', false);
  if (text.length > 20000) throw new TtsStreamError('朗读文本超过 20000 字符上限。', 'E_TTS_TEXT', false);
  const voiceName = (input.voiceName || '').trim();
  if (!voiceName) throw new TtsStreamError('未指定音色 voiceName。', 'E_TTS_VOICE', false);
  const model = (input.model || '').trim();
  if (provider === 'gemini' && !model) {
    throw new TtsStreamError('未指定模型 model。', 'E_TTS_MODEL', false);
  }
  const speed = input.speed;
  if (speed !== undefined && !(Number.isFinite(speed) && speed >= 0.25 && speed <= 4)) {
    throw new TtsStreamError('语速 speed 必须在 0.25 到 4 之间。', 'E_TTS_SPEED', false);
  }
  return {
    provider,
    text,
    voiceName,
    ...(model ? { model } : {}),
    // speechMetadata 已彻底移除：上游曾把它拼成 `Say in a <x> style:` 读出来，
    // 既是前奏又是浪费 token。用途只留在本地 purpose，不进请求体。
    ...(input.languageCode?.trim() ? { languageCode: input.languageCode.trim() } : {}),
    ...(input.region?.trim() ? { region: input.region.trim() } : {}),
    ...(input.endpoint?.trim() ? { endpoint: input.endpoint.trim() } : {}),
    ...(speed !== undefined ? { speed } : {}),
  };
}

/** 解析单行 SSE data 载荷；非 data 行返回 null（心跳/注释直接忽略）。 */
export function parseSseLine(line: string): TtsStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload: unknown = JSON.parse(trimmed.slice(5).trim());
  if (!payload || typeof payload !== 'object') {
    throw new TtsStreamError('流式返回了无法识别的事件。', 'E_TTS_UPSTREAM', true);
  }
  return payload as TtsStreamEvent;
}

/**
 * 拉取网关 SSE 流：收齐音频分片，逐包回调（首包即播）。
 * 无分片即结束时抛错；服务端 `{"error"}` 事件转为 TtsStreamError。
 */
export async function fetchTtsStream(
  body: TtsStreamBody,
  opts?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    onChunk?: (chunk: TtsStreamChunk) => void | Promise<void>;
  },
): Promise<TtsStreamResult> {
  const res = await fetch(`${GATEWAY_BASE_URL}/api/tts-studio/tts/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(opts?.headers ?? {}) },
    body: JSON.stringify(body),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok || !res.body) {
    let message = `流式生成失败 (${res.status})`;
    let code = 'E_TTS_UPSTREAM';
    try {
      const data: unknown = await res.json();
      if (data && typeof data === 'object') {
        const record = data as { error?: unknown; code?: unknown };
        if (typeof record.error === 'string' && record.error) message = record.error;
        if (typeof record.code === 'string' && record.code) code = record.code;
      }
    } catch {
      // 保持默认 message
    }
    throw new TtsStreamError(message, code, res.status >= 500 || res.status === 429);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  const chunks: Uint8Array[] = [];
  let sampleRate = 24000;
  let mimeType = 'audio/L16;codec=pcm;rate=24000';

  const handleLine = async (line: string): Promise<void> => {
    const event = parseSseLine(line);
    if (!event || !('audio' in event) && !('error' in event) && !('done' in event)) return;
    if ('error' in event && event.error) {
      throw new TtsStreamError(event.error, event.code || 'E_TTS_UPSTREAM', event.retryable ?? true);
    }
    if ('audio' in event && event.audio) {
      if (event.mimeType) mimeType = event.mimeType;
      sampleRate = parsePcmRate(event.mimeType ?? mimeType);
      const bytes = base64ToBytes(event.audio);
      const index = chunks.length;
      chunks.push(bytes);
      await opts?.onChunk?.({ bytes, sampleRate, mimeType, index });
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = sseBuffer.indexOf('\n\n')) >= 0) {
        const rawEvent = sseBuffer.slice(0, idx);
        sseBuffer = sseBuffer.slice(idx + 2);
        for (const line of rawEvent.split('\n')) {
          if (line.trim()) await handleLine(line);
        }
      }
    }
    if (sseBuffer.trim()) {
      for (const line of sseBuffer.split('\n')) {
        if (line.trim()) await handleLine(line);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (chunks.length === 0) {
    throw new TtsStreamError('流式返回中未收到音频数据。', 'E_TTS_UPSTREAM', true);
  }
  return { chunks, sampleRate, mimeType };
}
