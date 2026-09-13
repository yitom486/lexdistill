import {
  AZURE_DEFAULT_VOICES,
  azureTtsEndpoint,
  azureTtsHeaders,
  azureVoicesEndpoint,
  buildAzureSsml,
  buildOpenAiSpeechPayload,
  isHttpEndpoint,
  mapAzureVoiceList,
  normalizeTtsTrackLanguage,
  openAiSpeechHeaders,
  type AzureVoiceOption,
  type TtsTrackLanguage,
} from '@study-studio/speech';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';

/**
 * TTS 云端/本地代理（网关侧直调第三方，浏览器只连网关）。
 *
 * - Key 由调用方随请求传入，网关不落盘、不记日志、不进错误上下文；
 * - 覆盖 OpenAI `/v1/audio/speech` 兼容端点（公有云 / 自建网关 / 本地兼容服务）
 *   与 Azure Speech 原生 REST；其他家原生签名协议暂不直连。
 */
export const TTS_PROXY_PROVIDERS = ['openai-compatible', 'azure-speech'] as const;
export type TtsProxyProvider = (typeof TTS_PROXY_PROVIDERS)[number];

export const DEFAULT_OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const MAX_TEXT_LENGTH = 1000;
const PROXY_TIMEOUT_MS = 20000;

export interface TtsProxySynthesizeInput {
  provider: string;
  text: string;
  /** ja / en / ko（大小写/变体均可，未知回退 en）。 */
  trackLanguage?: string | undefined;
  /** OpenAI 兼容：完整端点 URL（缺省官方）；Azure：region 代码。 */
  baseUrl?: string | undefined;
  region?: string | undefined;
  apiKey?: string | undefined;
  /** 音色 id/名（缺省按轨道回填）。 */
  voice?: string | undefined;
  model?: string | undefined;
  /** 本系统语速口径（1.0=常速），透传给端点。 */
  rate?: number | undefined;
  gender?: 'FEMALE' | 'MALE' | undefined;
  /** Azure 说话风格（须为该音色 StyleList 成员，如 cheerful/chat）。 */
  style?: string | undefined;
}

export interface TtsProxyAudio {
  audio: Uint8Array;
  contentType: string;
  provider: TtsProxyProvider;
  voice: string;
  bytes: number;
}

export type FetchImpl = typeof fetch;

function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function badInput(message: string): BusinessError {
  return new BusinessError('E_INVALID_INPUT', message, 'VALIDATION', false);
}

/** 按 provider 拼出请求三元组（url/headers/body），顺带完成鉴权必填校验。 */
function buildProviderRequest(input: Required<Pick<TtsProxySynthesizeInput, 'provider' | 'text'>> & TtsProxySynthesizeInput):
  | { url: string; headers: Record<string, string>; body: string | Record<string, unknown>; voice: string; contentType: 'json' | 'ssml' }
  | { error: BusinessError } {
  const track: TtsTrackLanguage = normalizeTtsTrackLanguage(input.trackLanguage ?? 'en');
  const text = (input.text ?? '').trim();
  if (!text) return { error: badInput('朗读文本不能为空。') };
  if (text.length > MAX_TEXT_LENGTH) {
    return { error: badInput(`朗读文本过长（最多 ${MAX_TEXT_LENGTH} 字），请分段合成。`) };
  }
  const apiKey = (input.apiKey ?? '').trim();
  const voice = (input.voice ?? '').trim();

  if (input.provider === 'openai-compatible') {
    const url = (input.baseUrl ?? '').trim() || DEFAULT_OPENAI_SPEECH_URL;
    if (!isHttpEndpoint(url)) return { error: badInput('端点 URL 必须以 http(s):// 开头。') };
    // 本地服务可免 Key；公网端点必须带 Key（否则一定 401，不如前置拦截）
    if (!apiKey && !isLocalhostUrl(url)) {
      return { error: badInput('该端点需要 API Key，请先填写后再试。') };
    }
    const payload = buildOpenAiSpeechPayload(text, {
      ...(input.model ? { model: input.model } : {}),
      ...(voice ? { voice } : {}),
      gender: input.gender ?? 'FEMALE',
      bcp47: track === 'ja' ? 'ja-JP' : track === 'ko' ? 'ko-KR' : 'en-US',
      ...(input.rate !== undefined ? { speed: input.rate } : {}),
    });
    return {
      url,
      headers: openAiSpeechHeaders(apiKey),
      body: payload,
      voice: String(payload.voice ?? ''),
      contentType: 'json',
    };
  }

  if (input.provider === 'azure-speech') {
    const region = (input.region ?? input.baseUrl ?? '').trim();
    if (!region) return { error: badInput('Azure Speech 需要填写区域（如 japaneast）。') };
    if (!apiKey) return { error: badInput('Azure Speech 需要 API Key，请先填写后再试。') };
    const gender = input.gender ?? 'FEMALE';
    const resolvedVoice = voice || AZURE_DEFAULT_VOICES[track]?.[gender] || AZURE_DEFAULT_VOICES.en.FEMALE;
    const style = (input.style ?? '').trim();
    const ssml = buildAzureSsml(text, {
      voice: resolvedVoice,
      trackLanguage: track,
      gender,
      rate: input.rate,
      ...(style ? { style } : {}),
    });
    return {
      url: azureTtsEndpoint(region),
      headers: azureTtsHeaders(apiKey),
      body: ssml,
      voice: resolvedVoice,
      contentType: 'ssml',
    };
  }

  return {
    error: badInput(`暂不支持的 TTS 服务：${input.provider}（当前支持 openai-compatible / azure-speech）。`),
  };
}

