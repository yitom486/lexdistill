import type { GeneratedQuestion } from '@study-studio/protocol';

/**
 * M7-18 自 Gateway `practice/application/practice-assembly.ts` 迁入
 * （映射规则逐行一致）。
 *
 * 题库行到协议题目的纯映射：DB 题型回映射、字段默认、options 收窄、
 * dictation 语料透传。纯逻辑：不读时钟、不触存储/网络；不依赖 Gateway、
 * learner-core、SQLite、Drizzle、Agent、Web。
 */

/** 题库行结构化输入（仅表达映射实际需要的字段；与持久化方言解耦）。 */
export interface PoolQuestionRow {
  id?: unknown;
  type?: unknown;
  prompt?: unknown;
  content?: unknown;
  options?: unknown;
  correctAnswer?: unknown;
  explanation?: unknown;
  testedSkill?: unknown;
  testedSkillId?: unknown;
  difficulty?: unknown;
  dictation?: unknown;
}

/** 把 quiz_questions 池行映射为协议 GeneratedQuestion（含 P6-2 语料透传）。 */
export function mapPoolQuestion(q: PoolQuestionRow): GeneratedQuestion {
  // 语料：仅接受结构完整的 dictation（fullJapanese 必填），否则丢弃
  const rawDictation =
    q.dictation && typeof q.dictation === 'object'
      ? (q.dictation as Record<string, unknown>)
      : undefined;
  const fullJapanese = rawDictation?.fullJapanese;
  const dictation =
    typeof fullJapanese === 'string'
      ? {
          fullJapanese,
          ...(typeof rawDictation?.speaker === 'string' ? { speaker: rawDictation.speaker } : {}),
          ...(typeof rawDictation?.chinese === 'string' ? { chinese: rawDictation.chinese } : {}),
          ...(typeof rawDictation?.furiganaHint === 'string'
            ? { furiganaHint: rawDictation.furiganaHint }
            : {}),
        }
      : undefined;
  return {
    id: String(q.id ?? ''),
    type: mapQuestionType(q.type),
    prompt: String(q.prompt ?? ''),
    content: String(q.content ?? ''),
    options: Array.isArray(q.options) ? (q.options as string[]) : undefined,
    correctAnswer: String(q.correctAnswer ?? ''),
    explanation: String(q.explanation ?? ''),
    testedSkillId: String(q.testedSkillId ?? q.testedSkill ?? 'review'),
    difficultyTier: typeof q.difficulty === 'number' ? q.difficulty : 3,
    ...(dictation ? { dictation } : {}),
  };
}

/** 把 quiz_questions 的 UI 类型映射回协议 QuizQuestionType。 */
export function mapQuestionType(raw: unknown): GeneratedQuestion['type'] {
  const t = String(typeof raw === 'string' ? raw : '').toUpperCase();
  if (t === 'CHOICE' || t === 'MULTIPLE_CHOICE') return 'MULTIPLE_CHOICE';
  if (t === 'FILL_BLANK' || t === 'FILL_IN_BLANK') return 'FILL_IN_BLANK';
  if (t === 'REORDER' || t === 'SENTENCE_REORDER') return 'SENTENCE_REORDER';
  if (t === 'TRANSLATION') return 'TRANSLATION';
  if (t === 'LISTENING_DICTATION' || t === 'DICTATION') return 'LISTENING_DICTATION';
  return 'MULTIPLE_CHOICE';
}
