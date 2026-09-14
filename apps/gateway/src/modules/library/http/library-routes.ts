import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError, generateId, logger } from '@study-studio/shared';
import {
  AnnotationKindSchema,
  DocumentSourceKindSchema,
} from '@study-studio/protocol';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { parseTextbookAST, type TextbookAST } from '@study-studio/document-model';
import { reconcileLessons, summarizeReconciliation, type ReconLessonInput } from '@study-studio/storage-sqlite';
import { tryParseTextbookAst } from '@study-studio/storage-sqlite';

/** 文库域路由：文档与批注（G2 迁移，行为不变）。 */

/** P3-2 段文本预览上限（响应防膨胀；完整文本走段投影源，不经文档 GET）。 */
const SEGMENT_TEXT_PREVIEW = 200;

export type AstJsonClass =
  | { kind: 'none' }
  | { kind: 'textbook'; book: TextbookAST }
  | { kind: 'non-textbook' }
  | { kind: 'invalid'; code: 'E_INVALID_INPUT' | 'E_INVALID_TEXTBOOK_AST'; message: string };

/**
 * POST /api/documents 输入边界分类器（纯函数，P1-C0.75a）：
 * - 无 astJson → none（普通 saveDocument）；
 * - 合法 TextbookAST → textbook（saveCanonicalAst）；
 * - 已知合法非教材形（白名单：`{questions: [...]}` 阅读/新闻形，无 lessons）→ non-textbook；
 * - JSON 非法 → invalid/E_INVALID_INPUT；
 * - 含 lessons 但未通过 TextbookASTSchema（含重复 lesson.id、字段损坏）→ invalid/E_INVALID_TEXTBOOK_AST；
 * - 其他未知形态 → invalid/E_INVALID_INPUT（绝不静默当普通文档保存）。
 */
export function classifyDocumentAstJson(raw: unknown): AstJsonClass {
  if (raw === undefined || raw === null || raw === '') return { kind: 'none' };
  let parsed: unknown;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'invalid', code: 'E_INVALID_INPUT', message: '文档结构不是合法 JSON，请检查后重试' };
    }
  } else {
    parsed = raw;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'invalid', code: 'E_INVALID_INPUT', message: '文档结构不是合法对象，请检查后重试' };
  }
  const rec = parsed as Record<string, unknown>;
  if (Array.isArray(rec.lessons)) {
    const book = parseTextbookAST(parsed);
    if (book.ok) return { kind: 'textbook', book: book.value };
    return { kind: 'invalid', code: 'E_INVALID_TEXTBOOK_AST', message: '教材结构校验失败（课次缺失/重复课 id/字段损坏），未保存' };
  }
  // 已知合法非教材形白名单：阅读/新闻 `{questions: [...]}`（种子与阅读管线直写，路由透传兼容）。
  if (Array.isArray(rec.questions)) return { kind: 'non-textbook' };
  return { kind: 'invalid', code: 'E_INVALID_INPUT', message: '未知文档结构（非教材亦非已知阅读形），未保存' };
}

/** TextbookLesson → reconciliation 输入（只取 speaker/japanese 与词面，不含译文）。 */
function toReconInput(lessons: TextbookAST['lessons']): ReconLessonInput[] {
  return lessons.map((l) => ({
    id: l.id,
    title: l.title,
    dialogues: l.dialogues.map((d) => ({ speaker: d.speaker, japanese: d.japanese })),
    vocabularies: l.vocabularies.map((v) => ({ surface: v.kanji })),
  }));
}

/** 序列确实变化（id 或标题序列任一不同）才值得 shadow；完全相同直接跳过。 */
function lessonsChanged(oldL: TextbookAST['lessons'], newL: TextbookAST['lessons']): boolean {
  if (oldL.length !== newL.length) return true;
  return oldL.some((l, i) => l.id !== newL[i]?.id || l.title !== newL[i]?.title);
}

/** Hono validator 只保证 Record 形状；字符串字段在此处一次性收窄（非字符串一律 undefined）。 */
function strField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Authorized replacement shadow（P1-C0.8，只观察不干预；P1-C0.8a 可观测性修复）。
 * 前置：existing 已授权 + 旧 AST 合法 + incoming 合法 + 序列变化。
 * 全程 fail-open：evaluator/logger 故障只记固定分类运维日志，永不阻断保存、不写库。
 * 可观测性：真实 replacement 经 logger.warn 输出（默认 level=warn 可见），明确标注为
 * “需人工审阅的 shadow observation”，不是用户可见错误；不引新框架/遥测/表/文件。
 * 安全：observation payload 仅为 summarizeReconciliation 的安全摘要（documentId、
 * 计数、AUTO 行 oldLessonId/newIndex/信号/rounded sim、risk 计数与 old ids）；
 * fault payload 仅固定 event+documentId+code；绝不记录 exception.message/stack、
 * 正文/title 原文/token/dialogue/vocab surface/sourceRef/userId/locator。
 */
const SHADOW_OBSERVE_MSG =
  '[lesson-reconcile-shadow] replacement observed — needs human review (shadow only, save unaffected)';
const SHADOW_FAULT_MSG =
  '[lesson-reconcile-shadow] evaluator fault — shadow skipped (save unaffected)';
const SHADOW_FAULT_EVENT = 'lesson-reconcile-shadow-evaluator-error';
const SHADOW_FAULT_CODE = 'E_SHADOW_EVALUATOR_FAILED';

