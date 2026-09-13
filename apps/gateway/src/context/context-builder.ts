import type { ContextSnapshot, ContextFocusItem } from '@study-studio/agent-core';
import { summarizeLearningEvidence } from '@study-studio/learning';
import { COURSE_STAGES, type LearnerProfileSnapshot, type LearnerRepository } from '@study-studio/learner-core';
import type { GeneratedQuestion, Flashcard } from '@study-studio/protocol';
import { isOk } from '@study-studio/shared';
import {
  buildTrackCoachMetadata,
  normalizeTrackLanguage,
  skillMatchesTrack,
  type TrackLanguage,
} from '../services/learning-language-policy.js';

export interface BuildTurnContextParams {
  profile: LearnerProfileSnapshot;
  currentQuestion?: GeneratedQuestion;
  userAnswer?: string;
  selectedWord?: string;
  focus?: ContextFocusItem;
  ui?: { activeTab?: string; activeMode?: string };
}

function countDueCards(cards: Flashcard[], nowIso: string): number {
  return cards.filter((c) => !c.fsrs.dueAt || c.fsrs.dueAt <= nowIso).length;
}

/** 从错题与薄弱项压缩近期错因标签（限长） */
export function deriveRecentErrorTags(
  mistakes: Array<{
    question?: { testedSkillId?: string | undefined; category?: string | undefined } | undefined;
  }>,
  weaknesses: Array<{ skillId: string }>
): string[] {
  const tags: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const segment = raw.includes('.') ? raw.split('.')[1]! : raw;
    const tag = segment.replace(/_/g, ' ').trim().toUpperCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
  };

  for (const m of mistakes.slice(0, 12)) {
    push(m.question?.testedSkillId);
    const cat = m.question?.category;
    if (cat && !tags.includes(cat)) tags.push(cat);
  }
  for (const w of weaknesses.slice(0, 5)) {
    push(w.skillId);
  }
  return tags.slice(0, 8);
}

function resolveTrack(
  client?: Partial<ContextSnapshot>,
  profileLang?: string | null
): TrackLanguage {
  return normalizeTrackLanguage(client?.targetLanguage || profileLang);
}

export class ContextBuilder {
  /**
   * 组装每轮对话的不可变 Context Snapshot (支持经典入参)
   */
  public build(params: BuildTurnContextParams): ContextSnapshot {
    const { profile, currentQuestion, userAnswer, selectedWord, focus, ui } = params;
    const track = normalizeTrackLanguage(profile.targetLanguage);

    const topWeaknesses = profile.weaknesses
      .filter((w) => skillMatchesTrack(w.id, track) && w.totalAttempts > 0)
      .slice(0, 5)
      .map((w) => ({ skillId: w.id, name: w.name, proficiency: w.proficiency }));


    return {
      targetLanguage: track,
      learnerLevel: profile.profile?.learnerLevel ?? 'UNKNOWN',
      locale: 'zh-CN',
      ui: ui || { activeTab: 'TUTOR' },
      focus: focus || (currentQuestion ? {
        kind: 'QUESTION' as const,
        id: currentQuestion.id,
        surface: currentQuestion.content,
        correctAnswer: currentQuestion.correctAnswer,
        userAnswer,
        explanation: currentQuestion.explanation,
        skillTag: currentQuestion.testedSkillId,
      } : undefined),
      learnerDigest: {
        topWeaknesses,
        ...(profile.profile ? { recordedStage: profile.profile.learnerLevel, studyGoal: profile.profile.studyGoal } : {}),
        practiceEvidence: summarizeLearningEvidence(profile.allMetrics ?? [], track),
      },
      topWeaknesses: topWeaknesses.map((w) => `${w.skillId} (${w.name})`),
      currentQuestion: currentQuestion
        ? {
            id: currentQuestion.id,
            content: currentQuestion.content,
            correctAnswer: currentQuestion.correctAnswer,
            userAnswer,
          }
        : undefined,
      selectedWord,
      metadata: buildTrackCoachMetadata(track),
    };
  }

