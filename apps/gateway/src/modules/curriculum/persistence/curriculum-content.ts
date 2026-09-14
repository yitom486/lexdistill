import { eq, and, asc, desc, or, inArray } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import {
  selectAdaptiveKanaIds,
  type AdaptiveKanaQueueOptions,
} from '@study-studio/learner-core';
import type { KanaItem, ReadingPassageSet, KanaLearningGuide } from '@study-studio/protocol';
import { KanaLearningGuideSchema, KanaTypeSchema, type KanaType } from '@study-studio/protocol';
import type { HangulItem } from '@study-studio/protocol';
import { HangulTypeSchema, type HangulType } from '@study-studio/protocol';
import {
  curriculumKana,
  curriculumHangul,
  learningContentTemplates,
  documents,
} from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { readKanaPracticeMemories } from '@study-studio/storage-sqlite';
import { normalizeTrackLanguage } from '@study-studio/shared';

/**
 * 课程域持久化：假名底座、内容模板、阅读篇目读写（G4：由 repository/domains/curriculum-reading.ts
 * 拆分而来；成绩回写类调用归 learning-progress，行为不变）。
 */
/**
 * 课程/阅读域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域互调直接调模块函数。
 */

/**
 * 获取五十音课程底座数据，支持按类型过滤
 */

/** DB TEXT 列 → KanaType；损坏值回退 SEION（读侧永不抛，种子/正常写入不受影响）。 */
function coerceKanaType(value: unknown): KanaType {
  const parsed = KanaTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'SEION';
}

/**
 * DB JSON 列 → 结构化小讲义；课程资产损坏时只丢弃该字段，不影响假名表读取。
 */
function parseKanaLearningGuide(value: unknown): KanaLearningGuide | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    const parsed = KanaLearningGuideSchema.safeParse(JSON.parse(value) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function mapKanaRow(row: typeof curriculumKana.$inferSelect): KanaItem {
  const learningGuide = parseKanaLearningGuide(row.learningGuideJson);
  return {
    id: row.id,
    type: coerceKanaType(row.type),
    hiragana: row.hiragana,
    katakana: row.katakana,
    romaji: row.romaji,
    row: row.row,
    col: row.col,
    ...(row.mnemonic ? { mnemonic: row.mnemonic } : {}),
    ...(learningGuide ? { learningGuide } : {}),
    audioText: row.audioText,
    sortOrder: row.sortOrder,
  };
}

export async function getCurriculumKana(
  deps: RepoDeps,
  type?: string
): Promise<Result<KanaItem[], BusinessError>> {
  try {
    let rows;
    if (type) {
      rows = await deps.db
        .select()
        .from(curriculumKana)
        .where(eq(curriculumKana.type, type))
        .orderBy(asc(curriculumKana.sortOrder));
    } else {
      rows = await deps.db
        .select()
        .from(curriculumKana)
        .orderBy(asc(curriculumKana.sortOrder));
    }

    const items: KanaItem[] = rows.map(mapKanaRow);

    return ok(items);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getCurriculumKana',
        entityId: type ?? 'ALL',
      })
    );
  }
}

/** 按用户逐项 FSRS 状态组建短题队列，课程内容本身仍是公共只读资产。 */
export async function getAdaptiveKanaQueue(
  deps: RepoDeps,
  userId: string,
  options?: AdaptiveKanaQueueOptions
): Promise<Result<KanaItem[], BusinessError>> {
  try {
    const types = options?.types;
    const rows =
      types && types.length > 0
        ? await deps.db
            .select()
            .from(curriculumKana)
            .where(inArray(curriculumKana.type, [...types]))
            .orderBy(asc(curriculumKana.sortOrder))
        : await deps.db.select().from(curriculumKana).orderBy(asc(curriculumKana.sortOrder));
    const scriptType = options?.scriptType ?? 'HIRAGANA';
    const memories = await readKanaPracticeMemories(deps.db, userId, scriptType);
    const ids = selectAdaptiveKanaIds(
      rows.map((row) => {
        const memory = memories.get(row.id);
        return {
          id: row.id,
          sortOrder: row.sortOrder,
          ...(memory ? { memory } : {}),
        };
      }),
      options?.limit
    );
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    return ok(
      ids.flatMap((id) => {
        const row = rowsById.get(id);
        return row ? [mapKanaRow(row)] : [];
      })
    );
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getAdaptiveKanaQueue',
        entityId: userId,
      })
    );
  }
}

