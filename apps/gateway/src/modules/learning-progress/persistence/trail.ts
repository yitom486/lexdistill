import { and, count, eq, gte } from 'drizzle-orm';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@lexdistill/shared';
import { quizAttempts, studyActivityLogs } from '@lexdistill/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import type { TrackLanguage } from '@lexdistill/shared';
import { getTodayString } from '@lexdistill/shared';

/**
 * 新手带路（Beginner Trail）：零基础按天解锁的分阶段清单。
 * 定义为网关侧静态规则（与 proposeTemplateFromSnapshot 同源做法，见 STATIC #37）；
 * 进度取自当日学习资产（当日字母 drill / 当日收藏 / 当日做题 / 当日阅读），不新增表。
 *
 * 按天而非累计的原因：带路是“今天动手做”的引导，不是成就系统。
 * 历史总量会自动打钩（如随手点过 8 次假名就跳过第 1 天），违背引导本意。
 * “拥有多少”是收藏/画像的事，不归带路管。
 */

export type TrailCriterionKind = 'kana' | 'hangul' | 'cards' | 'quiz' | 'reading';
export type TrailTarget = 'KANA' | 'HANGUL' | 'CARDS' | 'QUIZ' | 'READING';

export interface TrailStageDef {
  id: string;
  /** 建议节奏（第 N 天）；解锁只看前置完成情况，不锁日历 */
  day: string;
  title: string;
  hint: string;
  tab: TrailTarget;
  criterion: { kind: TrailCriterionKind; goal: number };
}

export interface TrailStageStatus extends TrailStageDef {
  progress: number;
  done: boolean;
  locked: boolean;
  current: boolean;
}

export interface BeginnerTrail {
  track: TrackLanguage;
  complete: boolean;
  stages: TrailStageStatus[];
}

const JA_TRAIL: TrailStageDef[] = [
  {
    id: 'ja-1',
    day: '第 1 天',
    title: '开口跟读',
    hint: '去五十音工作室，点字母听发音并跟读，再随手做 3 道小测',
    tab: 'KANA',
    criterion: { kind: 'kana', goal: 3 },
  },
  {
    id: 'ja-2',
    day: '第 2 天',
    title: '清音小测',
    hint: '把 46 个清音认一遍，正确率不重要，先混个脸熟',
    tab: 'KANA',
    criterion: { kind: 'kana', goal: 15 },
  },
  {
    id: 'ja-3',
    day: '第 3 天',
    title: '收藏生词',
    hint: '查词或把单词转成生词卡，攒够 3 张',
    tab: 'CARDS',
    criterion: { kind: 'cards', goal: 3 },
  },
  {
    id: 'ja-4',
    day: '第 4 天',
    title: '第一次做题',
    hint: '做 3 道自适应题，错了会自动进错题本',
    tab: 'QUIZ',
    criterion: { kind: 'quiz', goal: 3 },
  },
  {
    id: 'ja-5',
    day: '第 5 天',
    title: '精读第一篇',
    hint: '读完一篇短文，划词即转生词卡',
    tab: 'READING',
    criterion: { kind: 'reading', goal: 1 },
  },
];

const KO_TRAIL: TrailStageDef[] = [
  {
    id: 'ko-1',
    day: '第 1 天',
    title: '开口跟读',
    hint: '去谚文工作室，点字母听发音并跟读，再随手做 3 道小测',
    tab: 'HANGUL',
    criterion: { kind: 'hangul', goal: 3 },
  },
  {
    id: 'ko-2',
    day: '第 2 天',
    title: '子音小测',
    hint: '把 14 个子音认一遍，正确率不重要，先混个脸熟',
    tab: 'HANGUL',
    criterion: { kind: 'hangul', goal: 15 },
  },
  {
    id: 'ko-3',
    day: '第 3 天',
    title: '收藏生词',
    hint: '查词或把单词转成生词卡，攒够 3 张',
    tab: 'CARDS',
    criterion: { kind: 'cards', goal: 3 },
  },
  {
    id: 'ko-4',
    day: '第 4 天',
    title: '第一次做题',
    hint: '做 3 道自适应题，错了会自动进错题本',
    tab: 'QUIZ',
    criterion: { kind: 'quiz', goal: 3 },
  },
  {
    id: 'ko-5',
    day: '第 5 天',
    title: '精读第一篇',
    hint: '读完一篇 TOPIK 短文，划词即转生词卡',
    tab: 'READING',
    criterion: { kind: 'reading', goal: 1 },
  },
];

const EN_TRAIL: TrailStageDef[] = [
  {
    id: 'en-1',
    day: '第 1 天',
    title: '收藏生词',
    hint: '查 3 个词转成生词卡，复习从此有米下锅',
    tab: 'CARDS',
    criterion: { kind: 'cards', goal: 3 },
  },
  {
    id: 'en-2',
    day: '第 2 天',
    title: '第一次做题',
    hint: '做 3 道自适应题，让系统摸清你的水平',
    tab: 'QUIZ',
    criterion: { kind: 'quiz', goal: 3 },
  },
  {
    id: 'en-3',
    day: '第 3 天',
    title: '精读第一篇',
    hint: '读完一篇外媒短文，划词即转生词卡',
    tab: 'READING',
    criterion: { kind: 'reading', goal: 1 },
  },
];

