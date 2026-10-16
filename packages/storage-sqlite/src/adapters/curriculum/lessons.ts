import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@lexdistill/shared';
import type { LearnerLevel } from '@lexdistill/protocol';
import type { Database } from 'bun:sqlite';
import {
  normalizeTrackLanguage,
  type TrackLanguage,
} from '@lexdistill/shared';

/**
 * D3 起家在 storage-sqlite（前身 gateway modules/curriculum/persistence/lessons.ts，
 * 逻辑不变）。参数收窄为 `{ sqlite }`（本文件只用原生连接，不用 drizzle/repo 回指）。
 */

export interface LessonSection {
  heading: string;
  body: string[];
}

export interface LessonExample {
  ja: string;
  reading: string;
  zh: string;
}

export interface Lesson {
  skillId: string;
  language: TrackLanguage;
  minLevel: LearnerLevel;
  title: string;
  summary: string;
  sections: LessonSection[];
  examples: LessonExample[];
  pitfall: string;
  sortOrder: number;
  completed: boolean;
  completedAt?: string | undefined;
}

interface LessonRow {
  id: string;
  language: string;
  min_level: string;
  title: string;
  summary: string;
  body_json: string;
  sort_order: number;
}

const LEVEL_SET = new Set(['NOVICE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']);

function narrowLevel(raw: unknown): LearnerLevel {
  return typeof raw === 'string' && LEVEL_SET.has(raw) ? (raw as LearnerLevel) : 'NOVICE';
}

function narrowLang(raw: unknown): TrackLanguage {
  return normalizeTrackLanguage(typeof raw === 'string' ? raw : undefined);
}

function parseBody(raw: string): { sections: LessonSection[]; examples: LessonExample[]; pitfall: string } {
  const fallback = { sections: [], examples: [], pitfall: '' };
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object') return fallback;
    const r = parsed as Record<string, unknown>;
    const sections = Array.isArray(r.sections)
      ? (r.sections as Array<{ heading?: unknown; body?: unknown }>)
          .filter((s) => typeof s.heading === 'string')
          .map((s) => ({
            heading: String(s.heading),
            body: Array.isArray(s.body) ? s.body.map((p) => String(p)) : [],
          }))
      : [];
    const examples = Array.isArray(r.examples)
      ? (r.examples as Array<{ ja?: unknown; reading?: unknown; zh?: unknown }>)
          .filter((e) => typeof e.ja === 'string')
          .map((e) => ({
            ja: String(e.ja),
            reading: typeof e.reading === 'string' ? e.reading : '',
            zh: typeof e.zh === 'string' ? e.zh : '',
          }))
      : [];
    return {
      sections,
      examples,
      pitfall: typeof r.pitfall === 'string' ? r.pitfall : '',
    };
  } catch {
    return fallback;
  }
}

async function completedMap(deps: { sqlite: Database }, userId: string): Promise<Map<string, string>> {
  const rows = deps.sqlite
    .query('SELECT skill_id AS skillId, completed_at AS completedAt FROM lesson_progress WHERE user_id = ?')
    .all(userId) as Array<{ skillId: string; completedAt: string }>;
  return new Map(rows.map((r) => [r.skillId, r.completedAt]));
}

/** 讲义列表（含学完态；损坏 body 读侧回空，不抛）。 */
export async function listLessons(
  deps: { sqlite: Database },
  userId: string,
  language: string
): Promise<Result<Lesson[], BusinessError>> {
  try {
    const track = narrowLang(language);
    const rows = deps.sqlite
      .query(
        'SELECT id, language, min_level, title, summary, body_json, sort_order FROM curriculum_lessons WHERE language = ? ORDER BY sort_order ASC'
      )
      .all(track) as LessonRow[];
    const done = await completedMap(deps, userId);
    return ok(
      rows.map((r) => {
        const body = parseBody(r.body_json);
        const at = done.get(r.id);
        return {
          skillId: r.id,
          language: narrowLang(r.language),
          minLevel: narrowLevel(r.min_level),
          title: r.title,
          summary: r.summary ?? '',
          sections: body.sections,
          examples: body.examples,
          pitfall: body.pitfall,
          sortOrder: r.sort_order,
          completed: at !== undefined,
          ...(at ? { completedAt: at } : {}),
        };
      })
    );
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'listLessons', entityId: userId })
    );
  }
}

/** 学完打卡（用户明确点的“学完了”；幂等，已完成直接返回）。 */
export async function completeLesson(
  deps: { sqlite: Database },
  userId: string,
  skillId: string
): Promise<Result<{ skillId: string; completedAt: string }, BusinessError>> {
  try {
    const skill = String(skillId || '').trim();
    if (!skill) {
      return err(new BusinessError('E_INVALID_INPUT', '讲义 id 不能为空', 'VALIDATION'));
    }
    const exists = deps.sqlite
      .query('SELECT id AS id FROM curriculum_lessons WHERE id = ?')
      .get(skill) as { id: string } | null;
    if (!exists) {
      return err(new BusinessError('E_LESSON_NOT_FOUND', '没有这篇讲义', 'VALIDATION'));
    }
    const prev = deps.sqlite
      .query('SELECT completed_at AS completedAt FROM lesson_progress WHERE user_id = ? AND skill_id = ?')
      .get(userId, skill) as { completedAt: string } | null;
    if (prev) return ok({ skillId: skill, completedAt: prev.completedAt });
    const now = nowIso();
    deps.sqlite
      .query('INSERT INTO lesson_progress (user_id, skill_id, completed_at) VALUES (?, ?, ?)')
      .run(userId, skill, now);
    return ok({ skillId: skill, completedAt: now });
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'completeLesson', entityId: userId })
    );
  }
}

/** 已学完技能 id（难度门消费）。 */
export async function listCompletedLessonSkills(
  deps: { sqlite: Database },
  userId: string
): Promise<Result<string[], BusinessError>> {
  try {
    const done = await completedMap(deps, userId);
    return ok([...done.keys()]);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listCompletedLessonSkills',
        entityId: userId,
      })
    );
  }
}

/** 本轨道有讲义的技能 id（难度门消费：有讲义未学完 = 锁定）。 */
export async function listLessonSkills(
  deps: { sqlite: Database },
  language: string
): Promise<Result<string[], BusinessError>> {
  try {
    const track = narrowLang(language);
    const rows = deps.sqlite
      .query('SELECT id AS id FROM curriculum_lessons WHERE language = ?')
      .all(track) as Array<{ id: string }>;
    return ok(rows.map((r) => r.id));
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'listLessonSkills' })
    );
  }
}
