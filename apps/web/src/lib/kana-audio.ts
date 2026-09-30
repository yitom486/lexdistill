/**
 * 假名发音解析（领域能力，UI 只负责调用）。
 *
 * 优先级：安装包内置音频（批量 TTS 预生成，零延迟、离线可用、零边际成本）
 * → 清单缺失时返回 null，调用方回退实时 TTS。
 */
import type { KanaItem } from '@study-studio/protocol';
import { speechStudio } from '../utils/audio.js';
import { KANA_AUDIO_MANIFEST } from './kana-audio-manifest.js';

const KANA_AUDIO_BASE = `${import.meta.env.BASE_URL}audio/kana/`;

/** 纯映射：清单 + 基址 → 文件 URL；缺失返回 null（可单测）。 */
export function resolveKanaAudioUrl(
  manifest: Record<string, string>,
  base: string,
  kanaId: string,
): string | null {
  const file = manifest[kanaId];
  if (!file) return null;
  return `${base}${file}`;
}

/** 假名内置音频 URL；未内置返回 null。 */
export function kanaAudioUrl(kanaId: string): string | null {
  return resolveKanaAudioUrl(KANA_AUDIO_MANIFEST, KANA_AUDIO_BASE, kanaId);
}

/** 是否有内置音频（用于 prefetch 判断等）。 */
export function hasKanaAudio(kanaId: string): boolean {
  return kanaAudioUrl(kanaId) !== null;
}

/**
 * 播放假名发音：有内置直接播内置；无内置返回 false，调用方转实时合成。
 * 与实时 TTS 共用 speechStudio 播放状态（停止键、isSpeaking 照常生效）。
 */
export async function playKanaAudio(
  kana: Pick<KanaItem, 'id' | 'audioText'>,
  options?: { onEnd?: () => void; onError?: (error?: unknown) => void },
): Promise<boolean> {
  const url = kanaAudioUrl(kana.id);
  if (!url) return false;
  await speechStudio.playLocalFile(url, kana.audioText, options);
  return true;
}
