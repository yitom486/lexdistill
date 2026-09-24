/**
 * Agent 引擎选型（旁路）
 * - learning-loop：学习闭环主通路（Codex App Server + 原生工具）
 * - responses-lite：仅课程资产快查（发音/助词/五十音等）
 *
 * 自由教练 / 一般对话默认走 Codex；lite 不再截获寒暄与开放问答。
 */

export type AgentRouteId = 'learning-loop' | 'responses-lite';

export interface AgentRouteInput {
  userPrompt: string;
  intent?: string | undefined;
  targetLanguage?: string | undefined;
}

export interface AgentRouteDecision {
  route: AgentRouteId;
  reason: string;
}

const CONTENT_TOOL_HINT =
  /例句|造句|讲透|辨析|区分|考点|出题|考我|练一练|为什么|制定.*计划|复盘计划|一周/;

const LITE_HINT_JA =
  /读音|怎么读|発音|发音|声调|pitch|假名|五十音|平假名|片假名|助词|に\s*vs\s*で|で\s*vs\s*に|格助词/;

const LITE_HINT_KO = /발음|어떻게\s*읽|조사|에서|은\/는|이\/가|谚文|자모|한글|假名|发音|助词/;

const LITE_HINT_EN =
  /how\s+do\s+you\s+pronounce|pronunciation|ipa|stress|preposition|collocation|怎么读|发音|介词/;

/**
 * 纯函数选型：可单测、可日志；不持有 adapter 实例。
 */
export function selectAgentRoute(input: AgentRouteInput): AgentRouteDecision {
  const prompt = (input.userPrompt || '').trim();
  const intent = input.intent || '';
  const track = normalizeTrack(input.targetLanguage);

  // 自由教练 / 主对话：强制 Codex 主通路
  if (intent === 'FREE_COACH') {
    return { route: 'learning-loop', reason: 'free_coach_codex' };
  }

  if (
    intent === 'GENERATE_QUIZ' ||
    intent === 'GRADE' ||
    intent === 'REVIEW_MISTAKES' ||
    CONTENT_TOOL_HINT.test(prompt)
  ) {
    return { route: 'learning-loop', reason: 'content_or_quiz_intent' };
  }

  if (intent === 'DRILL_KANA') {
    return { route: 'responses-lite', reason: 'drill_kana_intent' };
  }

  if (intent === 'DRILL_HANGUL') {
    return { route: 'responses-lite', reason: 'drill_hangul_intent' };
  }

  // 明确的发音/助词课程资产查询才走 lite；开放讲解交给 Codex
  if (matchesLiteHint(prompt, track)) {
    return { route: 'responses-lite', reason: 'pronunciation_or_particle_lite' };
  }

  if (intent === 'EXPLAIN' && prompt.length <= 24 && matchesLiteHint(prompt, track)) {
    return { route: 'responses-lite', reason: 'short_explain_intent' };
  }

  return { route: 'learning-loop', reason: 'default_learning_coach' };
}

function normalizeTrack(raw?: string): 'ja' | 'en' | 'ko' {
  const v = (raw || '').toLowerCase();
  if (v === 'en' || v === 'eng') return 'en';
  if (v === 'ko' || v === 'kr') return 'ko';
  return 'ja';
}

function matchesLiteHint(prompt: string, track: 'ja' | 'en' | 'ko'): boolean {
  const p = prompt;
  const lower = prompt.toLowerCase();
  if (track === 'en') return LITE_HINT_EN.test(lower);
  if (track === 'ko') return LITE_HINT_KO.test(p) || LITE_HINT_JA.test(p);
  if (LITE_HINT_JA.test(p)) return true;
  if (p.length <= 24 && /[にでをがは]/.test(p) && /助词|区别|用法|怎么用/.test(p)) {
    return true;
  }
  return false;
}
