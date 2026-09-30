import { eq, and } from 'drizzle-orm';
import { ok, err, BusinessError, translateToBusinessError, type Result } from '@study-studio/shared';
import { synthesizeUnified, UnifiedSynthesisError } from 'gemini-tts-studio/server';
import {
  pushCardToAnki as pushCardToAnkiUseCase,
  type AnkiPushRequest as AnkiPushRequestIn,
  type AnkiPushResult as AnkiPushResultOut,
  type AnkiPushPorts,
  type FetchImpl,
} from '@study-studio/flashcards';
import {
  flashcards,
} from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { resolveCardSourceEntry } from './card-source.js';
import { getCardFormat } from '@study-studio/storage-sqlite';
import { getAnkiSettings } from '@study-studio/storage-sqlite';

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
    synthesizeTts: async (input) => {
      try {
        const result = await synthesizeUnified({
          text: input.text,
          language: input.trackLanguage,
          // 不传 purpose：上游会把它转成 speechMetadata 并拼成
          // `Say in a <purpose> style:` 读出来，又是前奏又浪费 token。
          preferredService: input.provider,
          ...(input.model ? { model: input.model } : {}),
          voicePreference: {
            ...(input.voice ? { voiceId: input.voice } : {}),
            ...(input.gender ? { gender: input.gender === 'MALE' ? 'male' : 'female' } : {}),
          },
          credentials: {
            ...(input.provider === 'gemini' && input.apiKey ? { geminiApiKey: input.apiKey } : {}),
            ...(input.provider === 'azure' && input.apiKey ? { azureKey: input.apiKey } : {}),
            ...(input.region ? { azureRegion: input.region } : {}),
            ...(input.localBaseUrl ? { localBaseUrl: input.localBaseUrl } : {}),
            ...(input.localApiKey ? { localApiKey: input.localApiKey } : {}),
          },
        });
        const audio = Buffer.from(result.audioBase64, 'base64');
        return ok({
          audio,
          bytes: audio.length,
          contentType: result.mimeType,
          ...(result.usedFallback ? { ttsWarning: `首选 ${result.preferredError?.provider ?? input.provider} 失败，已使用本地 TTS：${result.preferredError?.message ?? '原因未提供'}` } : {}),
        });
      } catch (error) {
        if (error instanceof UnifiedSynthesisError) {
          const failure = error.failure;
          return err(new BusinessError('E_TTS_SYNTHESIS',
            `首选 ${failure.preferredError.provider} 失败：${failure.preferredError.message}${failure.fallbackError ? `；本地 TTS 失败：${failure.fallbackError.message}` : ''}`,
            'TOOL_EXECUTION', false));
        }
        return err(translateToBusinessError(error, 'ANKI_TTS_SYNTHESIS'));
      }
    },
  };
  return pushCardToAnkiUseCase(ports, fetchImpl, request);
}
