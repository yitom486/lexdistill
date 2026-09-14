import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import {
  resolveCourseRoute,
  type CourseRouteSnapshot,
  type UnitEvidence,
} from '@study-studio/learner-core';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import {
  normalizeTrackLanguage,
  type TrackLanguage,
} from '@study-studio/shared';

/**
 * 课程路线（长期路线，不随每日重置；每日计划从中取任务）。
 * 证据语义（活动≠掌握）：
 * - kanaOk：答对过至少两次且当前干净（fsrs.reps≥2 且 consecutiveErrors==0）；
 *   只答对一次/刷同几个/reps 不够都不计覆盖；
 * - wordsStudied：讲透且复习过两次以上（studied_at 非空且 fsrs.reps≥2），光点学透不算；
 * - lessonsDone 只开练习锁（讲义锁），单元掌握另看 lesson-plus-quiz 做题证据；
 * - stale 系：近期错误只提示复习（needsReview），不收回已记录资格。
 * 证据全部来自既有表；unit_progress 只记 mastered 结论（+证据快照）。
 */

/** fsrs JSON  parses 出 reps（坏数据按 0 计，不抛）。 */
function fsrsReps(fsrsJson: unknown): number {
  try {
    if (typeof fsrsJson !== 'string' || !fsrsJson) return 0;
    const parsed: unknown = JSON.parse(fsrsJson);
    if (!parsed || typeof parsed !== 'object') return 0;
    const reps = (parsed as { reps?: unknown }).reps;
    return typeof reps === 'number' && Number.isFinite(reps) ? Math.floor(reps) : 0;
  } catch {
    return 0;
  }
}

async function collectEvidence(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage
): Promise<UnitEvidence> {
  const kanaRows = deps.sqlite
    .query(
      `SELECT kana_id AS kanaId, fsrs_json AS fsrsJson, consecutive_errors AS consecutiveErrors
       FROM kana_practice_states WHERE user_id = ?`
    )
    .all(userId) as Array<{ kanaId: string; fsrsJson: string; consecutiveErrors: number }>;
  const kanaOk = [...new Set(kanaRows.filter((r) => r.consecutiveErrors === 0 && fsrsReps(r.fsrsJson) >= 2).map((r) => r.kanaId))];
  const kanaStale = [...new Set(kanaRows.filter((r) => r.consecutiveErrors > 0).map((r) => r.kanaId))];

  const quizRows = deps.sqlite
    .query(
      `SELECT tested_skill_id AS skillId, COUNT(*) AS n, SUM(is_correct) AS c
       FROM quiz_attempts WHERE user_id = ? AND language = ? GROUP BY tested_skill_id`
    )
    .all(userId, track) as Array<{ skillId: string; n: number; c: number }>;
  const quizBySkill: Record<string, { attempts: number; correct: number }> = {};
  for (const r of quizRows) {
    quizBySkill[r.skillId] = { attempts: r.n, correct: r.c ?? 0 };
  }

  const lessonRows = deps.sqlite
    .query('SELECT skill_id AS skillId FROM lesson_progress WHERE user_id = ?')
    .all(userId) as Array<{ skillId: string }>;

  const skillRows = deps.sqlite
    .query(
      `SELECT skill_id AS skillId, consecutive_errors AS consecutiveErrors
       FROM skill_metrics WHERE user_id = ? AND language = ?`
    )
    .all(userId, track) as Array<{ skillId: string; consecutiveErrors: number }>;
  const staleSkills = [...new Set(skillRows.filter((r) => r.consecutiveErrors > 0).map((r) => r.skillId))];

  const wordRows = deps.sqlite
    .query(
      `SELECT source_entry_id AS entryId, fsrs AS fsrsJson FROM flashcards
       WHERE user_id = ? AND studied_at IS NOT NULL AND source_entry_id IS NOT NULL`
    )
    .all(userId) as Array<{ entryId: string; fsrsJson: string }>;
  const wordsStudied = wordRows.filter((r) => fsrsReps(r.fsrsJson) >= 2).map((r) => r.entryId);

  const examRows = deps.sqlite
    .query(
      `SELECT target_level AS targetLevel FROM placement_exams
       WHERE user_id = ? AND language = ? AND status = 'passed'`
    )
    .all(userId, track) as Array<{ targetLevel: string }>;

  return {
    kanaOk,
    quizBySkill,
    lessonsDone: lessonRows.map((r) => r.skillId),
    wordsStudied,
    examsPassed: [...new Set(examRows.map((r) => r.targetLevel))],
    kanaStale,
    staleSkills,
  };
}

function wordGroupIds(deps: RepoDeps, track: TrackLanguage): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const groups: Array<[string, string]> =
    track === 'ja'
      ? [['ja-n5-core', 'n5_ja_*']]
      : track === 'ko'
        ? [['ko-starter', 'starter_ko_*']]
        : [['en-starter', 'starter_en_*']];
  for (const [group, idGlob] of groups) {
    // GLOB 的大小写敏感前缀可命中 (language, id) 索引；LIKE 在默认排序规则下只会按 language 扫描。
    const rows = deps.sqlite
      .query('SELECT id AS id FROM local_dictionary_entries WHERE language = ? AND id GLOB ? ORDER BY id ASC')
      .all(track, idGlob) as Array<{ id: string }>;
    out[group] = rows.map((r) => r.id);
  }
  return out;
}

/** 路线求值 + 新掌握写档（幂等；写档失败只 warn，不挡返回）。 */
export async function getCourseRoute(
  deps: RepoDeps,
  userId: string,
  language: string
): Promise<Result<CourseRouteSnapshot, BusinessError>> {
  try {
    const track = normalizeTrackLanguage(language);
    const evidence = await collectEvidence(deps, userId, track);
    const recordedRows = deps.sqlite
      .query("SELECT unit_id AS unitId FROM unit_progress WHERE user_id = ? AND status = 'mastered'")
      .all(userId) as Array<{ unitId: string }>;
    const recorded = new Set(recordedRows.map((r) => r.unitId));
    const resolvedWords = wordGroupIds(deps, track);
    const units = resolveCourseRoute(track, evidence, recorded, resolvedWords);
    const fresh = units.filter((u) => u.status === 'mastered' && !recorded.has(u.unit.id));
    if (fresh.length > 0) {
      try {
        const now = nowIso();
        const stmt = deps.sqlite.prepare(
          `INSERT OR IGNORE INTO unit_progress (user_id, unit_id, status, evidence_json, updated_at)
           VALUES (?, ?, 'mastered', ?, ?)`
        );
        for (const f of fresh) {
          stmt.run(userId, f.unit.id, JSON.stringify({ progress: f.progress, at: now }), now);
        }
      } catch {
        // 写档失败不挡路线返回（下次调用补记）。
      }
    }
    const next = units.find((u) => u.status === 'available') ?? null;
    return ok({ units, nextUpId: next ? next.unit.id : null });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getCourseRoute',
        entityId: userId,
      })
    );
  }
}
