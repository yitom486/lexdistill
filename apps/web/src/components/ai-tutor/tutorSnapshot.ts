import type { ContextSnapshot } from '@lexdistill/agent-runtime';
import { normalizeTrackLanguage, type TrackLanguage } from '../../learning/learning-shell.js';
import type { AiTutorContext } from '../../stores/tutor-context.js';

export function normalizeTutorLanguage(lang: string): TrackLanguage {
  return normalizeTrackLanguage(lang);
}

/** 题目导师客户端快照：题目归属 + 当前轨道/档位，不含自由导师阅读 focus。 */
export function buildTutorClientSnapshot(
  ctx: AiTutorContext,
  activeTab: string,
  profile: { targetLanguage: string; overallLevel: string }
): Partial<ContextSnapshot> {
  return {
    targetLanguage: normalizeTutorLanguage(profile.targetLanguage),
    learnerLevel: profile.overallLevel,
    locale: 'zh-CN',
    ui: {
      activeTab,
      openTutor: true,
    },
    focus: {
      kind: 'QUESTION',
      surface: ctx.questionText,
      correctAnswer: ctx.correctAnswer,
      userAnswer: ctx.userAnswer,
      explanation: ctx.explanation,
      skillTag: ctx.skillTag,
    },
    userIntentHint: 'EXPLAIN',
  };
}
