/**
 * AI 导师按目标语种轨道的文案偏置（Chrome 仍为中文；例句用目标语）
 * Wave G3 — Target Language UI Shell
 */
import type { TrackLanguage } from '../learning/learning-shell.js';

export interface TutorFocusContext {
  questionText: string;
  userAnswer?: string | undefined;
  correctAnswer: string;
  skillTag: string;
  explanation: string;
}

export interface TutorTrackCopy {
  trackName: string;
  levelScheme: string;
  headerHint: string;
  quickPrompts: string[];
  defaultExampleTopic: string;
  offlineExamples: string;
  offlineExplain: string;
}

export const TUTOR_TRACK_COPY: Record<TrackLanguage, TutorTrackCopy> = {
  en: {
    trackName: '英语',
    levelScheme: 'CEFR / 考研分段',
    headerHint: '英语轨道 · 考研/六级向精讲',
    quickPrompts: [
      '请分析该长难句的主干结构',
      '请提供 3 个地道学术/真比例句',
      '考研/六级中最易混淆的词义辨析？',
    ],
    defaultExampleTopic: '学术写作搭配与长难句',
    offlineExamples: `为您提供 3 个考研/学术向地道例句：\n1. **The rapid advancement of technology has profoundly altered our daily routines.**\n2. **Recent studies illustrate a compelling correlation between sleep and memory.**\n3. **Scholars have long debated the philosophical implications of artificial intelligence.**`,
    offlineExplain: `核心考点剖析与逻辑辨析：\n- **主干拆解**：优先锁定句子谓语动词与从属从句连词。\n- **陷阱提示**：注意介词短语作后置定语时的分隔修饰。\n- **真题建议**：结合长难句切分，避免字面逐词直译。`,
  },
  ja: {
    trackName: '日语',
    levelScheme: 'JLPT 能力考',
    headerHint: '日语轨道 · JLPT 语法与助词',
    quickPrompts: [
      '为什么不能用别的助词？',
      '请给我造三个地道例句',
      '请总结该考点的速记口诀',
    ],
    defaultExampleTopic: '助词与谓语动词搭配',
    offlineExamples: `为你提供 3 个地道生活化例句：\n1. **日曜日、図書館へ行きます。**\n2. **友達とカフェで勉強します。**\n3. **明日の朝、会議に参加します。**`,
    offlineExplain: `这是最容易混淆的痛点！\n- **「で」**：动作发生场所或手段。\n- **「に」**：静态存在/归着点。\n移动方向也可用「へ」(读え)。`,
  },
  ko: {
    trackName: '韩语',
    levelScheme: 'TOPIK',
    headerHint: '韩语轨道 · TOPIK 语法与词尾',
    quickPrompts: [
      '该语法对应的终结词尾是什么？',
      '请提供 3 个韩语生活例句',
      'TOPIK 核心辨析考点有哪些？',
    ],
    defaultExampleTopic: '조사 에/에서',
    offlineExamples: `为你提供 3 个韩语生活常用例句：\n1. **내일 친구와 도서관에 가기로 했어요.**\n2. **주말에는 집에서 푹 쉬고 싶어요.**\n3. **한국어 공부가 점점 재미있어지고 있어요.**`,
    offlineExplain: `韩语核心辨析与词尾要点：\n- **「-이/가」 vs 「-은/는」**：新信息焦点主语 vs 已知主题/对比。\n- **提示**：关注终结词尾的敬体等级与语境连贯。`,
  },
};

export function getTutorTrackCopy(track: string | undefined | null): TutorTrackCopy {
  if (track === 'en') return TUTOR_TRACK_COPY.en;
  if (track === 'ko') return TUTOR_TRACK_COPY.ko;
  return TUTOR_TRACK_COPY.ja;
}

/** 联网首轮：注入轨道约束，避免英语轨仍按日语助词讲解 */
export function buildTutorBootstrapPrompt(
  track: TrackLanguage,
  ctx: TutorFocusContext
): string {
  const copy = getTutorTrackCopy(track);
  return (
    `你是面向母语为中文的学习者的${copy.trackName}导师（等级体系：${copy.levelScheme}）。` +
    `请用中文讲解，例句与术语使用${copy.trackName}。` +
    `根据当前题目做简短导入讲解（3–6 句），点明考点「${ctx.skillTag}」，并邀请继续追问。` +
    `输出要求（必须遵守）：直接用中文作答；不要输出英文思考过程、计划或复述本指令；` +
    `讲解控制在 300 字以内，要点式，例句精而不在多。` +
    `题干：${ctx.questionText}。` +
    (ctx.userAnswer ? `我的作答：${ctx.userAnswer}。` : '') +
    `参考解析：${ctx.explanation}`
  );
}

export function buildTutorFreeGreeting(track: TrackLanguage): string {
  const copy = getTutorTrackCopy(track);
  return (
    `你好！我是你的${copy.trackName}专属 AI 导师（${copy.levelScheme}）。` +
    `可以直接问语法辨析、例句造句或备考建议。`
  );
}

export function buildTutorOpeningGreeting(
  track: TrackLanguage,
  ctx: TutorFocusContext,
  offline: boolean
): string {
  const copy = getTutorTrackCopy(track);
  const offlineNote = offline ? '\n\n（当前未连接，可先离线追问；连接恢复后可点击重发获取 AI 作答。）' : '';
  return (
    `你好！我是你的${copy.trackName}专属 AI 导师（${copy.levelScheme}）。` +
    `针对「${ctx.skillTag}」：\n\n` +
    `**题目**：\n${ctx.questionText}\n\n` +
    `**标准解析**：\n${ctx.explanation}\n\n` +
    `你可以直接点击下方快捷追问，或输入你的疑问！` +
    offlineNote
  );
}

export function buildTutorOfflineReply(
  track: TrackLanguage,
  content: string,
  skillTag?: string
): string {
  const copy = getTutorTrackCopy(track);
  if (content.includes('例句') || content.includes('造句')) {
    return copy.offlineExamples;
  }
  if (
    content.includes('为什么') ||
    content.includes('辨析') ||
    content.includes('区分') ||
    content.includes('结构') ||
    content.includes('讲透') ||
    content.includes('考点')
  ) {
    return copy.offlineExplain;
  }
  return (
    `收到你的追问！关于「${content}」：建议结合当前${copy.trackName}考点` +
    `「${skillTag ?? ''}」做对照练习，并把易错点加入错题本。`
  );
}
