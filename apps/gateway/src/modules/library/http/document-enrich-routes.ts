import { Hono } from 'hono';
import { BusinessError, isOk, logger } from '@study-studio/shared';
import { parseTextbookAST } from '@study-studio/protocol';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../transport/http/gateway-deps.js';
import { enrichBookLessons } from '../application/pdf-import/vocab-enrich.js';

/** 课本语种（JA/EN/KO）→ 用户轨道语种（ja/en/ko）；未知回 null（AST 照存，草稿跳过）。 */
function toTrackLanguage(bookLanguage: unknown): 'ja' | 'en' | 'ko' | null {
  if (bookLanguage === 'JA') return 'ja';
  if (bookLanguage === 'EN') return 'en';
  if (bookLanguage === 'KO') return 'ko';
  return null;
}

/**
 * 课文生词/文法 AI 抽取：POST /api/documents/:userId/:documentId/enrich { lessonId?, proposeDrafts? }。
 * 只抽尚无生词的课（已有词不覆盖）；模型输出经接地校验，非法条目丢弃计数。
 * 抽到的生词默认同步提议为草稿（source=ai-enrich，同键幂等去重；proposeDrafts=false 可关）。
 */
export function createDocumentEnrichRoutes(deps: GatewayDeps) {
  return new Hono().post('/api/documents/:userId/:documentId/enrich', async (c) => {
    try {
      const userId = c.req.param('userId');
      const documentId = c.req.param('documentId');
      let lessonId: string | undefined;
      let proposeDrafts = true;
      try {
        const body = (await c.req.json().catch(() => null)) as {
          lessonId?: unknown;
          proposeDrafts?: unknown;
        } | null;
        if (typeof body?.lessonId === 'string' && body.lessonId) lessonId = body.lessonId;
        if (body?.proposeDrafts === false) proposeDrafts = false;
      } catch {
        // 无 body = 整本抽取
      }
      const got = await deps.repo.getDocumentById(documentId);
      if (!isOk(got)) return formatBusinessErrorResponse(c, got.error);
      const doc = got.value;
      if (!doc || doc.userId !== userId) {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE')
        );
      }
      if (!doc.astJson) {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_INVALID_INPUT', '该文档没有结构化课文，无法抽生词', 'VALIDATION')
        );
      }
      let astRaw: unknown;
      try {
        astRaw = JSON.parse(doc.astJson);
      } catch {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_INVALID_INPUT', '该文档课文结构已损坏，无法抽生词', 'VALIDATION')
        );
      }
      const parsed = parseTextbookAST(astRaw);
      if (!parsed.ok) return formatBusinessErrorResponse(c, parsed.error);
      const enriched = await enrichBookLessons(
        deps.server.agentAdapter,
        parsed.value,
        lessonId ? [lessonId] : undefined
      );
      if (!enriched.ok) return formatBusinessErrorResponse(c, enriched.error);
      const now = new Date().toISOString();
      const saved = await deps.repo.saveDocument({
        ...doc,
        astJson: JSON.stringify(enriched.value.book),
        updatedAt: now,
      });
      if (!isOk(saved)) return formatBusinessErrorResponse(c, saved.error);
      // enrich 写回即拆：shred 与 AST 同源，失败只 warn（下次 enrich 回填），不推翻课文
      const shredded = await deps.repo.shredDocument(saved.value.id, enriched.value.book);
      let shredStats: { lessons: number; vocab: number; lines: number; mappedEntries: number; unmapped: number; exercises: number } | undefined;
      if (isOk(shredded)) {
        shredStats = {
          lessons: shredded.value.lessons,
          vocab: shredded.value.vocab,
          lines: shredded.value.lines,
          mappedEntries: shredded.value.mappedEntries,
          unmapped: shredded.value.unmapped,
          exercises: shredded.value.exercises,
        };
      } else {
        logger.warn('[document-enrich] shred failed', {
          code: shredded.error.code,
          documentId: saved.value.id,
        });
      }
      // 抽词→草稿：AST 落库为主路径；草稿提议失败只 warn，不推翻已存的课文。
      let draftsProposed = 0;
      let draftsError: string | undefined;
      const trackLanguage = toTrackLanguage(parsed.value.language);
      if (proposeDrafts && trackLanguage && enriched.value.draftables.length > 0) {
        const proposed = await deps.repo.proposeCardDrafts(
          enriched.value.draftables.map((d) => ({
            userId,
            language: trackLanguage,
            headword: d.vocab.kanji,
            meanings: [d.vocab.chinese],
            source: 'ai-enrich' as const,
            sourceRef: `${documentId}/${d.lessonId}`,
            ...(d.vocab.kana ? { reading: d.vocab.kana } : {}),
            ...(d.vocab.pos ? { partOfSpeech: d.vocab.pos } : {}),
          }))
        );
        if (isOk(proposed)) {
          draftsProposed = proposed.value.length;
        } else {
          draftsError = proposed.error.userMessage;
          logger.warn('[document-enrich] draft propose failed', {
            code: proposed.error.code,
            documentId,
          });
        }
      }
      return c.json({
        enrichedLessons: enriched.value.enrichedLessons,
        vocabularies: enriched.value.vocabularies,
        grammarPoints: enriched.value.grammarPoints,
        dropped: enriched.value.dropped,
        draftsProposed,
        ...(draftsError ? { draftsError } : {}),
        ...(shredStats ? { shred: shredStats } : {}),
      });
    } catch (e) {
      return formatBusinessErrorResponse(c, e, 'enrichDocument');
    }
  });
}
