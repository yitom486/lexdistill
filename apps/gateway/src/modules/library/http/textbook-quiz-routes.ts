import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { BusinessError, isOk } from '@study-studio/shared';
import { parseTextbookAST } from '@study-studio/document-model';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../transport/http/gateway-deps.js';
import { buildTextbookLessonQuestions, canQuizDocument } from '../application/textbook-lesson-quiz.js';
import { normalizeTrackLanguage } from '../../../infrastructure/persistence/language.js';

/**
 * 教材本课真出题：POST /api/textbook-quiz/:userId { documentId, lessonId, count? }。
 * 只消费本课 AST 已有语料（自带习题 → 生词选中释义 → 对话选译文），不调 LLM、不臆造；
 * 题目同步收进练习队列（转卡防线不变），同时返回给前端即时开练。
 * 无语料（未抽生词/课文不足）如实报错并指路「AI 抽生词」，不断链伪造。
 */
export function createTextbookQuizRoutes(deps: GatewayDeps) {
  return new Hono().post(
    '/api/textbook-quiz/:userId',
    validator('json', (value) => value as Record<string, unknown>),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const body = c.req.valid('json');
        const documentId = typeof body.documentId === 'string' ? body.documentId : '';
        const lessonId = typeof body.lessonId === 'string' ? body.lessonId : '';
        const count =
          typeof body.count === 'number' && Number.isFinite(body.count)
            ? Math.min(20, Math.max(1, Math.floor(body.count)))
            : 5;
        if (!documentId || !lessonId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请指定教材与课次', 'VALIDATION')
          );
        }
        const got = await deps.repo.getDocumentById(documentId);
        if (!isOk(got)) return formatBusinessErrorResponse(c, got.error);
        const doc = got.value;
        // 自有文档或公共课程资产（种子教材）可出题；别人的私档不行。
        if (!doc || !canQuizDocument(doc, userId)) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE')
          );
        }
        if (!doc.astJson) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '该文档没有结构化课文，无法出题', 'VALIDATION')
          );
        }
        let astRaw: unknown;
        try {
          astRaw = JSON.parse(doc.astJson);
        } catch {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '该文档课文结构已损坏，无法出题', 'VALIDATION')
          );
        }
        const parsed = parseTextbookAST(astRaw);
        if (!parsed.ok) return formatBusinessErrorResponse(c, parsed.error);
        const lesson = parsed.value.lessons.find((l) => l.id === lessonId);
        if (!lesson) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_NOT_FOUND', '该教材没有这一课', 'LEARNER_STATE')
          );
        }
        const language = normalizeTrackLanguage(doc.language);
        const built = buildTextbookLessonQuestions(lesson, count, language);
        if (!isOk(built)) return formatBusinessErrorResponse(c, built.error);
        const collected = await deps.repo.collectPracticeQuestions({
          userId,
          title: `《${parsed.value.title}》${lesson.title}专属测评`,
          intent: 'GENERATE_QUIZ',
          questions: built.value,
          sourceRef: `${documentId}/${lessonId}`,
        });
        if (!isOk(collected)) return formatBusinessErrorResponse(c, collected.error);
        return c.json({
          questions: built.value,
          collectionId: collected.value.collection.id,
          bookTitle: parsed.value.title,
          lessonTitle: lesson.title,
        });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'textbookLessonQuiz');
      }
    }
  );
}
