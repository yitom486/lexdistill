import { eq, and, desc, or, sql } from 'drizzle-orm';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
  logger,
} from '@study-studio/shared';
import type { DocumentItem, AnnotationItem, Flashcard, TextbookAST } from '@study-studio/protocol';
import { parseTextbookAST } from '@study-studio/protocol';
import {
  AnnotationKindSchema,
  type AnnotationKind,
  DocumentSourceKindSchema,
  type DocumentSourceKind,
} from '@study-studio/protocol';
import { documents, annotations, textbookLessons, textbookLines, textbookVocab, textbookGrammar, textbookExercises, textbookTermMap, documentStructures, readingPositions } from '../../../infrastructure/db/index.js';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { shredIntoTransaction } from './textbook-shred.js';
import { recordTermExposure } from '../../dictionary/persistence/encountered-terms.js';

/**
 * 文档/批注域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域互调直接调模块函数。
 */

/** DB TEXT 列 → 联合类型；损坏值回退中性默认（读侧永不抛，种子/正常写入不受影响）。 */
function coerceDocumentSourceKind(value: unknown): DocumentSourceKind {
  const parsed = DocumentSourceKindSchema.safeParse(value);
  return parsed.success ? parsed.data : 'user_import';
}

function coerceAnnotationKind(value: unknown): AnnotationKind {
  const parsed = AnnotationKindSchema.safeParse(value);
  return parsed.success ? parsed.data : 'KEY_POINT';
}

function coerceCreatedBy(value: unknown): 'USER' | 'AGENT' {
  return value === 'AGENT' ? 'AGENT' : 'USER';
}

export async function saveDocument(
  deps: RepoDeps,
  doc: DocumentItem
): Promise<Result<DocumentItem, BusinessError>> {
  // 注意：教材形 AST 禁止走这里静默落库（无 shred、无原子性）——教材写一律用
  // saveCanonicalAst；本函数仅服务非教材 document 与刻意构造漂移态的测试/修复脚本。
  try {
    const existing = await deps.db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id))
      .limit(1);

    if (existing.length > 0) {
      await deps.db
        .update(documents)
        .set({
          title: doc.title,
          sourceKind: doc.sourceKind,
          language: doc.language,
          content: doc.content,
          astJson: doc.astJson ?? null,
          topic: doc.topic ?? null,
          difficulty: doc.difficulty ?? null,
          sourceUrl: doc.sourceUrl ?? null,
          sourcePublisher: doc.sourcePublisher ?? null,
          examTag: doc.examTag ?? null,
          updatedAt: doc.updatedAt || nowIso(),
        })
        .where(eq(documents.id, doc.id));
    } else {
      await deps.db.insert(documents).values({
        id: doc.id,
        userId: doc.userId,
        title: doc.title,
        sourceKind: doc.sourceKind,
        language: doc.language,
        content: doc.content,
        astJson: doc.astJson ?? null,
        topic: doc.topic ?? null,
        difficulty: doc.difficulty ?? null,
        sourceUrl: doc.sourceUrl ?? null,
        sourcePublisher: doc.sourcePublisher ?? null,
        examTag: doc.examTag ?? null,
        createdAt: doc.createdAt || nowIso(),
        updatedAt: doc.updatedAt || nowIso(),
      });
    }

    return ok(doc);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveDocument',
        entityId: doc.id,
      })
    );
  }
}

/**
 * 唯一 canonical AST 写入口（P1-C0.75 Task 2）：
 * canonical TextbookAST
 *   → 内部 validate + JSON.stringify
 *   → documents.ast_json write + shredIntoTransaction，同一 transaction commit。
 *
 * - 不接受独立 doc.astJson：调用方传不含 astJson 的 docBase + 已解析 book，
 *   ast_json 一律由入口内部从验证后的 book 生成，杜绝“两份 canonical 不一致”；
 * - 任一步失败整体 rollback 并返回 err（绝不 WARN 后返回成功）；
 * - 复用 shredIntoTransaction，不复制 shred 实现；
 * - 非教材 document（{questions} 等）继续走普通 saveDocument；
 * - 教材形 AST 禁止再经普通 saveDocument 静默落库（各生产调用方已迁移，见下）。
 */
