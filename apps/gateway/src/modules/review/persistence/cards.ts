import { eq, and } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import { CardTypeSchema, type CardType, type Flashcard } from '@study-studio/protocol';
import {
  flashcards,
  INITIAL_CARD_SEEDS,
  INITIAL_EN_CARD_SEEDS,
} from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { normalizeTrackLanguage } from '@study-studio/shared';
import { resolveActiveLanguage } from '../../learning-progress/public.js';

/**
 * 复习域持久化：FSRS 闪卡存取（G4：由 repository/domains/cards-questions.ts 拆分而来，行为不变）。
 */
/**
 * 卡片/题库域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域互调直接调模块函数。
 */

/** DB TEXT 列 → CardType；损坏值回退 VOCABULARY（读侧永不抛，种子/正常写入不受影响）。 */
function coerceCardType(value: unknown): CardType {
  const parsed = CardTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'VOCABULARY';
}

/** Flashcard 领域类型无 language 列；兼容历史写入中可能携带的 language 透传字段。 */
function storedCardLanguage(card: Flashcard): string | undefined {
  const language = (card as { language?: unknown }).language;
  return typeof language === 'string' ? language : undefined;
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
        if (c.exampleJp) tags.push(c.exampleJp);
        if (c.exampleZh) tags.push(c.exampleZh);

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
          fsrs: JSON.stringify(fsrsObj),
        });
      }
      rows = await deps.db
        .select()
        .from(flashcards)
        .where(and(eq(flashcards.userId, userId), eq(flashcards.language, language)))
        .limit(limit);
    }

    const cards: Flashcard[] = rows.map((r) => {
      const card: Flashcard = {
        id: r.id,
        userId: r.userId,
        type: coerceCardType(r.type),
        front: r.front,
        back: r.back,
        phonetic: r.phonetic ?? undefined,
        audioUrl: r.audioUrl ?? undefined,
        tags: JSON.parse(r.tags),
        fsrs: JSON.parse(r.fsrs),
      };
      if (r.studiedAt) card.studiedAt = r.studiedAt;
      if (r.sourceEntryId) card.sourceEntryId = r.sourceEntryId;
      return card;
    });

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

    if (existing.length > 0) {
      await deps.db
        .update(flashcards)
        .set({
          language: normalizeTrackLanguage(
            storedCardLanguage(card) ?? (await resolveActiveLanguage(deps, card.userId))
          ),
          type: card.type,
          front: card.front,
          back: card.back,
          phonetic: card.phonetic ?? null,
          audioUrl: card.audioUrl ?? null,
          tags: JSON.stringify(card.tags),
          fsrs: JSON.stringify(card.fsrs),
          // 讲透只升不降：saveCard 透传已有值，不主动清零（清零无入口）。
          ...(card.studiedAt ? { studiedAt: card.studiedAt } : {}),
        })
        .where(eq(flashcards.id, card.id));
    } else {
      const language = normalizeTrackLanguage(
        storedCardLanguage(card) ?? (await resolveActiveLanguage(deps, card.userId))
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