/** DB TEXT 列 → HangulType；损坏值回退 CONSONANT（读侧永不抛，种子/正常写入不受影响）。 */
function coerceHangulType(value: unknown): HangulType {
  const parsed = HangulTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'CONSONANT';
}

/**
 * 获取谚文字母课程底座数据，支持按类型过滤
 */
export async function getCurriculumHangul(
  deps: RepoDeps,
  type?: string
): Promise<Result<HangulItem[], BusinessError>> {
  try {
    let rows;
    if (type) {
      rows = await deps.db
        .select()
        .from(curriculumHangul)
        .where(eq(curriculumHangul.type, type))
        .orderBy(asc(curriculumHangul.sortOrder));
    } else {
      rows = await deps.db
        .select()
        .from(curriculumHangul)
        .orderBy(asc(curriculumHangul.sortOrder));
    }

    const items: HangulItem[] = rows.map((r) => ({
      id: r.id,
      type: coerceHangulType(r.type),
      jamo: r.jamo,
      name: r.name,
      romanization: r.romanization,
      row: r.row,
      col: r.col,
      mnemonic: r.mnemonic ?? undefined,
      audioText: r.audioText,
      sortOrder: r.sortOrder,
    }));

    return ok(items);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getCurriculumHangul',
        entityId: type ?? 'ALL',
      })
    );
  }
}

/**
 * 读取 learning.content 内容模板（按 action / language / skill / format 过滤）
 */
export async function listContentTemplates(
  deps: RepoDeps,
  options: {
    action: string;
    language: string;
    skillId?: string | undefined;
    format?: string | undefined;
    genre?: string | undefined;
    limit?: number | undefined;
  }
): Promise<
  Result<
    Array<{
      id: string;
      language: string;
      action: string;
      format: string | null;
      skillId: string | null;
      difficulty: number;
      topic: string | null;
      genre: string | null;
      sortOrder: number;
      payload: Record<string, unknown>;
    }>,
    BusinessError
  >
> {
  try {
    const language = normalizeTrackLanguage(options.language);
    let rows = await deps.db
      .select()
      .from(learningContentTemplates)
      .where(
        and(
          eq(learningContentTemplates.action, options.action),
          eq(learningContentTemplates.language, language)
        )
      )
      .orderBy(asc(learningContentTemplates.sortOrder));

    if (options.format) {
      rows = rows.filter((r) => r.format === options.format);
    }
    if (options.genre) {
      const byGenre = rows.filter((r) => r.genre === options.genre);
      if (byGenre.length > 0) rows = byGenre;
    }
    if (options.skillId) {
      const bySkill = rows.filter((r) => r.skillId === options.skillId);
      if (bySkill.length > 0) {
        rows = bySkill;
      } else if (options.skillId.includes('particle')) {
        const particleRows = rows.filter((r) => r.skillId?.includes('particle'));
        if (particleRows.length > 0) rows = particleRows;
      }
    }

    const mapped = rows.map((r) => ({
      id: r.id,
      language: r.language,
      action: r.action,
      format: r.format,
      skillId: r.skillId,
      difficulty: r.difficulty,
      topic: r.topic,
      genre: r.genre,
      sortOrder: r.sortOrder,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
    }));

    return ok(options.limit ? mapped.slice(0, options.limit) : mapped);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listContentTemplates',
        entityId: options.action,
      })
    );
  }
}
/**
 * 检索阅读理解篇目套题列表 (AI 分级篇目 / 真实新闻)
 */
