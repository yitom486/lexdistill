import { eq, and, or, desc, inArray } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
  isOk,
  generateId,
} from '@study-studio/shared';
import type { QuizAttemptRecord } from '@study-studio/learner-core';
import { GeneratedQuestionSchema } from '@study-studio/protocol';
import { quizAttempts, quizQuestions } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import {
  normalizeTrackLanguage,
  inferLanguageFromSkillId,
} from '@study-studio/shared';
import { resolveActiveLanguage } from '../../learning-progress/public.js';

/**
 * 练习域持久化：题库读写与作答记录（G4：由 repository/domains/cards-questions.ts 拆分而来，行为不变）。
 */

/**
 * quiz_questions 可持久化形态：协议 GeneratedQuestion 与历史兼容字段的宽松并集。
 * 写入侧对缺失/漂移字段做中性回填（读侧永不抛）；id 缺失时自动生成（此前直接落库报错）。
 */
export type PersistableQuestion = {
  id?: string;
  userId?: unknown;
  type?: unknown;
  category?: unknown;
  prompt?: unknown;
  content?: unknown;
  options?: unknown;
  chunks?: unknown;
  correctAnswer?: unknown;
  explanation?: unknown;
  testedSkill?: unknown;
  testedSkillId?: unknown;
  difficulty?: unknown;
  language?: unknown;
  createdAt?: unknown;
  dictation?: unknown;
  reading?: unknown;
  acceptableVariants?: unknown;
};

/** 未知输入收敛为写入字符串（非字符串一律回退，保证列类型稳定）。 */
function asStoreString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
/**
 * P6-2：题型语料提取（仅 dictation 子结构；reading 正文不入库）。
 * 结构损坏一律返回 undefined（不臆造语料）。
 */
function extractDictationExtras(question: PersistableQuestion): Record<string, unknown> | undefined {
  const d = question?.dictation;
  if (!d || typeof d !== 'object') return undefined;
  if (typeof (d as { fullJapanese?: unknown }).fullJapanese !== 'string') return undefined;
  const out: Record<string, unknown> = {
    fullJapanese: (d as { fullJapanese: string }).fullJapanese,
  };
  for (const key of ['speaker', 'chinese', 'furiganaHint'] as const) {
    const value = (d as Record<string, unknown>)[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** P6-2：读回语料（损坏/缺失返回 undefined）。 */
function parseDictationExtras(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const dictation = (parsed as { dictation?: unknown }).dictation;
    return extractDictationExtras({ dictation });
  } catch {
    return undefined;
  }
}

function extractReadingExtras(value: unknown) {
  const parsed = GeneratedQuestionSchema.shape.reading.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseQuestionExtras(raw: string | null) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const value = parsed as Record<string, unknown>;
    const reading = extractReadingExtras(value.reading);
    const result = GeneratedQuestionSchema.shape.acceptableVariants.safeParse(value.acceptableVariants);
    const variants = result.success ? result.data : undefined;
    return { ...(reading ? { reading } : {}), ...(variants ? { acceptableVariants: variants } : {}) };
  } catch { return {}; }
}

/**
 * 获取题库题目列表 (从 SQLite quiz_questions 表读取)
 */
export async function getQuestions(
  deps: RepoDeps,
  userId: string,
  limit: number = 50,
  langOverride?: string,
  filter?: {
    types?: string[] | undefined;
    difficulty?: number | undefined;
    skillIds?: string[] | undefined;
  }
): Promise<Result<PersistableQuestion[], BusinessError>> {
  try {
    const language = langOverride
      ? normalizeTrackLanguage(langOverride)
      : await resolveActiveLanguage(deps, userId);
    const conds = [
      or(eq(quizQuestions.userId, userId), eq(quizQuestions.userId, 'default_user')),
      eq(quizQuestions.language, language),
    ];
    // P5-E4：装配按块选题——题型 / 难度 / 技能过滤
    if (filter?.types && filter.types.length > 0) {
      conds.push(inArray(quizQuestions.type, filter.types));
    }
    if (typeof filter?.difficulty === 'number') {
      conds.push(eq(quizQuestions.difficulty, filter.difficulty));
    }
    if (filter?.skillIds && filter.skillIds.length > 0) {
      conds.push(inArray(quizQuestions.testedSkillId, filter.skillIds));
    }
    let rows = await deps.db
      .select()
      .from(quizQuestions)
      .where(and(...conds))
      .orderBy(desc(quizQuestions.createdAt))
      .limit(limit);

    let mapped = rows.map((r) => {
      // P6-2：语料回填（无/损坏则省略该字段）
      const dictation = parseDictationExtras((r as { extrasJson?: unknown }).extrasJson);
      return {
        id: r.id,
        userId: r.userId,
        type: r.type,
        category: r.category,
        prompt: r.prompt,
        content: r.content,
        options: r.options ? JSON.parse(r.options) : undefined,
        chunks: r.chunks ? JSON.parse(r.chunks) : undefined,
        correctAnswer: r.correctAnswer,
        explanation: r.explanation,
        testedSkill: r.testedSkillId,
        testedSkillId: r.testedSkillId,
        difficulty: r.difficulty,
        createdAt: r.createdAt,
        ...(dictation ? { dictation } : {}),
        ...parseQuestionExtras(r.extrasJson),
      };
    });

    // 防串语：历史上曾把 EN 题误写入 ko 分区；按 skillId 前缀再过滤一次
    mapped = mapped.filter((q) => {
      const skill = String(q.testedSkillId || q.testedSkill || '');
      if (!skill) return true;
      return inferLanguageFromSkillId(skill) === language;
    });

    return ok(mapped);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getQuestions',
        entityId: userId,
      })
    );
  }
}

