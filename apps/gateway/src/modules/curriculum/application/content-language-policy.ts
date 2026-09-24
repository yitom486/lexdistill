/**
 * 学习目标语言策略：初期英语优先，日语并存，韩语预留扩展。
 * RSS / 阅读生成 / UI 默认均应对齐此文件，避免各处硬编码 ja。
 */
export type StudyContentLanguage = 'EN' | 'JA' | 'KO';

/** 产品初期默认学习内容语言（阅读/新闻生成） */
export const DEFAULT_CONTENT_LANGUAGE: StudyContentLanguage = 'EN';

export function normalizeContentLanguage(
  raw: string | undefined | null,
  fallback: StudyContentLanguage = DEFAULT_CONTENT_LANGUAGE
): StudyContentLanguage {
  const v = (raw || '').toUpperCase();
  if (v === 'JA' || v === 'JP') return 'JA';
  if (v === 'KO' || v === 'KR') return 'KO';
  if (v === 'EN' || v === 'ENG') return 'EN';
  return fallback;
}

export function languageDisplayName(lang: StudyContentLanguage, locale: 'zh' | 'en' = 'zh'): string {
  if (locale === 'en') {
    return lang === 'EN' ? 'English' : lang === 'JA' ? 'Japanese' : 'Korean';
  }
  return lang === 'EN' ? '英语' : lang === 'JA' ? '日语' : '韩语';
}

/**
 * 英文自适应阅读篇目：面向 CET / 考研 / 日常精读，强调中式英语规避与语篇结构。
 * 当前为离线模板正文；接 LLM 时可将本函数返回值作为 system/user prompt 骨架。
 */
export function buildEnglishAiReadingPrompt(params: {
  topic: string;
  difficulty: number;
}): { title: string; body: string; sourceLabel: string } {
  const { topic, difficulty } = params;
  const cefr =
    difficulty <= 2 ? 'A2–B1' : difficulty === 3 ? 'B1–B2' : difficulty === 4 ? 'B2–C1' : 'C1';
  return {
    title: `Reading Focus: ${topic} (CEFR ${cefr})`,
    sourceLabel: `AI English Passage · Lv.${difficulty} · CEFR ${cefr} · Topic: ${topic}`,
    body: `For many Chinese learners of English, ${topic} is not only a content theme but also a chance to practice clear paragraph structure and natural collocations.

In the opening paragraph, a strong English essay usually states a clear claim, then supports it with one concrete example. Avoid translating Chinese word order directly; prefer “subject + verb + object” and signal logic with words such as however, therefore, and for instance.

A second paragraph can contrast two viewpoints. Instead of writing “people think… people also think…”, try “While some argue that…, others contend that…”. This pattern is common in CET and postgraduate entrance exam reading.

Finally, end with a concise takeaway: what the reader should notice next time they meet ${topic} in authentic media. Keep sentences medium-length, prefer precise verbs over vague nouns, and check articles (a/an/the) before you finish.`,
  };
}

/** 英文新闻阅读配题说明（给组题器 / 未来 LLM 的约束） */
export const ENGLISH_NEWS_QUIZ_GUIDANCE = `
You are building comprehension items for Chinese learners of English (CET-4/6, Kaoyan, or general B1–B2).
Prefer: main idea, vocabulary-in-context, inference — not trivia about the publisher.
Wrong options should be plausible Chinglish traps or over-generalizations.
Keep option length similar; one clearly best answer.
`.trim();

/** 韩语轨道学习注记：新闻已接公开韩语 RSS；AI 篇目为 TOPIK 初中级模板正文 */
export const KOREAN_LEARNING_NOTES = `
Korean track news uses public Korean RSS (Yonhap / Donga) with article full-text extract when possible, else RSS summary.
AI passages are TOPIK 1–4 level template texts with main-idea / connector / register items; swap to model generation when wired.
`.trim();

/**
 * 韩语轨道 AI 篇目：TOPIK 初中级模板正文（日常话题 + 그래서/하지만 连接 + 平实语体）。
 * 接 LLM 时可将本函数返回值作为 system/user prompt 骨架。
 */
export function buildKoreanAiReadingPrompt(params: {
  topic: string;
  difficulty: number;
}): { title: string; body: string; sourceLabel: string } {
  const { topic, difficulty } = params;
  const band = difficulty <= 2 ? 'TOPIK 1–2급' : difficulty === 3 ? 'TOPIK 3–4급' : 'TOPIK 5–6급';
  return {
    title: `TOPIK 읽기: ${topic} (${band})`,
    sourceLabel: `AI 한국어 지문 · ${band} · 주제: ${topic}`,
    body: `오늘의 주제는 '${topic}'입니다. 이 주제는 우리의 일상생활과 가까운 내용입니다. 바쁜 하루 속에서도 잠깐 멈추어 주변을 살펴보면 새로운 것을 발견할 수 있습니다.

예를 들어 어제 있었던 일을 생각해 봅시다. 처음에는 별일 아닌 것 같아도 자세히 살펴보면 몰랐던 노력과 사람들의 따뜻함을 느낄 수 있습니다. 그래서 작은 발견을 소중히 여기는 마음이 중요합니다. 하지만 많은 사람들은 바쁘다는 이유로 이런 여유를 갖지 못합니다.

한국어를 공부하는 것도 같습니다. 매일 조금씩 새로운 표현을 쌓으면 읽기 실력과 표현력이 점점 좋아집니다. 앞으로도 호기심을 가지고 새로운 세계를 알아봅시다.`,
  };
}