export async function saveCanonicalAst(
  deps: RepoDeps,
  docBase: Omit<DocumentItem, 'astJson'>,
  book: TextbookAST
): Promise<Result<DocumentItem, BusinessError>> {
  const checked = parseTextbookAST(JSON.parse(JSON.stringify(book)));
  if (!checked.ok) return err(checked.error);
  const canonical = checked.value;
  const doc: DocumentItem = { ...docBase, astJson: JSON.stringify(canonical) };
  try {
    deps.db.transaction((tx) => {
      const existing = tx.select().from(documents).where(eq(documents.id, doc.id)).limit(1).all();
      if (existing.length > 0) {
        tx.update(documents)
          .set({
            title: doc.title,
            sourceKind: doc.sourceKind,
            language: doc.language,
            content: doc.content,
            astJson: doc.astJson ?? null,
            topic: doc.topic ?? null,
            difficulty: doc.difficulty ?? null,
            sourceUrl: doc.sourceUrl ?? null,
            sourcePublisher: doc.sourcePublisher ?? null,
            examTag: doc.examTag ?? null,
            updatedAt: doc.updatedAt || nowIso(),
          })
          .where(eq(documents.id, doc.id))
          .run();
      } else {
        tx.insert(documents)
          .values({
            id: doc.id,
            userId: doc.userId,
            title: doc.title,
            sourceKind: doc.sourceKind,
            language: doc.language,
            content: doc.content,
            astJson: doc.astJson ?? null,
            topic: doc.topic ?? null,
            difficulty: doc.difficulty ?? null,
            sourceUrl: doc.sourceUrl ?? null,
            sourcePublisher: doc.sourcePublisher ?? null,
            examTag: doc.examTag ?? null,
            createdAt: doc.createdAt || nowIso(),
            updatedAt: doc.updatedAt || nowIso(),
          })
          .run();
      }
      shredIntoTransaction(tx, doc.id, canonical);
    });
    return ok(doc);
  } catch (error) {
    if (error instanceof BusinessError) return err(error);
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveCanonicalAst',
        entityId: doc.id,
      })
    );
  }
}

export async function listDocuments(
  deps: RepoDeps,
  userId: string,
  sourceKind?: string
): Promise<Result<DocumentItem[], BusinessError>> {
  try {
    const query = deps.db.select().from(documents);
    // 内置课程是公共资产：curriculum_textbook 对所有用户可见（用户自有文档仍按 userId 隔离）
    const conditions = [or(eq(documents.userId, userId), eq(documents.sourceKind, 'curriculum_textbook'))];
    if (sourceKind) {
      conditions.push(eq(documents.sourceKind, sourceKind));
    }

    const rows = await query
      .where(and(...conditions))
      .orderBy(desc(documents.updatedAt));

    const items: DocumentItem[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      title: r.title,
      sourceKind: coerceDocumentSourceKind(r.sourceKind),
      language: r.language,
      content: r.content,
      astJson: r.astJson ?? undefined,
      topic: r.topic ?? undefined,
      difficulty: r.difficulty ?? undefined,
      sourceUrl: r.sourceUrl ?? undefined,
      sourcePublisher: r.sourcePublisher ?? undefined,
      examTag: r.examTag ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return ok(items);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listDocuments',
        entityId: userId,
      })
    );
  }
}

export async function getDocumentById(
  deps: RepoDeps,
  id: string
): Promise<Result<DocumentItem | null, BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (rows.length === 0) {
      return ok(null);
    }

    const r = rows[0]!;
    return ok({
      id: r.id,
      userId: r.userId,
      title: r.title,
      sourceKind: coerceDocumentSourceKind(r.sourceKind),
      language: r.language,
      content: r.content,
      astJson: r.astJson ?? undefined,
      topic: r.topic ?? undefined,
      difficulty: r.difficulty ?? undefined,
      sourceUrl: r.sourceUrl ?? undefined,
      sourcePublisher: r.sourcePublisher ?? undefined,
      examTag: r.examTag ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getDocumentById',
        entityId: id,
      })
    );
  }
}

export async function deleteDocument(
  deps: RepoDeps,
  id: string,
  userId: string
): Promise<Result<void, BusinessError>> {
  // 删除生命周期（见 docs/database-architecture.md §8）：
  // - 随删（同事务）：annotations + shred 六表 + textbook_fts + document_structure + reading_positions；
  // - 保留（审计/历史）：document_imports、作答事件、草稿（含 source_ref 出处文本）、相遇审计；
  // - 单事务：中途失败整体回滚，不留半删除。
  try {
    // 先验归属：shred 行表无 user_id 列，id 归属必须在清行前确认，否则可跨用户清别人的行。
    const got = await getDocumentById(deps, id);
    if (!isOk(got)) return err(got.error);
    if (!got.value || got.value.userId !== userId) {
      return err(new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE'));
    }
    deps.db.transaction((tx) => {
      tx.delete(annotations)
        .where(and(eq(annotations.documentId, id), eq(annotations.userId, userId)))
        .run();
      tx.delete(textbookTermMap).where(eq(textbookTermMap.documentId, id)).run();
      tx.delete(textbookVocab).where(eq(textbookVocab.documentId, id)).run();
      tx.delete(textbookGrammar).where(eq(textbookGrammar.documentId, id)).run();
      tx.delete(textbookLines).where(eq(textbookLines.documentId, id)).run();
      tx.delete(textbookExercises).where(eq(textbookExercises.documentId, id)).run();
      tx.delete(textbookLessons).where(eq(textbookLessons.documentId, id)).run();
      tx.run(sql`DELETE FROM textbook_fts WHERE document_id = ${id}`);
      tx.delete(documentStructures).where(eq(documentStructures.documentId, id)).run();
      tx.delete(readingPositions).where(eq(readingPositions.documentId, id)).run();
      tx.delete(documents)
        .where(and(eq(documents.id, id), eq(documents.userId, userId)))
        .run();
    });
    return ok(undefined);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'deleteDocument',
        entityId: id,
      })
    );
  }
}

