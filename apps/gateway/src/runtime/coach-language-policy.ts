import type { TrackLanguage } from '@lexdistill/shared';

function trackDisplayNameZh(track: TrackLanguage): string {
  return track === 'en' ? '英语' : track === 'ko' ? '韩语' : '日语';
}

function trackLevelScheme(track: TrackLanguage): string {
  if (track === 'en') return 'CEFR / 考研分段';
  if (track === 'ko') return 'TOPIK';
  return 'JLPT 能力考';
}

/** 导师工具缺省 topic（避免韩/英语轨仍落到「格助词」） */
export function defaultCoachTopic(track: TrackLanguage): string {
  if (track === 'en') return '学术写作搭配与长难句';
  if (track === 'ko') return '조사 에/에서';
  return '助词与谓语动词搭配';
}

export function defaultExplainTopic(track: TrackLanguage): string {
  if (track === 'en') return '长难句主干与从句辨析';
  if (track === 'ko') return '조사·어미 핵심 변별';
  return '格助词辨析';
}

export function defaultQuizSkillId(track: TrackLanguage): string {
  if (track === 'en') return 'en.grammar.subjunctive';
  if (track === 'ko') return 'ko.grammar.particle_eseo';
  return 'jp.particle.ni_vs_de';
}

export function defaultLearnerLevelLabel(track: TrackLanguage): string {
  if (track === 'en') return 'B1';
  if (track === 'ko') return 'A1';
  return 'N3';
}

export function skillMatchesTrack(skillId: string, track: TrackLanguage): boolean {
  if (!skillId) return true;
  if (track === 'en') return skillId.startsWith('en.');
  if (track === 'ko') return skillId.startsWith('ko.');
  return !skillId.startsWith('en.') && !skillId.startsWith('ko.');
}

/**
 * 写入 ContextSnapshot.metadata，供后续 Adapter / 提示词骨架消费（Zero Provider Leak）。
 */
export function buildTrackCoachMetadata(track: TrackLanguage): Record<string, unknown> {
  const name = trackDisplayNameZh(track);
  const scheme = trackLevelScheme(track);
  return {
    coachTrack: track,
    coachTrackName: name,
    levelScheme: scheme,
    coachHints: [
      `界面母语为中文；学习目标语种为${name}（${scheme}）`,
      `讲解用中文，例句与术语使用${name}`,
      track === 'ja'
        ? '可引用助词/JLPT 考点；必要时提及假名注音'
        : track === 'en'
          ? '侧重长难句、搭配与考研/CET 陷阱，避免日语助词话术'
          : 'TOPIK interim：侧重조사/어미与敬体等级，勿串日语例句',
      '禁止假设学员正在学其他语种的种子题',
    ],
  };
}

/** Gateway 流式导师通用回复：按轨道偏置，不再写死「外语/日语」口吻 */
export function buildGenericCoachReply(params: {
  track: TrackLanguage;
  userPrompt: string;
  focusLabel?: string | undefined;
}): string {
  const { track, userPrompt } = params;
  const name = trackDisplayNameZh(track);
  const scheme = trackLevelScheme(track);
  const focusInfo = params.focusLabel
    ? `针对你正在学习的【${params.focusLabel}】`
    : `针对你的${name}学情进度`;
  const tip =
    track === 'en'
      ? '建议结合长难句切分与真比例句，需要时让我「讲透考点」或「给出例句」。'
      : track === 'ko'
        ? '建议对照조사/어미做最小对立体，需要时让我「讲透考点」或「给出例句」。'
        : '建议把孤立语法点放入完整语境体会，需要时让我「讲透考点」或「给出例句」。';

  return (
    `你好！我是你的${name}自适应学习专属导师（${scheme}）。${focusInfo}：\n\n` +
    `你刚刚提到：“${userPrompt}”。${tip}`
  );
}