export async function listReadingSets(
  deps: RepoDeps,
  userId: string,
  origin?: 'ai' | 'news' | 'user_import',
  language?: 'JA' | 'EN' | 'KO'
): Promise<Result<ReadingPassageSet[], BusinessError>> {
  try {
    const userCondition = or(
      eq(documents.userId, userId),
      eq(documents.userId, 'default_user'),
      eq(documents.userId, 'system')
    );

    const rows = await deps.db
      .select()
      .from(documents)
      .where(
        and(
          userCondition,
          inArray(documents.sourceKind, ['ai_generated', 'news', 'user_import'])
        )
      )
      .orderBy(desc(documents.createdAt));

    const sets: ReadingPassageSet[] = rows
      .map((row) => {
        let questions = [];
        if (row.astJson) {
          try {
            const parsed = JSON.parse(row.astJson);
            questions = parsed.questions || [];
          } catch {
            questions = [];
          }
        }
        const itemOrigin =
          row.sourceKind === 'news'
            ? ('news' as const)
            : row.sourceKind === 'ai_generated'
            ? ('ai' as const)
            : ('user_import' as const);

        const upper = row.language.toUpperCase();
        const itemLang =
          upper === 'EN' ? ('EN' as const) : upper === 'KO' ? ('KO' as const) : ('JA' as const);

        return {
          id: row.id,
          origin: itemOrigin,
          title: row.title,
          topic: row.topic || '综合',
          difficulty: (row.difficulty ?? 2) as 1 | 2 | 3 | 4 | 5,
          language: itemLang,
          sourceLabel:
            row.sourcePublisher ||
            (itemOrigin === 'news' ? '合规精选新闻' : 'AI 精选篇目'),
          sourceUrl: row.sourceUrl ?? undefined,
          body: row.content,
          questions,
          createdAt: row.createdAt,
          // P3-B 回填结构化来源元数据
          sourceKind:
            (row.sourceKindDetail as ReadingPassageSet['sourceKind']) ??
            (itemOrigin === 'ai' ? 'ai' : itemOrigin === 'user_import' ? 'user_import' : undefined),
          ...(row.fetchStatus
            ? { fetchStatus: row.fetchStatus as ReadingPassageSet['fetchStatus'] }
            : {}),
          ...(row.newsPublisher ? { publisher: row.newsPublisher } : {}),
        };
      })
      .filter((set) => {
        if (origin && set.origin !== origin) return false;
        if (language && set.language !== language) return false;
        return true;
      });

    return ok(sets);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listReadingSets',
        entityId: userId,
      })
    );
  }
}

/**
 * 保存或更新阅读理解篇目套题
 */
export async function saveReadingSet(
  deps: RepoDeps,
  userId: string,
  set: ReadingPassageSet
): Promise<Result<ReadingPassageSet, BusinessError>> {
  try {
    const now = nowIso();
    const sourceKind =
      set.origin === 'news' ? 'news' : set.origin === 'ai' ? 'ai_generated' : 'user_import';

    const existing = await deps.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, set.id))
      .limit(1);

    if (existing.length > 0) {
      await deps.db
        .update(documents)
        .set({
          title: set.title,
          content: set.body,
          astJson: JSON.stringify({ questions: set.questions }),
          topic: set.topic,
          difficulty: set.difficulty,
          sourceUrl: set.sourceUrl ?? null,
          sourcePublisher: set.sourceLabel,
          sourceKindDetail: set.sourceKind ?? null,
          fetchStatus: set.fetchStatus ?? null,
          newsPublisher: set.publisher ?? null,
          updatedAt: now,
        })
        .where(eq(documents.id, set.id));
    } else {
      await deps.db.insert(documents).values({
        id: set.id,
        userId,
        title: set.title,
        sourceKind,
        language: set.language.toLowerCase(),
        content: set.body,
        astJson: JSON.stringify({ questions: set.questions }),
        topic: set.topic,
        difficulty: set.difficulty,
        sourceUrl: set.sourceUrl ?? null,
        sourcePublisher: set.sourceLabel,
        sourceKindDetail: set.sourceKind ?? null,
        fetchStatus: set.fetchStatus ?? null,
        newsPublisher: set.publisher ?? null,
        createdAt: set.createdAt || now,
        updatedAt: now,
      });
    }

    return ok(set);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveReadingSet',
        entityId: set.id,
      })
    );
  }
}
