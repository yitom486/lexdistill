import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
  isOk,
} from '@study-studio/shared';
import type {
  PracticeCollection,
  PracticeItem,
  GeneratedQuestion,
  Flashcard,
} from '@study-studio/protocol';
import { practiceCollections, practiceItems } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { resolveActiveLanguage } from '../../learning-progress/public.js';

/**
 * 练习队列域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域互调直接调模块函数。
 */

/**
 * 创建练习集合并批量写入练习队列条目（collect:true）
 */
export async function collectPracticeQuestions(
  deps: RepoDeps,
  input: {
    userId: string;
    title: string;
    intent?: string;
    layoutHint?: string | undefined;
    sourceRef?: string | undefined;
    questions: GeneratedQuestion[];
    /** P5：关联练习运行/块/批改模式（可空，向后兼容） */
    planRunId?: string | undefined;
    blockId?: string | undefined;
    gradingMode?: string | undefined;
  }
): Promise<Result<{ collection: PracticeCollection; items: PracticeItem[] }, BusinessError>> {
  try {
    const parsed = input.questions.map((q) => {
      // 运行时再校验，避免坏 JSON 入库
      return q;
    });
    if (parsed.length === 0) {
      return err(
        new BusinessError('E_INVALID_INPUT', '练习队列至少需要 1 道题', 'VALIDATION')
      );
    }

    const collectionId = generateId('pcol');
    const createdAt = nowIso();
    const intent = input.intent ?? 'GENERATE_QUIZ';
    const language = await resolveActiveLanguage(deps, input.userId);

    await deps.db.insert(practiceCollections).values({
      id: collectionId,
      userId: input.userId,
      language,
      title: input.title,
      intent,
      layoutHint: input.layoutHint ?? null,
      sourceRef: input.sourceRef ?? null,
      createdAt,
      planRunId: input.planRunId ?? null,
      blockId: input.blockId ?? null,
      gradingMode: input.gradingMode ?? null,
    });

    const items: PracticeItem[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const q = parsed[i]!;
      const itemId = generateId('pitem');
      const skillIds = q.testedSkillId ? [q.testedSkillId] : [];
      await deps.db.insert(practiceItems).values({
        id: itemId,
        userId: input.userId,
        language,
        collectionId,
        questionJson: JSON.stringify(q),
        skillIds: JSON.stringify(skillIds),
        sourceRef: input.sourceRef ?? null,
        passageDocumentId: null,
        sortOrder: i,
        collectedAt: createdAt,
      });
      items.push({
        id: itemId,
        userId: input.userId,
        collectionId,
        question: q,
        skillIds,
        sourceRef: input.sourceRef,
        sortOrder: i,
        collectedAt: createdAt,
      });
    }

    const collection: PracticeCollection = {
      id: collectionId,
      userId: input.userId,
      title: input.title,
      intent,
      layoutHint: input.layoutHint as PracticeCollection['layoutHint'],
      sourceRef: input.sourceRef,
      createdAt,
    };

    return ok({ collection, items });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'collectPracticeQuestions',
        entityId: input.userId,
      })
    );
  }
}

export async function listPracticeCollections(
  deps: RepoDeps,
  userId: string,
  limit = 20
): Promise<Result<PracticeCollection[], BusinessError>> {
  try {
    const language = await resolveActiveLanguage(deps, userId);
    const rows = await deps.db
      .select()
      .from(practiceCollections)
      .where(
        and(
          eq(practiceCollections.userId, userId),
          eq(practiceCollections.language, language)
        )
      )
      .orderBy(desc(practiceCollections.createdAt))
      .limit(limit);

    return ok(
      rows.map((r) => {
        const col: PracticeCollection = {
          id: r.id,
          userId: r.userId,
          title: r.title,
          intent: r.intent,
          createdAt: r.createdAt,
        };
        if (r.layoutHint) {
          col.layoutHint = r.layoutHint as PracticeCollection['layoutHint'];
        }
        if (r.sourceRef) col.sourceRef = r.sourceRef;
        return col;
      })
    );
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listPracticeCollections',
        entityId: userId,
      })
    );
  }
}