/** P1-C0.8a：测试断言用常量导出（不改变路由行为，仅供单测锁定触发前缀与固定分类）。 */
export const SHADOW_OBSERVE_CONSTANTS = {
  observeMsg: SHADOW_OBSERVE_MSG,
  faultMsg: SHADOW_FAULT_MSG,
  faultEvent: SHADOW_FAULT_EVENT,
  faultCode: SHADOW_FAULT_CODE,
} as const;

function emitShadowFault(documentId: string): void {
  try {
    logger.warn(SHADOW_FAULT_MSG, {
      event: SHADOW_FAULT_EVENT,
      documentId,
      code: SHADOW_FAULT_CODE,
    });
  } catch {
    // logger 本身故障时吞掉：保存不受影响，不再套娃记录。
  }
}

/** P1-C0.8a：导出仅供单测直验 fail-open（生产仅 POST 教材覆盖路径调用；不改路由行为）。 */
export async function shadowReconcile(
  deps: GatewayDeps,
  documentId: string,
  oldAstJson: string,
  incoming: TextbookAST
): Promise<void> {  try {
    const oldBook = tryParseTextbookAst(oldAstJson);
    if (!oldBook) return;
    if (!lessonsChanged(oldBook.lessons, incoming.lessons)) return;
    let result: ReturnType<typeof reconcileLessons>;
    try {
      result = reconcileLessons(toReconInput(oldBook.lessons), toReconInput(incoming.lessons));
    } catch {
      emitShadowFault(documentId);
      return;
    }
    // durable risk：REMOVED/AMBIGUOUS/split/merge/absorb 涉及的旧 id 被 locator 引用即计数
    const risky = new Set<string>();
    for (const p of result.pairs) if (p.status === 'AMBIGUOUS') risky.add(p.oldId);
    for (const x of result.removed) risky.add(x.oldId);
    for (const r of result.relations) for (const id of r.oldIds) risky.add(id);
    let atRisk: string[] = [];
    try {
      const refs = await deps.repo.listDocumentLessonRefs(documentId);
      if (refs.ok) atRisk = refs.value.filter((id) => risky.has(id));
    } catch {
      // 位置读取失败不阻断 shadow 主体（risk 计 0）
    }
    let summary: ReturnType<typeof summarizeReconciliation>;
    try {
      summary = summarizeReconciliation(documentId, result, atRisk);
    } catch {
      emitShadowFault(documentId);
      return;
    }
    try {
      logger.warn(SHADOW_OBSERVE_MSG, summary);
    } catch {
      // 运维日志自身故障不阻断保存。
    }
  } catch {
    emitShadowFault(documentId);
  }
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
    const userId = c.req.param('userId');
    const documentId = c.req.param('documentId');
    const res = await deps.repo.getDocumentById(documentId);
    if (isOk(res)) {
      // Ownership 边界（P1-C0.8 Task 0）：private 文档仅 owner 可读；
      // 公共种子（curriculum_textbook）保持可见；其余统一 E_NOT_FOUND，不泄露存在性。
      if (!res.value || (res.value.userId !== userId && res.value.sourceKind !== 'curriculum_textbook')) {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE')
        );
      }
      // P3-2 opt-in segments 桥：默认关闭（形状不变）；开启时附段地址，
      // 文本截断防膨胀（SEGMENT_TEXT_PREVIEW），跨用户口径与上同。
      if (c.req.query('includeSegments') === 'true') {
        const segs = await deps.repo.listContentSegments(documentId);
        if (!isOk(segs)) return formatBusinessErrorResponse(c, segs.error, 'documentSegments');
        return c.json({
          ...res.value,
          segments: segs.value.map((s) => ({
            ...s,
            text: s.text.length > SEGMENT_TEXT_PREVIEW ? s.text.slice(0, SEGMENT_TEXT_PREVIEW) : s.text,
            truncated: s.text.length > SEGMENT_TEXT_PREVIEW,
          })),
        });
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
        // Ownership 边界（P1-C0.8 Task 0）：覆盖既有文档必须先验 owner；
        // 他人文档（含公共种子，他人不可覆盖）统一 E_NOT_FOUND；新 id 创建不受影响。
        const existing = await deps.repo.getDocumentById(docItem.id);
        if (!isOk(existing)) return formatBusinessErrorResponse(c, existing.error);
        if (existing.value && existing.value.userId !== userId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE')
          );
        }
        // AST 输入边界：分类后分流；非法教材形/未知形态直接拒绝，绝不 saveDocument。
        const astClass = classifyDocumentAstJson(docItem.astJson);
        if (astClass.kind === 'invalid') {
          return formatBusinessErrorResponse(
            c,
            new BusinessError(astClass.code, astClass.message, 'VALIDATION'),
            'saveDocument'
          );
        }
        if (astClass.kind === 'textbook') {
          // 教材形走唯一 canonical 写入口（同事务；失败即 err）。
          // Shadow：仅 existing 已授权 + 旧 AST 合法 + 序列变化时只读观察；
          // 不改 incoming、不阻断保存、不写库。
          if (existing.value?.astJson) {
            await shadowReconcile(deps, docItem.id, existing.value.astJson, astClass.book);
          }
          const { astJson: _omit, ...docBase } = docItem;
          void _omit;
          const res = await deps.repo.saveCanonicalAst(docBase, astClass.book);
          if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'saveDocument');
          return c.json(res.value);
        }
        // none / 已知非教材形：普通保存。
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
