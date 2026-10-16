import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@lexdistill/shared';
import {
  buildCardContext,
  renderCard,
  type AnkiCardFormat,
  type CardSourceEntry,
} from './render/index.js';
import {
  createAnkiClient,
  ensureAnkiDeck,
  ensureAnkiModel,
  storeAnkiMedia,
  addAnkiNote,
  getAnkiVersion,
  type FetchImpl,
} from './integrations/index.js';
import type { ResolvableCard } from './card-source.js';

/**
 * M7-7 自 Gateway `flashcards/application/anki-push.ts` 迁入（行为不变）。
 *
 * 生词卡推送 Anki 编排：读取设置与卡片来源 → 渲染 → 可选音频 → 调用 AnkiConnect。
 * 只依赖最小 port、Flashcards 公共 API 与 Result/BusinessError 契约；
 * 不导入 Gateway、Drizzle、SQLite 或 TTS 实现。
 *
 * 不变量（逐项保留）：
 * - 未启用直接拒绝，不发任何网络请求；
 * - 端点经 createAnkiClient 收窄（仅本机回环，SSRF 守卫）；
 * - 重复笔记走 E_ANKI_DUPLICATE 短路，不可达走可重试 E_ANKI_UNREACHABLE。
 */

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export interface AnkiPushTts {
  provider: string;
  baseUrl?: string | undefined;
  localBaseUrl?: string | undefined;
  localApiKey?: string | undefined;
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
  ttsWarning?: string | undefined;
}

/** port 视角的设置（Gateway 用 Anki 开关持久化实现）。 */
export interface AnkiPushSettings {
  enabled: boolean;
  endpoint: string;
}

/** port 视角的卡片行（Gateway 用 flashcards 表实现；仅读渲染所需列）。 */
export interface AnkiPushCard extends ResolvableCard {
  id: string;
  front: string;
  back: string;
  phonetic: string | null;
  language: string | null;
  sourceEntryId: string | null;
}

/** port 视角的 TTS 合成请求（Gateway 调用 npm 包；Key 随调用来、用完即弃）。 */
export interface AnkiPushTtsRequest {
  provider: string;
  text: string;
  trackLanguage: string;
  baseUrl?: string | undefined;
  localBaseUrl?: string | undefined;
  localApiKey?: string | undefined;
  region?: string | undefined;
  apiKey?: string | undefined;
  voice?: string | undefined;
  model?: string | undefined;
  rate?: number | undefined;
  gender?: 'FEMALE' | 'MALE' | undefined;
}

/** port 视角的 TTS 合成产物（只取音频字节，不碰凭证与播放）。 */
export interface AnkiPushAudio {
  bytes: number;
  contentType: string;
  audio: Uint8Array;
  ttsWarning?: string | undefined;
}

/** 推送用例所需的最小读取/合成能力（Gateway 实现，见薄组合层）。 */
export interface AnkiPushPorts {
  /** 用户 Anki 开关与端点（读侧永不抛，损坏回默认，由 Gateway 保证）。 */
  getSettings(): Promise<AnkiPushSettings>;
  /** 按用户+卡片 id 读取（找不到返回 undefined）。 */
  loadCard(input: { userId: string; cardId: string }): Promise<AnkiPushCard | undefined>;
  /** 按模板 id 读取（含内置回退由调用方决定；找不到返回 undefined）。 */
  loadFormat(formatId: string): Promise<AnkiCardFormat | undefined>;
  /** 卡片 → 词条上下文（有来源取读音/释义/声调/词频，否则回退卡片自身，不臆造）。 */
  resolveSource(card: {
    front: string;
    back: string;
    phonetic: string | null;
    sourceEntryId: string | null;
  }): Promise<{ source: CardSourceEntry; sourceLabel?: string | undefined }>;
  /** TTS 合成；显式请求后失败必须向用户报错。 */
  synthesizeTts(input: AnkiPushTtsRequest): Promise<Result<AnkiPushAudio, BusinessError>>;
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
  ports: AnkiPushPorts,
  fetchImpl: FetchImpl,
  request: AnkiPushRequest
): Promise<Result<AnkiPushResult, BusinessError>> {
  try {
    const settings = await ports.getSettings();
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

    const card = await ports.loadCard({ userId: request.userId, cardId: request.cardId });
    if (!card) {
      return err(
        new BusinessError('E_NOT_FOUND', '该生词卡不存在或不属于你', 'LEARNER_STATE', false)
      );
    }

    const format = await ports.loadFormat(request.formatId ?? 'study-basic');
    if (!format) {
      return err(
        new BusinessError('E_INVALID_INPUT', '找不到该卡片模板，请先选择或恢复内置模板', 'VALIDATION', false)
      );
    }

    // 条目上下文：有来源词条时取读音/释义/声调/词频，否则回退卡片自身前后端（不臆造）。
    const { source, sourceLabel } = await ports.resolveSource({
      front: card.front,
      back: card.back,
      phonetic: card.phonetic,
      sourceEntryId: card.sourceEntryId,
    });

    const ctx = buildCardContext(source);
    const rendered = renderCard(format, ctx);
    const fields: Record<string, string> = { ...rendered.fields };

    const deckName = request.deckName ?? format.deckName ?? 'LexDistill';
    const modelName = format.modelName ?? 'LexDistill Basic';
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
    let ttsWarning: string | undefined;
    if (request.tts) {
      const synth = await ports.synthesizeTts({
        provider: request.tts.provider,
        text: source.reading ?? source.headword,
        trackLanguage: card.language ?? 'ja',
        ...(request.tts.baseUrl ? { baseUrl: request.tts.baseUrl } : {}),
        ...(request.tts.localBaseUrl ? { localBaseUrl: request.tts.localBaseUrl } : {}),
        ...(request.tts.localApiKey ? { localApiKey: request.tts.localApiKey } : {}),
        ...(request.tts.region ? { region: request.tts.region } : {}),
        ...(request.tts.apiKey ? { apiKey: request.tts.apiKey } : {}),
        ...(request.tts.voice ? { voice: request.tts.voice } : {}),
        ...(request.tts.model ? { model: request.tts.model } : {}),
        ...(request.tts.rate !== undefined ? { rate: request.tts.rate } : {}),
        ...(request.tts.gender ? { gender: request.tts.gender } : {}),
      });
      if (!isOk(synth)) return synth;
      ttsWarning = synth.value.ttsWarning;
      if (synth.value.bytes > MAX_AUDIO_BYTES) {
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

    const tags = ['lexdistill', ...(sourceLabel ? [sourceLabel] : [])];
    const added = await addAnkiNote(client, { deckName, modelName, fields, tags });
    if (!isOk(added)) return added;
    const result: AnkiPushResult = {
      noteId: added.value,
      deckName,
      modelName,
      formatId: format.id,
      audioStored,
      ...(audioSkippedReason ? { audioSkippedReason } : {}),
      ...(ttsWarning ? { ttsWarning } : {}),
    };
    return ok(result);
  } catch (e) {
    return err(translateToBusinessError(e, 'pushCardToAnki'));
  }
}
