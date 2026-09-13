import { eq, and } from 'drizzle-orm';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';
import {
  buildCardContext,
  renderCard,
} from '@study-studio/learner-core';
// 跨模块复用（G5 已登记）：TTS 合成只取音频字节，Key 仅本次调用内存，永不落盘。
import {
  synthesizeViaProxy,
  type TtsProxySynthesizeInput,
} from '../../tts/application/tts-proxy.js';
import {
  flashcards,
} from '../../../infrastructure/db/index.js';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { resolveCardSourceEntry } from './card-source.js';
import { getCardFormat } from '../persistence/card-formats.js';
import { getAnkiSettings } from '../persistence/anki-settings.js';
import {
  createAnkiClient,
  ensureAnkiDeck,
  ensureAnkiModel,
  storeAnkiMedia,
  addAnkiNote,
  getAnkiVersion,
  type FetchImpl,
} from '@study-studio/flashcard-integrations';

/**
 * 生词卡推送 Anki 命令（HTTP 与 `flashcards.anki_push` Tool 共用）。
 * 推送对象是用户自己的 FSRS 卡；呈现走模板渲染，音频走 TTS 合成（凭证随请求来、用完即弃）。
 */

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export interface AnkiPushTts {
  provider: string;
  baseUrl?: string | undefined;
  region?: string | undefined;
  apiKey?: string | undefined;
  voice?: string | undefined;
  model?: string | undefined;
  rate?: number | undefined;
  gender?: 'FEMALE' | 'MALE' | undefined;
}

export interface AnkiPushRequest {
  userId: string;
  cardId: string;
  formatId?: string | undefined;
  deckName?: string | undefined;
  /** TTS 凭证（仅本次调用内存；不提供则音频字段留空，模板条件块自动隐藏）。 */
  tts?: AnkiPushTts | undefined;
}

export interface AnkiPushResult {
  noteId: number;
  deckName: string;
  modelName: string;
  formatId: string;
  audioStored: boolean;
  audioSkippedReason?: string | undefined;
}

function audioExtension(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mp4') || ct.includes('m4a')) return 'm4a';
  return 'mp3';
}

export async function pushCardToAnki(
  deps: RepoDeps,
  fetchImpl: FetchImpl,
  request: AnkiPushRequest
): Promise<Result<AnkiPushResult, BusinessError>> {
  try {
    const settings = await getAnkiSettings(deps);
    if (!settings.enabled) {
      return err(
        new BusinessError(
          'E_ANKI_DISABLED',
          'Anki 推送未启用：请先在设置中打开，并确认本机 Anki 已安装 AnkiConnect 插件',
          'VALIDATION',
          false
        )
      );
    }

    const cardRows = await deps.db
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.userId, request.userId), eq(flashcards.id, request.cardId)))
      .limit(1);
    const card = cardRows[0];
    if (!card) {
      return err(
        new BusinessError('E_NOT_FOUND', '该生词卡不存在或不属于你', 'LEARNER_STATE', false)
      );
    }

    const format = await getCardFormat(deps, request.formatId ?? 'study-basic');
    if (!format) {
      return err(
        new BusinessError('E_INVALID_INPUT', '找不到该卡片模板，请先选择或恢复内置模板', 'VALIDATION', false)
      );
    }

    // 条目上下文：有来源词条时取读音/释义/声调/词频，否则回退卡片自身前后端（不臆造）。
    const { source, sourceLabel } = await resolveCardSourceEntry(deps, {
      front: card.front,
      back: card.back,
      phonetic: card.phonetic,
      sourceEntryId: card.sourceEntryId,
    });

    const ctx = buildCardContext(source);
    const rendered = renderCard(format, ctx);
    const fields: Record<string, string> = { ...rendered.fields };

    const deckName = request.deckName ?? format.deckName ?? 'Lingua Studio';
    const modelName = format.modelName ?? 'Lingua Basic';
    const client = createAnkiClient(settings.endpoint, fetchImpl);
    const version = await getAnkiVersion(client);
    if (!isOk(version)) return version;
    const deck = await ensureAnkiDeck(client, deckName);
    if (!isOk(deck)) return deck;
    const model = await ensureAnkiModel(client, {
      modelName,
      fields: Object.keys(format.fields),
      css: format.css,
      front: format.frontTemplate,
      back: format.backTemplate,
    });
    if (!isOk(model)) return model;

    // 音频：有凭证才合成 → 存媒体 → [sound:]；否则留空（{{#Audio}} 自动隐藏）。
    let audioStored = false;
    let audioSkippedReason: string | undefined = '未提供 TTS 凭证，音频字段留空（模板条件块自动隐藏）';
    if (request.tts) {
      const ttsInput: TtsProxySynthesizeInput = {
        provider: request.tts.provider,
        text: source.reading ?? source.headword,
        trackLanguage: card.language ?? 'ja',
        ...(request.tts.baseUrl ? { baseUrl: request.tts.baseUrl } : {}),
        ...(request.tts.region ? { region: request.tts.region } : {}),
        ...(request.tts.apiKey ? { apiKey: request.tts.apiKey } : {}),
        ...(request.tts.voice ? { voice: request.tts.voice } : {}),
        ...(request.tts.model ? { model: request.tts.model } : {}),
        ...(request.tts.rate !== undefined ? { rate: request.tts.rate } : {}),
        ...(request.tts.gender ? { gender: request.tts.gender } : {}),
      };
      const synth = await synthesizeViaProxy(ttsInput, fetchImpl);
      if (!isOk(synth)) {
        audioSkippedReason = `TTS 合成失败（${synth.error.userMessage}），已跳过音频推送`;
      } else if (synth.value.bytes > MAX_AUDIO_BYTES) {
        audioSkippedReason = '合成音频过大（>8MB），已跳过音频推送';
      } else {
        const ext = audioExtension(synth.value.contentType);
        const filename = `ss-${card.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'audio'}.${ext}`;
        const base64 = Buffer.from(synth.value.audio).toString('base64');
        const stored = await storeAnkiMedia(client, filename, base64);
        if (!isOk(stored)) {
          audioSkippedReason = `Anki 媒体入库失败（${stored.error.userMessage}），已跳过音频推送`;
        } else {
          fields['Audio'] = `[sound:${stored.value}]`;
          audioStored = true;
          audioSkippedReason = undefined;
        }
      }
    }

    const tags = ['lingua-studio', ...(sourceLabel ? [sourceLabel] : [])];
    const added = await addAnkiNote(client, { deckName, modelName, fields, tags });
    if (!isOk(added)) return added;
    const result: AnkiPushResult = {
      noteId: added.value,
      deckName,
      modelName,
      formatId: format.id,
      audioStored,
      ...(audioSkippedReason ? { audioSkippedReason } : {}),
    };
    return ok(result);
  } catch (e) {
    return err(translateToBusinessError(e, 'pushCardToAnki'));
  }
}
