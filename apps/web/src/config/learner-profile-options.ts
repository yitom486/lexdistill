/**
 * 学情画像：备考赛道与能力梯度配置。
 * 按目标语种大类分组；组件内只做列表渲染。
 */
import type { StudyGoal, LearnerLevel } from '@lexdistill/protocol';
import type { TargetLanguage } from '@lexdistill/learner-core';

export interface StudyGoalOption {
  id: StudyGoal;
  label: string;
  lang: TargetLanguage;
  desc: string;
}

export interface StudyGoalTrackGroup {
  lang: TargetLanguage;
  label: string;
  hint: string;
  goals: StudyGoalOption[];
}

export interface LearnerLevelOption {
  id: LearnerLevel;
  label: string;
  sub: string;
}

export const STUDY_GOAL_OPTIONS: StudyGoalOption[] = [
  // 英语
  { id: 'CET6', label: '大学英语六级 (CET-6)', lang: 'en', desc: '高校备考 · 深度阅读与听力抗干扰' },
  { id: 'CET4', label: '大学英语四级 (CET-4)', lang: 'en', desc: '基础夯实 · 核心高频词与快速阅读' },
  { id: 'KAOYAN_EN', label: '全国硕士考研英语', lang: 'en', desc: '真题剖析 · 考研长难句与熟词僻义' },
  // 日语
  { id: 'JLPT_N2', label: 'JLPT N2 能力考', lang: 'ja', desc: '核心进阶 · 靶向语用与高频词汇' },
  { id: 'JLPT_N1', label: 'JLPT N1 最高级', lang: 'ja', desc: '冲刺精通 · 抽象论述与学术用语' },
  { id: 'JLPT_N3', label: 'JLPT N3 中级', lang: 'ja', desc: '中级稳固 · 日常书面与商务初级' },
  { id: 'JLPT_N4', label: 'JLPT N4 初进阶', lang: 'ja', desc: '初级语法 · 基础动词变形与助词' },
  { id: 'JLPT_N5', label: 'JLPT N5 零起步', lang: 'ja', desc: '入门起步 · 假名记忆与简短会话' },
  { id: 'DAILY_CONVERSATION', label: '日常无障碍实用生活', lang: 'ja', desc: '实用主义 · 旅游/生活/场景听说' },
  { id: 'INTEREST_BASIC', label: '兴趣萌芽与自娱入门', lang: 'ja', desc: '泛读体验 · 二次元、歌曲与文化' },
  // 韩语（骨架占位，内容后续补齐）
  { id: 'TOPIK_II', label: 'TOPIK II 中高级', lang: 'ko', desc: '中高级读写 · 议论文与新闻听力（筹备中）' },
  { id: 'TOPIK_I', label: 'TOPIK I 初级', lang: 'ko', desc: '初级听说 · 基础语法与生活会话（筹备中）' },
];

/** 语种大类 → 赛道子项（学情弹窗分层选择 SSOT） */
export const STUDY_GOAL_TRACK_GROUPS: StudyGoalTrackGroup[] = [
  {
    lang: 'en',
    label: '英语',
    hint: 'CET / 考研',
    goals: STUDY_GOAL_OPTIONS.filter((g) => g.lang === 'en'),
  },
  {
    lang: 'ja',
    label: '日语',
    hint: 'JLPT / 生活',
    goals: STUDY_GOAL_OPTIONS.filter((g) => g.lang === 'ja'),
  },
  {
    lang: 'ko',
    label: '韩语',
    hint: 'TOPIK（筹备）',
    goals: STUDY_GOAL_OPTIONS.filter((g) => g.lang === 'ko'),
  },
];

export const LEARNER_LEVELS: LearnerLevelOption[] = [
  { id: 'NOVICE', label: '零基础入门', sub: '从基础音标/假名开始' },
  { id: 'BEGINNER', label: '初学者', sub: '具备基本词汇与骨架' },
  { id: 'INTERMEDIATE', label: '进阶跃升', sub: '能阅读短文，强化弱项' },
  { id: 'ADVANCED', label: '高阶精通', sub: '地道表达与高速听读' },
];

export function findStudyGoalOption(id: StudyGoal): StudyGoalOption | undefined {
  return STUDY_GOAL_OPTIONS.find((g) => g.id === id);
}

export function findTrackGroup(lang: TargetLanguage): StudyGoalTrackGroup {
  return (
    STUDY_GOAL_TRACK_GROUPS.find((g) => g.lang === lang) || STUDY_GOAL_TRACK_GROUPS[0]!
  );
}

export function defaultGoalForTrack(lang: TargetLanguage): StudyGoal {
  return findTrackGroup(lang).goals[0]!.id;
}
