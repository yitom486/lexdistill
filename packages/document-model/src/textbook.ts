import { z } from 'zod';
import { ok, err, Result, BusinessError } from '@study-studio/shared';

/** M8-1 自 protocol 迁入 document-model（字节一致，行为不变）。 */

export const LanguageCodeSchema = z.enum(['JA', 'EN', 'KO']).default('JA');
export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

export const TextbookVocabularySchema = z.object({
  id: z.string(),
  kanji: z.string(), // 词面（日文汉字/假名、英语单词、韩文谚文）
  kana: z.string(), // 注音（日文假名、英语注音/音标、韩文罗马音）
  phonetic: z.string().optional(), // 国际音标 IPA 或精确发音注记 (如 /ɪkˈskjuːz/)
  romaji: z.string().optional(),
  pos: z.string().default('名词'),
  pitchAccent: z.string().default('⓪'), // 日语声调或英语重音标识
  chinese: z.string(),
  example: z
    .object({
      japanese: z.string(),
      chinese: z.string(),
    })
    .optional(),
});
export type TextbookVocabulary = z.infer<typeof TextbookVocabularySchema>;


export const TextbookGrammarSchema = z.object({
  id: z.string(),
  title: z.string(),
  connection: z.string(),
  explanation: z.string(),
  examples: z.array(
    z.object({
      japanese: z.string(),
      chinese: z.string(),
    })
  ),
});
export type TextbookGrammar = z.infer<typeof TextbookGrammarSchema>;

export const DialogueWordSchema = z.object({
  surface: z.string(),
  reading: z.string().optional(),
  meaning: z.string().optional(),
  pos: z.string().optional(),
});
export type DialogueWord = z.infer<typeof DialogueWordSchema>;

export const DialogueLineSchema = z.object({
  speaker: z.string(),
  japanese: z.string(),
  chinese: z.string(),
  words: z.array(DialogueWordSchema).optional(),
});
export type DialogueLine = z.infer<typeof DialogueLineSchema>;

export const ExerciseItemSchema = z.object({
  id: z.string(),
  type: z.enum(['CHOICE', 'FILL_BLANK', 'TRANSLATION']),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  answer: z.string(),
  explanation: z.string().optional(),
});
export type ExerciseItem = z.infer<typeof ExerciseItemSchema>;

export const TextbookLessonSchema = z.object({
  id: z.string(),
  language: LanguageCodeSchema.optional(),
  lessonNumber: z.number().int().positive(),
  title: z.string(),
  summary: z.string().optional(),
  /** 导入底稿保留目录与任务状态，关系表由这些字段派生。旧 AST 可缺省。 */
  kind: z.enum(['lesson', 'chapter', 'section']).optional(),
  parentId: z.string().nullable().optional(),
  startPage: z.number().int().positive().optional(),
  endPage: z.number().int().positive().optional(),
  status: z.enum(['pending', 'ready', 'failed']).optional(),
  passageMd: z.string().nullable().optional(),
  previewJson: z.string().nullable().optional(),
  summaryJson: z.string().nullable().optional(),
  vocabularies: z.array(TextbookVocabularySchema),
  grammarPoints: z.array(TextbookGrammarSchema),
  dialogues: z.array(DialogueLineSchema),
  exercises: z.array(ExerciseItemSchema).optional().default([]),
});
export type TextbookLesson = z.infer<typeof TextbookLessonSchema>;

export const TextbookASTSchema = z.object({
  id: z.string(),
  language: LanguageCodeSchema,
  title: z.string(),
  shortTitle: z.string(),
  level: z.string().default('N5'),
  publisher: z.string().optional(),
  description: z.string().optional(),
  sourceFingerprint: z.string().optional(),
  outlineConfirmed: z.boolean().optional(),
  totalLessons: z.number().int().positive().optional(),
  lessons: z.array(TextbookLessonSchema).min(1),
}).superRefine((ast, ctx) => {
  // P1-C0.75 Task 3：同一 book 内 lesson.id 必须唯一（duplicate id 会让
  // shred 主键冲突/覆盖、reconciliation 无法区分）。 provisinal 生成已防碰撞；
  // 历史 AST 若有重复，只报告不修复（见 dry-run）。
  const seen = new Set<string>();
  ast.lessons.forEach((lesson, i) => {
    if (seen.has(lesson.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `lessons[${i}].id 重复: ${lesson.id}`,
        path: ['lessons', i, 'id'],
      });
    }
    seen.add(lesson.id);
  });
});
export type TextbookAST = z.infer<typeof TextbookASTSchema>;


/**
 * 安全解析教材 AST 数据，遵循 Result<T, BusinessError> 规范
 */
export function parseTextbookAST(raw: unknown): Result<TextbookAST, BusinessError> {
  const parsed = TextbookASTSchema.safeParse(raw);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return err(
      new BusinessError(
        'E_INVALID_TEXTBOOK_AST',
        `教材结构化格式不符合规范: ${errorDetails}`,
        'VALIDATION'
      )
    );
  }
  return ok(parsed.data);
}
