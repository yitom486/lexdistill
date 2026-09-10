import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError, generateId } from '@study-studio/shared';
import {
  AnnotationKindSchema,
  DocumentSourceKindSchema,
} from '@study-studio/protocol';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../transport/http/gateway-deps.js';
import { tryParseTextbookAst } from '../persistence/textbook-shred.js';

/** 文库域路由：文档与批注（G2 迁移，行为不变）。 */

/** Hono validator 只保证 Record 形状；字符串字段在此处一次性收窄（非字符串一律 undefined）。 */
function strField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

/** 文档来源标记：非法值回退 user_import（种子/正常写入均为合法枚举，不受影响）。 */
function coerceDocumentSourceKind(value: unknown): 'user_import' | 'system' | 'ai_generated' | 'news' | 'curriculum_textbook' {
  const parsed = DocumentSourceKindSchema.safeParse(value);
  return parsed.success ? parsed.data : 'user_import';
}
export function createLibraryRoutes(deps: GatewayDeps) {
  return new Hono()
  // 6. 文档与教材 (Documents)
  .get('/api/documents/:userId', async (c) => {
    const userId = c.req.param('userId');
    const sourceKind = c.req.query('sourceKind');
    const res = await deps.repo.listDocuments(userId, sourceKind);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  .get('/api/documents/:userId/:documentId', async (c) => {
    const documentId = c.req.param('documentId');
    const res = await deps.repo.getDocumentById(documentId);
    if (isOk(res)) {
      if (!res.value) {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE')
        );
      }
      return c.json(res.value);
    }
    return formatBusinessErrorResponse(c, res.error);
  })
  // 阅读位置：每用户每文档一条游标（locator 不透明，前端组装 lessonId/offset/page）。
  .get('/api/documents/:userId/:documentId/position', async (c) => {
    const res = await deps.repo.getReadingPosition(c.req.param('userId'), c.req.param('documentId'));
    if (isOk(res)) return c.json({ position: res.value });
    return formatBusinessErrorResponse(c, res.error, 'readingPositionGet');
  })
  .put('/api/documents/:userId/:documentId/position', async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as { locator?: unknown } | null;
      const res = await deps.repo.saveReadingPosition(
        c.req.param('userId'),
        c.req.param('documentId'),
        body?.locator
      );
      if (isOk(res)) return c.json({ position: res.value });
      return formatBusinessErrorResponse(c, res.error, 'readingPositionSave');
    } catch (e) {
      return formatBusinessErrorResponse(c, e, 'readingPositionSave');
    }
  })
  // 打开课次即记（reading 源）：课文生词表记为见过，同课同天一次（幂等）。
  .post('/api/documents/:userId/:documentId/reading-exposures', async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as {
        lessonId?: unknown;
        language?: unknown;
        terms?: unknown;
      } | null;
      const termsRaw = Array.isArray(body?.terms) ? body.terms : [];
      const terms: Array<{ headword: string; reading?: string }> = [];
      for (const t of termsRaw.slice(0, 50)) {
        if (!t || typeof t !== 'object') {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '某词条不正确', 'VALIDATION')
          );
        }
        const rec = t as Record<string, unknown>;
        if (typeof rec.headword !== 'string' || !rec.headword.trim()) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '某词条 headword 非法', 'VALIDATION')
          );
        }
        terms.push({
          headword: rec.headword,
          ...(typeof rec.reading === 'string' ? { reading: rec.reading } : {}),
        });
      }
      const res = await deps.repo.recordReadingExposures({
        userId: c.req.param('userId'),
        language: typeof body?.language === 'string' ? body.language : '',
        documentId: c.req.param('documentId'),
        lessonId: typeof body?.lessonId === 'string' ? body.lessonId : '',
        terms,
      });
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error, 'readingExposures');
    } catch (e) {
      return formatBusinessErrorResponse(c, e, 'readingExposures');
    }
  })
  .post(
    '/api/documents/:userId',
    validator('json', (value) => value as Record<string, unknown>),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const body = c.req.valid('json');
        const now = new Date().toISOString();
        const docItem = {
          id: strField(body, 'id') || generateId('doc'),
          userId,
          title: strField(body, 'title') || '未命名教材/文档',
          sourceKind: coerceDocumentSourceKind(body.sourceKind),
          language: strField(body, 'language') || 'ja',
          content: strField(body, 'content') || '',
          astJson: body.astJson
            ? typeof body.astJson === 'string'
              ? body.astJson
              : JSON.stringify(body.astJson)
            : undefined,
          topic: strField(body, 'topic'),
          difficulty: body.difficulty ? Number(body.difficulty) : undefined,
          sourceUrl: strField(body, 'sourceUrl'),
          sourcePublisher: strField(body, 'sourcePublisher'),
          examTag: strField(body, 'examTag'),
          createdAt: strField(body, 'createdAt') || now,
          updatedAt: now,
        };
        // 教材形 AST 走唯一 canonical 写入口（同事务；失败即 err，不再 warn 后成功）。
        // 非教材（无 astJson / {questions} 等）继续普通保存。
        if (docItem.astJson) {
          const book = tryParseTextbookAst(docItem.astJson);
          if (book) {
            const { astJson: _omit, ...docBase } = docItem;
            void _omit;
            const res = await deps.repo.saveCanonicalAst(docBase, book);
            if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'saveDocument');
            return c.json(res.value);
          }
        }
        const res = await deps.repo.saveDocument(docItem);
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'saveDocument');
      }
    }
  )
  .delete('/api/documents/:userId/:documentId', async (c) => {
    const userId = c.req.param('userId');
    const documentId = c.req.param('documentId');
    const res = await deps.repo.deleteDocument(documentId, userId);
    if (isOk(res)) return c.json({ success: true, documentId });
    return formatBusinessErrorResponse(c, res.error);
  })
  // 7. 课文批注与重点 (Annotations)
  .get('/api/annotations/:userId/:documentId', async (c) => {
    const userId = c.req.param('userId');
    const documentId = c.req.param('documentId');
    const res = await deps.repo.listAnnotations(documentId, userId);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  .post(
    '/api/annotations/:userId',
    validator('json', (value) => value as Record<string, unknown>),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const body = c.req.valid('json');
        if (!body.documentId || !body.quote) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '批注必须包含所属文档与划线摘录', 'VALIDATION')
          );
        }
        const annItem = {
          id: strField(body, 'id') || generateId('ann'),
          documentId: String(body.documentId),
          userId,
          kind: AnnotationKindSchema.safeParse(body.kind).success
            ? (body.kind as 'KEY_POINT' | 'VOCAB' | 'GRAMMAR' | 'EXAM_TRAP' | 'PARAPHRASE')
            : 'KEY_POINT',
          quote: String(body.quote),
          note: body.note ? String(body.note) : undefined,
          startOffset: Number(body.startOffset || 0),
          endOffset: Number(body.endOffset || 0),
          pageNumber: body.pageNumber ? Number(body.pageNumber) : undefined,
          createdBy: body.createdBy === 'AGENT' ? ('AGENT' as const) : ('USER' as const),
          flashcardId: strField(body, 'flashcardId'),
          createdAt: strField(body, 'createdAt') || new Date().toISOString(),
        };
        const res = await deps.repo.saveAnnotation(annItem);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'saveAnnotation');
      }
    }
  )
  .delete('/api/annotations/:userId/:annotationId', async (c) => {
    const userId = c.req.param('userId');
    const annotationId = c.req.param('annotationId');
    const res = await deps.repo.deleteAnnotation(annotationId, userId);
    if (isOk(res)) return c.json({ success: true, annotationId });
    return formatBusinessErrorResponse(c, res.error);
  })
  .post(
    '/api/annotations/:userId/:annotationId/to-card',
    validator('json', (value) => value as Record<string, unknown>),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const annotationId = c.req.param('annotationId');
        const body = c.req.valid('json');
        if (!body.front || !body.back) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '转为生词卡必须提供正面词句与背面释义', 'VALIDATION')
          );
        }
        const res = await deps.repo.convertAnnotationToCard(annotationId, userId, {
          front: String(body.front),
          back: String(body.back),
          tag: body.tag ? String(body.tag) : '课文批注',
          pos: body.pos ? String(body.pos) : '重点词句',
          phonetic: body.phonetic ? String(body.phonetic) : undefined,
        });
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'convertAnnotationToCard');
      }
    }
  )
;
}