function mapProxyError(status: number, provider: TtsProxyProvider): BusinessError {
  if (status === 401 || status === 403) {
    return new BusinessError(
      'E_TTS_AUTH',
      'TTS 服务鉴权失败：API Key 无效或无权限，请检查后重试。',
      'TOOL_EXECUTION',
      false
    );
  }
  if (status === 400) {
    return new BusinessError(
      'E_INVALID_INPUT',
      'TTS 请求被服务端拒绝（400）：请检查音色 id / 区域 / 文本是否合规。',
      'VALIDATION',
      false
    );
  }
  if (status === 429) {
    return new BusinessError(
      'E_TTS_RATE_LIMIT',
      'TTS 服务限流（429）：稍等片刻再试，或降低并发。',
      'TOOL_EXECUTION',
      true
    );
  }
  return new BusinessError(
    'E_TOOL_EXECUTION',
    `TTS 服务返回异常（${status}），请稍后重试。`,
    'TOOL_EXECUTION',
    true
  );
}

/**
 * 经网关直调第三方 TTS 并取回音频字节。Key 仅存于本次调用内存，
 * 任何分支都不把 Key 写入错误/日志。
 */
export async function synthesizeViaProxy(
  input: TtsProxySynthesizeInput,
  fetchImpl: FetchImpl = fetch
): Promise<Result<TtsProxyAudio, BusinessError>> {
  try {
    if (!TTS_PROXY_PROVIDERS.includes(input.provider as TtsProxyProvider)) {
      return err(
        badInput(`暂不支持的 TTS 服务：${input.provider}（当前支持 openai-compatible / azure-speech）。`)
      );
    }
    const provider = input.provider as TtsProxyProvider;
    const built = buildProviderRequest({ ...input, provider, text: input.text });
    if ('error' in built) return err(built.error);

    const res = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: built.contentType === 'json' ? JSON.stringify(built.body) : (built.body as string),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!res.ok) return err(mapProxyError(res.status, provider));

    const contentType = res.headers.get('content-type') ?? 'audio/mpeg';
    if (!contentType.includes('audio') && !contentType.includes('octet-stream')) {
      return err(
        new BusinessError('E_TOOL_EXECUTION', 'TTS 服务未返回音频数据，请检查端点是否为语音合成接口。', 'TOOL_EXECUTION', false)
      );
    }
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.length === 0) {
      return err(
        new BusinessError('E_TOOL_EXECUTION', 'TTS 服务返回了空音频，请重试。', 'TOOL_EXECUTION', true)
      );
    }
    return ok({
      audio: buffer,
      contentType: contentType.split(';')[0]!.trim(),
      provider,
      voice: built.voice,
      bytes: buffer.length,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return err(
        new BusinessError('E_TTS_TIMEOUT', 'TTS 服务响应超时（20s），请检查网络或换区域/端点重试。', 'NETWORK', true)
      );
    }
    return err(
      translateToBusinessError(error, { category: 'NETWORK', action: 'synthesizeViaProxy' })
    );
  }
}

const PROBE_TEXT: Record<TtsTrackLanguage, string> = {
  ja: 'こんにちは',
  ko: '안녕하세요',
  en: 'Hello',
};

/** 有效性验证：用一句话探针走完全链路，只回元数据不返音频。 */
export async function validateProxyCredentials(
  input: TtsProxySynthesizeInput,
  fetchImpl: FetchImpl = fetch
): Promise<
  Result<
    { ok: true; provider: TtsProxyProvider; voice: string; bytes: number; contentType: string },
    BusinessError
  >
> {
  const track = normalizeTtsTrackLanguage(input.trackLanguage ?? 'en');
  const res = await synthesizeViaProxy(
    { ...input, text: PROBE_TEXT[track] },
    fetchImpl
  );
  if (!res.ok) return err(res.error);
  return ok({
    ok: true as const,
    provider: res.value.provider,
    voice: res.value.voice,
    bytes: res.value.bytes,
    contentType: res.value.contentType,
  });
}

export interface TtsVoicesInput {
  provider: string;
  region?: string | undefined;
  apiKey?: string | undefined;
  trackLanguage?: string | undefined;
}

/**
 * 拉取 Azure 全量音色（含各音色可用风格），按当前轨道过滤后返回。
 * Key 同合成链路：随请求传入、不落盘；非 azure provider 直接报不支持
 * （OpenAI 兼容协议无标准声音列表接口）。
 */
export async function listProxyVoices(
  input: TtsVoicesInput,
  fetchImpl: FetchImpl = fetch
): Promise<Result<{ provider: TtsProxyProvider; voices: AzureVoiceOption[] }, BusinessError>> {
  try {
    if (input.provider !== 'azure-speech') {
      return err(
        badInput(
          `该服务无标准声音列表接口：${input.provider} 请手动填写音色 id（如 alloy）。`
        )
      );
    }
    const region = (input.region ?? '').trim();
    if (!region) return err(badInput('Azure Speech 需要填写区域（如 japaneast）。'));
    const apiKey = (input.apiKey ?? '').trim();
    if (!apiKey) return err(badInput('Azure Speech 需要 API Key，请先填写后再试。'));
    const track = normalizeTtsTrackLanguage(input.trackLanguage ?? 'en');

    const res = await fetchImpl(azureVoicesEndpoint(region), {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!res.ok) return err(mapProxyError(res.status, 'azure-speech'));
    const data: unknown = await res.json();
    return ok({ provider: 'azure-speech', voices: mapAzureVoiceList(data, track) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return err(
        new BusinessError('E_TTS_TIMEOUT', 'TTS 服务响应超时（20s），请检查网络或换区域重试。', 'NETWORK', true)
      );
    }
    return err(
      translateToBusinessError(error, { category: 'NETWORK', action: 'listProxyVoices' })
    );
  }
}
