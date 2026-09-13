/**
 * Azure Speech（Cognitive Services）TTS 纯函数：SSML 组装与端点/鉴权头。
 * REST 契约：POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 * （无需 SDK；Key 只走 Ocp-Apim-Subscription-Key 头，永不进 URL/日志）。
 */
import type { TtsTrackLanguage } from './types.js';

/** 分轨道×性别默认神经音色（顶部男女声在自动档下直达云端）。 */
export const AZURE_DEFAULT_VOICES: Record<TtsTrackLanguage, Record<'FEMALE' | 'MALE', string>> = {
  ja: { FEMALE: 'ja-JP-NanamiNeural', MALE: 'ja-JP-KeitaNeural' },
  ko: { FEMALE: 'ko-KR-SunHiNeural', MALE: 'ko-KR-InJoonNeural' },
  en: { FEMALE: 'en-US-JennyNeural', MALE: 'en-US-GuyNeural' },
};

export const AZURE_VOICE_LANG: Record<TtsTrackLanguage, string> = {
  ja: 'ja-JP',
  ko: 'ko-KR',
  en: 'en-US',
};

export function azureTtsEndpoint(region: string): string {
  return `https://${region.trim().toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export function azureVoicesEndpoint(region: string): string {
  return `https://${region.trim().toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
}

export function azureTtsHeaders(apiKey: string): Record<string, string> {
  return {
    'Ocp-Apim-Subscription-Key': (apiKey ?? '').trim(),
    'Content-Type': 'application/ssml+xml',
    'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
  };
}

export function escapeXmlText(text: string): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 组装 SSML。rate 为本系统语速口径（1.0=常速）：Azure 把 N% 理解为相对提速 N%
 * （实测 rate="100%" 时长减半），故换算为相对值：0.75 → "-25%"，1.2 → "+20%"；
 * rate 恰为 1.0 时不包 prosody，与自然语速逐字节一致。
 */
export function buildAzureSsml(
  text: string,
  options?: {
    voice?: string | undefined;
    trackLanguage?: TtsTrackLanguage | undefined;
    gender?: 'FEMALE' | 'MALE' | undefined;
    rate?: number | undefined;
    /** 说话风格（如 cheerful / chat / customerservice），须为该音色 StyleList 成员 */
    style?: string | undefined;
  }
): string {
  const track = options?.trackLanguage ?? 'en';
  const gender = options?.gender ?? 'FEMALE';
  const voice =
    (options?.voice ?? '').trim() ||
    AZURE_DEFAULT_VOICES[track]?.[gender] ||
    AZURE_DEFAULT_VOICES.en.FEMALE;
  const lang = AZURE_VOICE_LANG[track] || AZURE_VOICE_LANG.en;
  const rate = options?.rate;
  // 注意：Azure 对无属性的 <prosody> 空壳直接回 400；无 rate 时不包 prosody。
  // 相对值换算：本系统 1.0=常速 → "+0%"（等价自然语速，直接省略）。
  // 孤立的「わ」在部分日语神经音色中会被错误判读；进入上下文（如「わを」）则正常。
  // 只对这个已复现的单假名加音素提示，避免改写正常词语的自然发音。
  let inner =
    track === 'ja' && text === 'わ'
      ? `<phoneme alphabet="ipa" ph="w a">${escapeXmlText(text)}</phoneme>`
      : escapeXmlText(text);
  if (rate !== undefined && Number.isFinite(rate)) {
    const relative = Math.min(400, Math.max(-90, Math.round((rate - 1) * 100)));
    if (relative !== 0) {
      const sign = relative > 0 ? '+' : '';
      inner = `<prosody rate="${sign}${relative}%">${inner}</prosody>`;
    }
  }
  // 风格走 mstts 命名空间（须为该音色支持的风格，否则 Azure 回 400，由调用方保证）
  const style = (options?.style ?? '').trim();
  if (style) {
    inner = `<mstts:express-as style="${style}">${inner}</mstts:express-as>`;
  }
  const msttsNs = style ? ' xmlns:mstts="https://www.w3.org/2001/mstts"' : '';
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"${msttsNs} xml:lang="${lang}">` +
    `<voice name="${voice}">${inner}</voice></speak>`
  );
}

/** Azure voices/list 单条（只取映射需要的子集，未知字段忽略）。 */
export interface AzureVoiceListItem {
  Name?: string | undefined;
  ShortName: string;
  Gender?: string | undefined;
  Locale?: string | undefined;
  VoiceType?: string | undefined;
  StyleList?: string[] | undefined;
}

export interface AzureVoiceOption {
  /** 如 ja-JP-NanamiNeural（可直接填回 voice）。 */
  id: string;
  /** 如 Nanami（女）。 */
  label: string;
  gender: 'FEMALE' | 'MALE';
  locale: string;
  styles: string[];
}

/**
 * voices/list → 下拉选项：只要 Neural 音色，按语种前缀过滤，
 * 名字从 ShortName 解析（ja-JP-NanamiNeural → Nanami），未知形状整条丢弃不抛错。
 */
export function mapAzureVoiceList(
  items: unknown,
  trackLanguage: TtsTrackLanguage
): AzureVoiceOption[] {
  if (!Array.isArray(items)) return [];
  const prefix =
    trackLanguage === 'ja' ? 'ja-JP' : trackLanguage === 'ko' ? 'ko-KR' : 'en-US';
  const out: AzureVoiceOption[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<AzureVoiceListItem>;
    const id = typeof item.ShortName === 'string' ? item.ShortName : '';
    if (!id || !id.startsWith(prefix)) continue;
    if (item.VoiceType && item.VoiceType !== 'Neural') continue;
    const nameMatch = id.match(/^[a-z]{2}-[A-Z]{2}-([A-Za-z]+)Neural$/);
    const name = nameMatch?.[1] ?? id;
    const gender = String(item.Gender ?? '').toLowerCase().startsWith('male') ? 'MALE' : 'FEMALE';
    const styles = Array.isArray(item.StyleList)
      ? item.StyleList.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : [];
    out.push({
      id,
      label: `${name}（${gender === 'MALE' ? '男' : '女'}）`,
      gender: gender as 'FEMALE' | 'MALE',
      locale: typeof item.Locale === 'string' ? item.Locale : prefix,
      styles,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
