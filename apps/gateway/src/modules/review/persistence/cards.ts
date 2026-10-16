import { eq, and } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@lexdistill/shared';
import { type Flashcard } from '@lexdistill/protocol';
import {
  flashcards,
  globalVocabulary,
  flashcardFromRow,
  INITIAL_CARD_SEEDS,
  INITIAL_EN_CARD_SEEDS,
} from '@lexdistill/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { normalizeTrackLanguage } from '@lexdistill/shared';
import { resolveActiveLanguage } from '../../learning-progress/public.js';

/**
 * 复习域持久化：FSRS 闪卡存取（G4：由 repository/domains/cards-questions.ts 拆分而来，行为不变）。
 */
/**
 * 卡片/题库域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域互调直接调模块函数。
 */

/** 单卡按用户与 ID 读取，复习不受列表数量上限或当前语种影响。 */
export async function getFlashcard(deps: RepoDeps, userId: string, cardId: string): Promise<Result<Flashcard, BusinessError>> {
  try {
    const row = deps.db.select().from(flashcards).where(and(eq(flashcards.userId, userId), eq(flashcards.id, cardId))).get();
    return row ? ok(flashcardFromRow(row)) : err(new BusinessError('E_NOT_FOUND', '未找到待复习卡片，请刷新后重试。', 'LEARNER_STATE'));
  } catch (cause) { return err(translateToBusinessError(cause, { category: 'DATABASE', action: 'getFlashcard', entityId: cardId })); }
}

