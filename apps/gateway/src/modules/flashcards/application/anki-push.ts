import { eq, and } from 'drizzle-orm';
import { type Result, type BusinessError } from '@study-studio/shared';
import {
  pushCardToAnki as pushCardToAnkiUseCase,
  type AnkiPushRequest as AnkiPushRequestIn,
  type AnkiPushResult as AnkiPushResultOut,
  type AnkiPushPorts,
  type FetchImpl,
} from '@study-studio/flashcards';
// 跨模块复用（G5 已登记）：TTS 合成只取音频字节，Key 仅本次调用内存，永不落盘。
import {
  synthesizeViaProxy,
} from '../../tts/application/tts-proxy.js';
import {
  flashcards,
} from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { resolveCardSourceEntry } from './card-source.js';
import { getCardFormat } from '../persistence/card-formats.js';
import { getAnkiSettings } from '../persistence/anki-settings.js';

/**
 * M7-7 生词卡推送 Anki 薄组合层：编排已迁入 `@study-studio/flashcards`，
 * 此处只做 port 配接——
 * 用户设置、卡片/媒体读取、TTS 调用、事务仍归 Gateway；对外签名、返回形状、
 * 错误语义不变（未启用不发请求、SSRF 守卫、重复/不可达行为由用例保留）。
 */
export {
  type AnkiPushRequest,
  type AnkiPushResult,
  type AnkiPushTts,
} from '@study-studio/flashcards';

export async function pushCardToAnki(
  deps: RepoDeps,
  fetchImpl: FetchImpl,
  request: AnkiPushRequestIn
): Promise<Result<AnkiPushResultOut, BusinessError>> {
  const ports: AnkiPushPorts = {
    getSettings: () => getAnkiSettings(deps),
    loadCard: async ({ userId, cardId }) => {
      const cardRows = await deps.db
        .select()
        .from(flashcards)
        .where(and(eq(flashcards.userId, userId), eq(flashcards.id, cardId)))
        .limit(1);
      const card = cardRows[0];
      if (!card) return undefined;
      return {
        id: card.id,
        front: card.front,
        back: card.back,
        phonetic: card.phonetic ?? null,
        language: card.language ?? null,
        sourceEntryId: card.sourceEntryId ?? null,
      };
    },
    loadFormat: (formatId) => getCardFormat(deps, formatId),
    resolveSource: (card) => resolveCardSourceEntry(deps, card),
    synthesizeTts: (input) =>
      synthesizeViaProxy(
        {
          provider: input.provider,
          text: input.text,
          trackLanguage: input.trackLanguage,
          ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          ...(input.region ? { region: input.region } : {}),
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.voice ? { voice: input.voice } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.rate !== undefined ? { rate: input.rate } : {}),
          ...(input.gender ? { gender: input.gender } : {}),
        },
        fetchImpl
      ),
  };
  return pushCardToAnkiUseCase(ports, fetchImpl, request);
}
