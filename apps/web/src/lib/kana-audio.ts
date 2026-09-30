/**
 * 假名发音解析（领域能力，UI 只负责调用）。
 *
 * 优先级：安装包内置音频（预生成打包，零延迟、离线可用、零边际成本）
 * → 清单缺失时返回 null/false，调用方回退实时 TTS。
 *
 * 全站假名发音统一走这里：单字（矩阵/讲义/声调示范）、整行连播（行指南/记忆法），
 * 单词例句等多字非假名串不在此列（走实时 TTS）。
 */
import type { KanaItem } from '@study-studio/protocol';
import { speechStudio } from '../utils/audio.js';
import { KANA_AUDIO_MANIFEST } from './kana-audio-manifest.js';
import { KANA_CHAR_TO_ID } from './kana-char-map.js';

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

/** 字符 → 假名 id（平/片/朗读文本任一对上即可；种子表生成，见 gen-kana-char-map）。 */
const CHAR_TO_KANA_ID: ReadonlyMap<string, string> = new Map(Object.entries(KANA_CHAR_TO_ID));

/**
 * 文本逐字解析为假名 id 序列：每个字符都必须落在种子表（平/片/audioText），
 * 任一字符对不上即返回 null（调用方走实时 TTS，不静默错位）。
 */
export function resolveKanaIds(text: string): string[] | null {
  const chars = [...text.trim()];
  if (chars.length === 0) return null;
  const ids: string[] = [];
  for (const ch of chars) {
    const id = CHAR_TO_KANA_ID.get(ch);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
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

let rowRunToken = 0;

/**
 * 整行连播：按 id 顺序逐个播内置音频（行指南「听整行」、记忆法行音频）。
 * 任一缺内置即返回 false（不播一半，调用方整段走实时 TTS）。
 * 停止键照常生效（停后链条不再推进）。
 */
export async function playKanaRow(
  ids: readonly string[],
  options?: { onEnd?: () => void; onError?: (error?: unknown) => void },
): Promise<boolean> {
  const urls = ids.map((id) => kanaAudioUrl(id));
  if (ids.length === 0 || urls.some((u) => !u)) return false;
  const token = ++rowRunToken;
  for (let i = 0; i < urls.length; i++) {
    if (token !== rowRunToken) return true;
    const isLast = i === urls.length - 1;
    // playLocalFile 的 promise 在开始播放即 resolve，连播必须等到真正播完，
    // 否则下一条立刻掐掉上一条（只剩最后一个字有声）。
    // epoch 必须在起播之后取值（playLocalFile 内部会先 stop 一次）：
    // 自然播完 epoch 不变→推进；外部 stop 使 epoch+1→链条停住。
    await speechStudio.playLocalFile(urls[i]!, ids.join(''), {
      ...(isLast && options?.onEnd ? { onEnd: options.onEnd } : {}),
      ...(options?.onError ? { onError: options.onError } : {}),
    });
    const epoch = speechStudio.getStopEpoch();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (token !== rowRunToken || speechStudio.getStopEpoch() !== epoch) {
          clearInterval(timer);
          resolve();
        } else if (!speechStudio.getIsSpeaking()) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
    if (token !== rowRunToken || speechStudio.getStopEpoch() !== epoch) return true;
  }
  return true;
}

/**
 * 文本入口（讲义按钮/声调示范共用）：单字播单字；多字纯假名串仅当 sequence=true
 * 才连播（行指南/记忆法行音频），否则返回 false。
 * 单词一律走实时 TTS（整词声调不能靠单字拼接），含单词等解不出的返回 false，
 * 调用方走实时 TTS。
 */
export async function playKanaText(
  text: string,
  options?: { onEnd?: () => void; onError?: (error?: unknown) => void; sequence?: boolean },
): Promise<boolean> {
  const ids = resolveKanaIds(text);
  if (!ids) return false;
  if (ids.length === 1) {
    const url = kanaAudioUrl(ids[0]!);
    if (!url) return false;
    await speechStudio.playLocalFile(url, text.trim(), options);
    return true;
  }
  if (!options?.sequence) return false;
  return playKanaRow(ids, options);
}