/**
 * 保存或更新单道题目至 SQLite quiz_questions
 */
export async function saveQuestion(
  deps: RepoDeps,
  question: PersistableQuestion
): Promise<Result<void, BusinessError>> {
  const id = typeof question.id === 'string' ? question.id : generateId('q');
  try {
    const skillId = asStoreString(question.testedSkill) || asStoreString(question.testedSkillId);
    const ownerId = asStoreString(question.userId) || 'default_user';
    const language = normalizeTrackLanguage(
      (typeof question.language === 'string' ? question.language : undefined) ??
        (await resolveActiveLanguage(deps, ownerId))
    );
    const existing = await deps.db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.id, id))
      .limit(1);

    const optionsStr = question.options
      ? typeof question.options === 'string'
        ? question.options
        : JSON.stringify(question.options)
      : null;
    const chunksStr = question.chunks
      ? typeof question.chunks === 'string'
        ? question.chunks
        : JSON.stringify(question.chunks)
      : null;
    // The question keeps its passage and answer variants when reloaded from the pool.
    const dictationExtras = extractDictationExtras(question);
    const reading = extractReadingExtras(question.reading);
    const acceptableVariants = GeneratedQuestionSchema.shape.acceptableVariants.safeParse(question.acceptableVariants).data;
    const extras = { ...(dictationExtras ? { dictation: dictationExtras } : {}), ...(reading ? { reading } : {}), ...(acceptableVariants ? { acceptableVariants } : {}) };
    const extrasStr = Object.keys(extras).length ? JSON.stringify(extras) : null;

    const row = {
      language,
      type: asStoreString(question.type),
      category: asStoreString(question.category),
      prompt: asStoreString(question.prompt),
      content: asStoreString(question.content),
      options: optionsStr,
      chunks: chunksStr,
      correctAnswer: asStoreString(question.correctAnswer),
      explanation: asStoreString(question.explanation),
      testedSkillId: skillId,
      difficulty: typeof question.difficulty === 'number' ? question.difficulty : 3,
      extrasJson: extrasStr,
    };

    if (existing.length > 0) {
      await deps.db
        .update(quizQuestions)
        .set(row)
        .where(eq(quizQuestions.id, id));
    } else {
      await deps.db.insert(quizQuestions).values({
        id,
        userId: ownerId,
        ...row,
        createdAt: asStoreString(question.createdAt) || nowIso(),
      });
    }

    return ok(undefined);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveQuestion',
        entityId: id,
      })
    );
  }
}

/**
 * 批量保存题目至 SQLite
 */
export async function saveQuestions(
  deps: RepoDeps,
  questions: PersistableQuestion[]
): Promise<Result<void, BusinessError>> {
  for (const q of questions) {
    const res = await saveQuestion(deps, q);
    if (!isOk(res)) return res;
  }
  return ok(undefined);
}
export async function recordQuizAttempt(
  deps: RepoDeps,
  attempt: QuizAttemptRecord
): Promise<Result<void, BusinessError>> {
  try {
    await deps.db.insert(quizAttempts).values({
      id: attempt.id,
      ...(attempt.sourceAttemptId ? { sourceAttemptId: attempt.sourceAttemptId } : {}),
      userId: attempt.userId,
      language: inferLanguageFromSkillId(attempt.testedSkillId),
      questionId: attempt.questionId,
      userAnswer: attempt.userAnswer,
      isCorrect: attempt.isCorrect,
      score: attempt.score,
      timeSpentMs: attempt.timeSpentMs,
      testedSkillId: attempt.testedSkillId,
      createdAt: attempt.createdAt,
    });

    // 自动累计每日做题任务足迹
    const activity = await deps.repo.recordDailyActivity(attempt.userId, {
      quizzes: 1, language: inferLanguageFromSkillId(attempt.testedSkillId),
    });
    if (!isOk(activity)) return err(activity.error);

    return ok(undefined);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'recordQuizAttempt',
        entityId: attempt.id,
      })
    );
  }
}
