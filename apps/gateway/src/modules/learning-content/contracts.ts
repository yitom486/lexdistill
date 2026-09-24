import { z } from 'zod';
import type { GeneratedQuestion } from '@study-studio/protocol';
import { PracticeBlockSpecSchema } from '@study-studio/protocol';

export interface KanaWord {
  id: string;
  /** 词典条目 id（可直接调收集接口转 FSRS 生词卡）。 */
  entryId: string;
  headword: string;
  /** 假名读音（听写播报与作答比对用）。 */
  kana: string;
  meanings: string[];
  /** TTS 朗读文本（即 kana）。 */
  audioText: string;
  sourceLabel: string;
}

export interface HangulWord {
  id: string;
  /** 词典条目 id（可直接调收集接口转 FSRS 生词卡）。 */
  entryId: string;
  /** 韩语表层形（听写播报与选项用；Kengdic 条目即 headword）。 */
  korean: string;
  /** 英文释义（词义回想选项用，取前 3）。 */
  meanings: string[];
  /** TTS 朗读文本（即 korean）。 */
  audioText: string;
  sourceLabel: string;
}

export const LearningContentInputSchema = z.object({
  action: z.enum([
    'generate_quiz',
    'explain',
    'example_set',
    'kana_drill',
    // 谚文认读小测：从 curriculum_hangul 随机组看字母选罗马字题（系统随机，零成本）
    'hangul_drill',
    // 韩语单词听写/词义巩固：从本地词典随机抽取韩语词语（系统随机，零成本）
    'generate_hangul_words',
    // 假名单词听写/词义巩固：从本地词典随机抽取带假名读音的词语（系统随机，零成本）
    'generate_kana_words',
    'generate_passage',
    'generate_writing_prompt',
    // P5-E7：按练习计划块规格批量生成（模板驱动，不调 LLM；READING 走篇目链路另行接入）
    'generate_for_block',
  ]),
  count: z.number().int().min(1).max(20).optional(),
  format: z
    .enum([
      'MULTIPLE_CHOICE',
      'FILL_IN_BLANK',
      'SENTENCE_REORDER',
      'KANA_READ',
      'READING_MCQ',
      'TRANSLATION',
      'LISTENING_DICTATION',
      'WRITING_PROMPT',
    ])
    .optional(),
  skillIds: z.array(z.string()).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  topic: z.string().optional(),
  /** translation | email | essay | diary | news_response */
  genre: z.string().optional(),
  /** generate_kana_words：目标书写体（缺省 HIRAGANA；不足时另一书写体补齐） */
  script: z.enum(['HIRAGANA', 'KATAKANA']).optional(),
  /** Persist into practice_collections / practice_items when true */
  collect: z.boolean().optional(),
  collectionTitle: z.string().optional(),
  /** generate_for_block：块规格列表（逐块映射到既有生成路径） */
  blocks: z.array(PracticeBlockSpecSchema).optional(),
});

export type LearningContentInput = z.infer<typeof LearningContentInputSchema>;

export interface LearningContentOutput {
  action: string;
  language: string;
  summary: string;
  questions?: GeneratedQuestion[] | undefined;
  examples?: Array<{ sentence: string; translation: string; grammarPoint: string }> | undefined;
  explanation?: {
    coreConcept: string;
    rules: string[];
    commonMistakes: string[];
    mnemonicTip: string;
  } | undefined;
  passage?: {
    title: string;
    body: string;
    topic: string;
  } | undefined;
  writingPrompts?: Array<{
    id: string;
    category: string;
    chinesePrompt: string;
    contextHint: string;
    testedSkillId: string;
    standardAnswer: string;
    grammarFocus: string;
  }> | undefined;
  dictationItems?: Array<{
    id: string;
    sourceLesson: string;
    speaker: string;
    fullJapanese: string;
    chinese: string;
    blankPrompt: string;
    clozeDisplay: string;
    targetWord: string;
    furiganaHint: string;
    categoryTag: string;
    testedSkillId: string;
    grammarExplanation: string;
  }> | undefined;
  /** generate_for_block：按块对齐的生成结果（questions 为空/errorCode 时由装配层回退） */
  perBlock?: Array<{
    blockId: string;
    kind: string;
    questions?: GeneratedQuestion[];
    errorCode?: string;
  }> | undefined;
  /** generate_kana_words：带假名读音的词语（含词典 entryId，可一键转生词卡） */
  kanaWords?: KanaWord[] | undefined;
  /** generate_hangul_words：韩语词语（含词典 entryId，可一键转生词卡） */
  hangulWords?: HangulWord[] | undefined;
  collectionId?: string | undefined;
}

export interface LearningContentContext {
  userId: string;
  sessionId: string;
  turnId?: string;
}
