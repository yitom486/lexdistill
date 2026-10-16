/**
 * M8-1 protocol 教材 AST 兼容 facade：实现已迁入 `@lexdistill/document-model`，
 * 此处仅作具名重导出，既有消费者行为不变。不使用重复实现，避免导出歧义。
 */
export {
  LanguageCodeSchema,
  type LanguageCode,
  TextbookVocabularySchema,
  type TextbookVocabulary,
  TextbookGrammarSchema,
  type TextbookGrammar,
  DialogueWordSchema,
  type DialogueWord,
  DialogueLineSchema,
  type DialogueLine,
  ExerciseItemSchema,
  type ExerciseItem,
  TextbookLessonSchema,
  type TextbookLesson,
  TextbookASTSchema,
  type TextbookAST,
  parseTextbookAST,
} from '@lexdistill/document-model';