export function getTrailStages(track: TrackLanguage): TrailStageDef[] {
  if (track === 'ko') return KO_TRAIL;
  if (track === 'en') return EN_TRAIL;
  return JA_TRAIL;
}

/** 当日打卡行（字母 drill / 阅读均为当日计数；无行回零）。 */
async function todayActivityCounts(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage,
  today: string
): Promise<{ kana: number; hangul: number; reading: number }> {
  const rows = await deps.db
    .select({
      kana: studyActivityLogs.kanaCount,
      hangul: studyActivityLogs.hangulCount,
      reading: studyActivityLogs.readingCount,
    })
    .from(studyActivityLogs)
    .where(
      and(
        eq(studyActivityLogs.userId, userId),
        eq(studyActivityLogs.activityDate, today),
        eq(studyActivityLogs.language, track)
      )
    )
    .limit(1);
  const row = rows[0];
  return { kana: row?.kana ?? 0, hangul: row?.hangul ?? 0, reading: row?.reading ?? 0 };
}

/** 当日自适应做题数（quiz_attempts 行；字母 drill 不写该表，不会串台）。 */
async function todayQuizCount(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage,
  todayStart: string
): Promise<number> {
  const rows = await deps.db
    .select({ n: count() })
    .from(quizAttempts)
    .where(
      and(
        eq(quizAttempts.userId, userId),
        eq(quizAttempts.language, track),
        gte(quizAttempts.createdAt, todayStart)
      )
    );
  return rows[0]?.n ?? 0;
}

/** 当日收藏数（collect 审计；词典/草稿/批注三漏斗都写，新卡直写的不算——带路要的是“今天动手收”）。 */
function todayCollectCount(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage,
  todayStart: string
): number {
  const row = deps.sqlite
    .query(
      `SELECT COUNT(*) AS n FROM term_occurrences
       WHERE user_id = ? AND language = ? AND source = 'collect' AND created_at >= ?`
    )
    .get(userId, track, todayStart) as { n: number } | null;
  return row?.n ?? 0;
}

/** 字母基本功（累计值）：五十音/谚文认完没有的标志；能力判定用累计，带路日常用当天。 */
export function alphabetBasicsDoneFromMetrics(
  metrics: Array<{ id: string; totalAttempts: number }>,
  track: TrackLanguage
): boolean {
  if (track === 'en') return true;
  const prefix = track === 'ko' ? 'ko.hangul.' : 'jp.kana.';
  const total = metrics
    .filter((m) => m.id.startsWith(prefix))
    .reduce((sum, m) => sum + m.totalAttempts, 0);
  return total >= 15;
}

/** 字母基本功（累计值）：五十音/谚文认完没有的标志；能力判定用累计，带路日常用当天。 */
export async function alphabetBasicsDone(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage
): Promise<boolean> {
  if (track === 'en') return true;
  const snapshotRes = await deps.repo.getProfileSnapshot(userId, track);
  if (!isOk(snapshotRes)) return false;
  return alphabetBasicsDoneFromMetrics(snapshotRes.value.allMetrics ?? [], track);
}

/**
 * 聚合新手带路进度（全部按天；定义见文件头注释）。
 * 任一上游失败即整体转业务错（带路面无半吊子数据）。
 */
export async function getBeginnerTrail(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage
): Promise<Result<BeginnerTrail, BusinessError>> {
  try {
    const today = getTodayString();
    const todayStart = `${today}T00:00:00.000Z`;
    const [activity, quiz, collects] = await Promise.all([
      todayActivityCounts(deps, userId, track, today),
      todayQuizCount(deps, userId, track, todayStart),
      Promise.resolve(todayCollectCount(deps, userId, track, todayStart)),
    ]);

    const counts: Record<TrailCriterionKind, number> = {
      kana: activity.kana,
      hangul: activity.hangul,
      cards: collects,
      quiz,
      reading: activity.reading,
    };

    const stages = getTrailStages(track);
    let currentAssigned = false;
    const statuses: TrailStageStatus[] = stages.map((stage, index) => {
      const raw = counts[stage.criterion.kind] ?? 0;
      const progress = Math.min(raw, stage.criterion.goal);
      const done = raw >= stage.criterion.goal;
      const prevDone = stages.slice(0, index).every((s) => {
        const c = counts[s.criterion.kind] ?? 0;
        return c >= s.criterion.goal;
      });
      const locked = !prevDone;
      const current = !done && !locked && !currentAssigned;
      if (current) currentAssigned = true;
      return { ...stage, progress, done, locked, current };
    });

    return ok({ track, complete: statuses.every((s) => s.done), stages: statuses });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getBeginnerTrail',
        entityId: userId,
      })
    );
  }
}