export async function saveAnnotation(
  deps: RepoDeps,
  ann: AnnotationItem
): Promise<Result<AnnotationItem, BusinessError>> {
  try {
    await deps.db.insert(annotations).values({
      id: ann.id,
      documentId: ann.documentId,
      userId: ann.userId,
      kind: ann.kind,
      quote: ann.quote,
      note: ann.note ?? null,
      startOffset: ann.startOffset,
      endOffset: ann.endOffset,
      pageNumber: ann.pageNumber ?? null,
      createdBy: ann.createdBy,
      flashcardId: ann.flashcardId ?? null,
      createdAt: ann.createdAt || nowIso(),
    });

    return ok(ann);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveAnnotation',
        entityId: ann.id,
      })
    );
  }
}

export async function listAnnotations(
  deps: RepoDeps,
  documentId: string,
  userId: string
): Promise<Result<AnnotationItem[], BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(annotations)
      .where(and(eq(annotations.documentId, documentId), eq(annotations.userId, userId)))
      .orderBy(desc(annotations.createdAt));

    const items: AnnotationItem[] = rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      userId: r.userId,
      kind: coerceAnnotationKind(r.kind),
      quote: r.quote,
      note: r.note ?? undefined,
      startOffset: r.startOffset,
      endOffset: r.endOffset,
      pageNumber: r.pageNumber ?? undefined,
      createdBy: coerceCreatedBy(r.createdBy),
      flashcardId: r.flashcardId ?? undefined,
      createdAt: r.createdAt,
    }));

    return ok(items);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listAnnotations',
        entityId: documentId,
      })
    );
  }
}

export async function deleteAnnotation(
  deps: RepoDeps,
  annotationId: string,
  userId: string
): Promise<Result<void, BusinessError>> {
  try {
    await deps.db
      .delete(annotations)
      .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId)));
    return ok(undefined);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'deleteAnnotation',
        entityId: annotationId,
      })
    );
  }
}

export async function convertAnnotationToCard(
  deps: RepoDeps,
  annotationId: string,
  userId: string,
  cardData: {
    front: string;
    back: string;
    tag?: string | undefined;
    pos?: string | undefined;
    phonetic?: string | undefined;
  }
): Promise<Result<Flashcard, BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(annotations)
      .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId)))
      .limit(1);

    if (rows.length === 0) {
      return err(new BusinessError('E_NOT_FOUND', '未找到对应的批注记录', 'DATABASE'));
    }

    const ann = rows[0]!;
    const cardId = generateId('card_ann');
    const now = nowIso();

    const newCard: Flashcard = {
      id: cardId,
      userId,
      type: 'VOCABULARY',
      front: cardData.front,
      back: cardData.back,
      phonetic: cardData.phonetic || undefined,
      audioUrl: undefined,
      tags: [cardData.tag || '课文批注', cardData.pos || '重点词句'],
      // 划词摘录=用户亲手组装卡面，天然讲透
      studiedAt: now,
      fsrs: {
        stability: 1.0,
        difficulty: 5.0,
        reps: 0,
        lapses: 0,
        dueAt: now,
        state: 'NEW',
      },
    };

    // 1. 插入 flashcards（跨域：走外观 saveCard）
    await deps.repo.saveCard(newCard);

    // 2. 回填批注关联卡片 ID
    await deps.db
      .update(annotations)
      .set({ flashcardId: cardId })
      .where(eq(annotations.id, annotationId));

    // 3. 相遇词强信号（等同收藏）：仅短 quote（≤12 字，词状才记，整句不污染信号），
    //    语种取批注所属文档（documents.language），非法值由 recordTermExposure 白名单拒绝。
    //    失败只 warn，永不挡建卡主路径。
    const quoteHead = (ann.quote ?? '').trim().slice(0, 64);
    if (quoteHead && [...quoteHead].length <= 12) {
      const docRows = await deps.db
        .select({ language: documents.language })
        .from(documents)
        .where(eq(documents.id, ann.documentId))
        .limit(1);
      const docLanguage = docRows[0]?.language;
      const exposure = await recordTermExposure(deps, {
        userId,
        language: typeof docLanguage === 'string' ? docLanguage : '',
        headword: quoteHead,
        source: 'collect',
        markCollected: true,
        flashcardId: cardId,
      });
      if (!isOk(exposure)) {
        logger.warn('[annotations] to-card exposure hook failed', {
          code: exposure.error.code,
          annotationId,
        });
      }
    }

    return ok(newCard);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'convertAnnotationToCard',
        entityId: annotationId,
      })
    );
  }
}