  /**
   * 从 Repository 与客户端快照实时聚合完整 ContextSnapshot
   * （学情 digest 以 DB 为准；ui / focus / intent 优先客户端）
   */
  public async buildTurnSnapshot(
    userId: string,
    learnerRepo: LearnerRepository,
    clientSnapshot?: Partial<ContextSnapshot>
  ): Promise<ContextSnapshot> {
    const profileRes = await learnerRepo.getLearnerProfile(userId);
    const activeProfile = isOk(profileRes) ? profileRes.value : null;
    const track = resolveTrack(clientSnapshot, activeProfile?.targetLanguage);
    const [snapshotRes, dueCardsRes, mistakesRes, planRes, routeRes] = await Promise.all([
      learnerRepo.getProfileSnapshot(userId, track),
      learnerRepo.getDueCards(userId, 100, { language: track }),
      learnerRepo.getMistakes(userId, { resolved: false, language: track }),
      learnerRepo.getOrCreateDailyStudyPlan(userId),
      learnerRepo.getCourseRoute?.(userId, track),
    ]);
    const snapshot = isOk(snapshotRes) ? snapshotRes.value : null;
    const profile = snapshot?.profile?.targetLanguage === track ? snapshot.profile
      : activeProfile?.targetLanguage === track ? activeProfile : null;
    const nowIso = new Date().toISOString();

    const dueCardsCount = isOk(dueCardsRes)
      ? countDueCards(dueCardsRes.value, nowIso)
      : 0;

    const unresolvedMistakes = isOk(mistakesRes) ? mistakesRes.value : [];
    const unresolvedMistakesCount = unresolvedMistakes.length;

    const weaknesses = (snapshot?.weaknesses || [])
      .filter((w) => skillMatchesTrack(w.id, track) && w.totalAttempts > 0)
      .slice(0, 5)
      .map((w) => ({
        skillId: w.id,
        name: w.name,
        proficiency: w.proficiency,
      }));

    const allMetrics = snapshot?.allMetrics ?? [];
    const recentErrorTags = deriveRecentErrorTags(
      unresolvedMistakes
        .filter((m) => skillMatchesTrack(String(m.question?.testedSkillId || ''), track))
        .map((m) => ({
          question: {
            testedSkillId: m.question?.testedSkillId,
            category: (m.question as { category?: string } | undefined)?.category,
          },
        })),
      weaknesses
    );

    const coachMeta = buildTrackCoachMetadata(track);

    // 课程路线摘要（长期路线；推荐理由与解锁判断共用同一份快照）。
    const routeDigest =
      routeRes && isOk(routeRes)
        ? (() => {
            const units = routeRes.value.units ?? [];
            const nextUp = units.find((u) => u.unit.id === routeRes.value.nextUpId) ?? null;
            const stageNum = nextUp
              ? nextUp.unit.stage
              : units.length > 0
                ? Math.max(...units.map((u) => u.unit.stage))
                : 0;
            const stage = COURSE_STAGES.find((s) => s.stage === stageNum)?.name ?? `阶段${stageNum}`;
            return {
              courseRoute: {
                stage,
                ...(nextUp ? { nextUpTitle: nextUp.unit.title, nextUpProgress: nextUp.progress } : {}),
                mastered: units.filter((u) => u.status === 'mastered').length,
                total: units.length,
              },
            };
          })()
        : {};

    return {
      targetLanguage: track,
      learnerLevel: profile?.learnerLevel ?? 'UNKNOWN',
      locale: clientSnapshot?.locale || 'zh-CN',
      ui: clientSnapshot?.ui || { activeTab: 'TUTOR' },
      focus: clientSnapshot?.focus,
      learnerDigest: {
        topWeaknesses: weaknesses,
        ...(profile ? { recordedStage: profile.learnerLevel, studyGoal: profile.studyGoal } : {}),
        ...(snapshot ? { practiceEvidence: summarizeLearningEvidence(allMetrics, track) } : {}),
        ...routeDigest,
        ...(isOk(dueCardsRes) ? { dueCardsCount } : {}),
        ...(isOk(mistakesRes) ? { unresolvedMistakesCount } : {}),
        ...(profile ? { streakDays: profile.streakDays } : {}),
        recentErrorTags,
        ...(isOk(planRes) && planRes.value.language === track
          ? {
              dailyPlanRemaining: planRes.value.steps
                .filter((step) => !step.done)
                .map((step) => step.title),
            }
          : {}),
      },
      userIntentHint: clientSnapshot?.userIntentHint || 'EXPLAIN',
      constraints: clientSnapshot?.constraints,
      topWeaknesses: weaknesses.map((w) => `${w.skillId} (${w.name})`),
      metadata: {
        ...(clientSnapshot?.metadata || {}),
        ...coachMeta,
      },
      currentQuestion: clientSnapshot?.currentQuestion,
      selectedWord: clientSnapshot?.selectedWord,
    };
  }
}