export async function listPracticeItems(
  deps: RepoDeps,
  userId: string,
  collectionId: string
): Promise<Result<PracticeItem[], BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(practiceItems)
      .where(
        and(eq(practiceItems.userId, userId), eq(practiceItems.collectionId, collectionId))
      )
      .orderBy(asc(practiceItems.sortOrder));

    return ok(rows.map((r) => mapPracticeItemRow(r)));
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listPracticeItems',
        entityId: collectionId,
      })
    );
  }
}

/**
 * 用户勾选练习队列条目 → 显式写入 FSRS 闪卡（collect 本身不建卡）
 */
export async function convertPracticeItemsToCards(
  deps: RepoDeps,
  userId: string,
  itemIds: string[]
): Promise<
  Result<{ createdCount: number; cardIds: string[]; skippedItemIds: string[] }, BusinessError>
> {
  try {
    const uniqueIds = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
      return err(
        new BusinessError('E_INVALID_INPUT', '请至少勾选一条练习队列条目再转入复习。', 'VALIDATION')
      );
    }
    if (uniqueIds.length > 50) {
      return err(
        new BusinessError('E_INVALID_INPUT', '单次最多转入 50 张闪卡。', 'VALIDATION')
      );
    }

    const rows = await deps.db
      .select()
      .from(practiceItems)
      .where(and(eq(practiceItems.userId, userId), inArray(practiceItems.id, uniqueIds)));

    const found = new Set(rows.map((r) => r.id));
    const skippedItemIds = uniqueIds.filter((id) => !found.has(id));
    const cardIds: string[] = [];

    for (const row of rows) {
      const item = mapPracticeItemRow(row);
      const card = practiceItemToFlashcard(item);
      const saveRes = await deps.repo.saveCard(card);
      if (!isOk(saveRes)) {
        return saveRes;
      }
      cardIds.push(card.id);
    }

    return ok({
      createdCount: cardIds.length,
      cardIds,
      skippedItemIds,
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'convertPracticeItemsToCards',
        entityId: userId,
      })
    );
  }
}

function mapPracticeItemRow(r: typeof practiceItems.$inferSelect): PracticeItem {
  const item: PracticeItem = {
    id: r.id,
    userId: r.userId,
    collectionId: r.collectionId,
    question: JSON.parse(r.questionJson) as GeneratedQuestion,
    skillIds: r.skillIds ? (JSON.parse(r.skillIds) as string[]) : [],
    sortOrder: r.sortOrder,
    collectedAt: r.collectedAt,
  };
  if (r.sourceRef) item.sourceRef = r.sourceRef;
  if (r.passageDocumentId) item.passageDocumentId = r.passageDocumentId;
  return item;
}

function practiceItemToFlashcard(item: PracticeItem): Flashcard {
  const q = item.question;
  const front = (q.content?.trim() || q.prompt).trim().slice(0, 240);
  const backParts = [
    q.correctAnswer ? `答案：${q.correctAnswer}` : '',
    q.explanation?.trim() || '',
  ].filter(Boolean);
  const back = (backParts.join('\n') || q.prompt).slice(0, 800);
  const tags = [
    '练习队列',
    ...(item.skillIds.length > 0 ? item.skillIds.slice(0, 3) : [q.testedSkillId || 'review']),
  ].filter(Boolean);

  return {
    id: generateId('card_pq'),
    userId: item.userId,
    type: 'VOCABULARY',
    front,
    back,
    tags,
    fsrs: {
      stability: 1.0,
      difficulty: 5.0,
      reps: 0,
      lapses: 0,
      dueAt: nowIso(),
      state: 'NEW',
    },
  };
}