export async function getDueCards(
  deps: RepoDeps,
  userId: string,
  limit: number = 500,
  options?: { dueOnly?: boolean; language?: string }
): Promise<Result<Flashcard[], BusinessError>> {
  try {
    const now = nowIso();
    const language = options?.language
      ? normalizeTrackLanguage(options.language)
      : await resolveActiveLanguage(deps, userId);
    let rows = await deps.db
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.userId, userId), eq(flashcards.language, language)))
      .limit(limit);

    const demoUser = userId === 'student_web_01' || userId === 'default_user';
    if (rows.length === 0 && demoUser && (language === 'ja' || language === 'en')) {
      const seeds = language === 'en' ? INITIAL_EN_CARD_SEEDS : INITIAL_CARD_SEEDS;
      for (const c of seeds) {
        const fsrsObj = {
          stability: c.stability,
          difficulty: 5.0,
          reps: c.reps,
          lapses: 0,
          dueAt: nowIso(),
          state: c.reps > 0 ? 'REVIEW' : 'NEW',
        };
        const tags = [...c.tags];

        await deps.db.insert(flashcards).values({
          id: c.id,
          userId,
          language,
          type: c.type,
          front: c.front,
          back: c.back,
          phonetic: c.phonetic ?? null,
          audioUrl: c.audioUrl ?? null,
          tags: JSON.stringify(tags),
          partOfSpeech: c.tags[1] ?? null,
          examplesJson: JSON.stringify(c.exampleJp ? [{ text: c.exampleJp, ...(c.exampleZh ? { translation: c.exampleZh } : {}) }] : []),
          fsrs: JSON.stringify(fsrsObj),
        });
      }
      rows = await deps.db
        .select()
        .from(flashcards)
        .where(and(eq(flashcards.userId, userId), eq(flashcards.language, language)))
        .limit(limit);
    }

    const cards: Flashcard[] = rows.map(flashcardFromRow);

    // 如果显式要求仅待复习，则过滤到期卡片；否则返回全量卡片（优先展示待复习）
    if (options?.dueOnly) {
      return ok(cards.filter((c) => !c.fsrs.dueAt || c.fsrs.dueAt <= now));
    }

    cards.sort((a, b) => {
      const aDue = !a.fsrs.dueAt || a.fsrs.dueAt <= now;
      const bDue = !b.fsrs.dueAt || b.fsrs.dueAt <= now;
      if (aDue && !bDue) return -1;
      if (!aDue && bDue) return 1;
      return a.id.localeCompare(b.id);
    });

    return ok(cards);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getDueCards',
        entityId: userId,
      })
    );
  }
}
export async function saveCard(
  deps: RepoDeps,
  card: Flashcard
): Promise<Result<void, BusinessError>> {
  try {
    const existing = await deps.db
      .select()
      .from(flashcards)
      .where(eq(flashcards.id, card.id))
      .limit(1);

    if (existing[0] && existing[0].userId !== card.userId) return err(new BusinessError('E_NOT_FOUND', '未找到当前用户的卡片', 'VALIDATION'));
    const vocabularyId = card.vocabularyId ?? existing[0]?.vocabularyId;
    if (vocabularyId) {
      const word = deps.db.select().from(globalVocabulary).where(and(eq(globalVocabulary.id, vocabularyId), eq(globalVocabulary.userId, card.userId))).get();
      if (!word || card.type !== 'VOCABULARY' || (card.language && card.language !== word.language))
        return err(new BusinessError('E_VOCABULARY_SCOPE_INVALID', '卡片与词汇的归属不一致', 'VALIDATION'));
    }

    if (existing.length > 0) {
      await deps.db
        .update(flashcards)
        .set({
          language: normalizeTrackLanguage(
            card.language ?? existing[0]!.language
          ),
          type: card.type,
          front: card.front,
          back: card.back,
          phonetic: card.phonetic ?? null,
          audioUrl: card.audioUrl ?? null,
          tags: JSON.stringify(card.tags),
          ...(card.sourceEntryId ? { sourceEntryId: card.sourceEntryId } : {}),
          ...(card.vocabularyId ? { vocabularyId: card.vocabularyId } : {}),
          ...(card.partOfSpeech !== undefined ? { partOfSpeech: card.partOfSpeech } : {}),
          ...(card.examples !== undefined ? { examplesJson: JSON.stringify(card.examples) } : {}),
          fsrs: JSON.stringify(card.fsrs),
          // 讲透只升不降：saveCard 透传已有值，不主动清零（清零无入口）。
          ...(card.studiedAt ? { studiedAt: card.studiedAt } : {}),
        })
        .where(eq(flashcards.id, card.id));
    } else {
      const language = normalizeTrackLanguage(
        card.language ?? (await resolveActiveLanguage(deps, card.userId))
      );
      await deps.db.insert(flashcards).values({
        id: card.id,
        userId: card.userId,
        language,
        type: card.type,
        front: card.front,
        back: card.back,
        phonetic: card.phonetic ?? null,
        audioUrl: card.audioUrl ?? null,
        sourceEntryId: card.sourceEntryId ?? null,
        vocabularyId: card.vocabularyId ?? null,
        partOfSpeech: card.partOfSpeech ?? null,
        examplesJson: JSON.stringify(card.examples ?? []),
        tags: JSON.stringify(card.tags),
        fsrs: JSON.stringify(card.fsrs),
        studiedAt: card.studiedAt ?? null,
      });
    }

    return ok(undefined);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveCard',
        entityId: card.id,
      })
    );
  }
}

/**
 * 标记讲透（M2 学习门；幂等：已标记直接成功）。
 * 卡不存在或非本人返回 E_NOT_FOUND（不透露他人卡片存在性，统一口径）。
 */
export async function markCardStudied(
  deps: RepoDeps,
  userId: string,
  cardId: string
): Promise<Result<{ cardId: string; studiedAt: string }, BusinessError>> {
  try {
    const rows = await deps.db
      .select({ id: flashcards.id })
      .from(flashcards)
      .where(and(eq(flashcards.id, cardId), eq(flashcards.userId, userId)))
      .limit(1);
    if (rows.length === 0) {
      return err(new BusinessError('E_NOT_FOUND', '卡片不存在', 'LEARNER_STATE'));
    }
    const now = nowIso();
    await deps.db
      .update(flashcards)
      .set({ studiedAt: now })
      .where(eq(flashcards.id, cardId));
    return ok({ cardId, studiedAt: now });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'markCardStudied',
        entityId: cardId,
      })
    );
  }
}
