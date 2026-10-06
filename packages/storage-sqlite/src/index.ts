/**
 * D2 M4 存储包唯一公共出口（白名单制）。
 * - `export * from './schema.js'` 为 verbatim 继承（前身 gateway db/index.ts，
 *   Drizzle 表定义的唯一透传），其余一律具名重导出，禁新增 `export *`；
 * - Gateway 保留数据库生命周期拥有（选库/装配/启停/health），本包只提供
 *   连接工厂与数据层实现（schema/DDL/迁移/种子/诊断/修复/排序）。
 */
export * from './schema.js';
export { collectVocabularyCardInTx, collectGlobalVocabulary, listVocabulary, saveVocabularyLearning, getVocabularyMasteryByJlpt, flashcardFromRow, readCardExamples } from './adapters/flashcards/vocabulary-cards.js';
export type { VocabularyLearningTarget, SaveVocabularyLearningInput, VocabularyMasteryRow } from './adapters/flashcards/vocabulary-cards.js';
export { writeTextbookContent, readTextbookMaterial, type TextbookScope, type ContentWriteReceipt } from './adapters/library/textbook-content.js';
export { completeTextbookChapter, textbookViewInTx, type CommitLessonKnowledgeOutput } from './adapters/library/textbook-view.js';
export { appendImportEvent, listImportEvents, getImportEvent } from './adapters/library/import-events.js';

export { createDrizzleDb, type DrizzleDb, type DrizzleInstance } from './connection.js';
export { initSchema, runMigrations, ensureDictionaryFts } from './ddl.js';
export { SCHEMA_MIGRATIONS, type SchemaMigration } from './migrations/index.js';
export { seedInitialData, pitchMeaningToGlosses } from './seed-bootstrap.js';
export { runDoctor, formatDoctorReport, type DoctorFinding, type DoctorReport } from './doctor.js';
export {
  exportDatabaseSnapshot,
  type ExportDatabaseSnapshotInput,
  type DatabaseSnapshotInfo,
} from './adapters/maintenance/db-backup.js';
export {
  buildRepairPlan,
  formatRepairPlan,
  type OrphanTarget,
  type NeedsDecisionImport,
  type SourceIdCandidate,
  type SeedShredCandidate,
  type RepairPlan,
} from './repair-plan.js';
export {
  applyOrphanCleanup,
  applySeedSourceFix,
  formatOrphanApplyReport,
  REPAIR_ALLOWLIST,
  type OrphanApplyRow,
  type OutsideAllowlist,
  type OrphanApplyReport,
  type SeedSourceApplyRow,
  type SeedSourceApplyReport,
} from './repair-apply.js';
export { canonicalJson, fingerprintCanonical } from './canonical-fingerprint.js';
export {
  getAnkiSettings,
  saveAnkiSettings,
  type AnkiPushSettings,
} from './adapters/flashcards/anki-settings.js';
export {
  toCardFormat,
  ensureBuiltinCardFormats,
  listCardFormats,
  narrowSaveCardFormatInput,
  saveCardFormat,
  resetCardFormat,
  getCardFormat,
  type SaveCardFormatInput,
} from './adapters/flashcards/card-formats.js';
export {
  storeMedia,
  readMediaBytes,
  detectMediaType,
  type StoredMedia,
} from './adapters/flashcards/media-store.js';
export {
  recordTermExposure,
  listEncounteredTerms,
  backfillEncounteredTermsFromHistory,
  recordReadingExposures,
  buildTermKey,
  type TermExposureSource,
  type EncounteredTermStatus,
  type EncounteredTerm,
  type RecordTermExposureInput,
  type ReadingExposureTerm,
  type RecordReadingExposuresInput,
} from './adapters/dictionary/encountered-terms.js';
export {
  saveReadingPosition,
  getReadingPosition,
  listDocumentLessonRefs,
  type ReadingPosition,
} from './adapters/document/reading-positions.js';
export {
  createImportTask,
  updateImportTask,
  getImportTask,
  type ImportTask,
  type ImportTaskStatus,
} from './adapters/document/import-tasks.js';
export {
  shredDocument,
  shredIntoTransaction,
  tryParseTextbookAst,
  termMapDedupKey,
  type ShredStats,
  type ShredTx,
} from './adapters/library/textbook-shred.js';
export {
  getTextbookFocus,
  type TextbookFocus,
} from './adapters/document/textbook-focus.js';
export { normalizeLessonDisplayTitle } from './adapters/document/lesson-display-title.js';
export {
  reconcileLessons,
  summarizeReconciliation,
  type ReconLessonInput,
} from './adapters/document/lesson-reconciliation.js';
export { getCourseRoute } from './adapters/learning-progress/course-route.js';
export {
  savePracticePlanTemplate,
  listPracticePlanTemplates,
  getPracticePlanTemplate,
  deletePracticePlanTemplate,
  setPracticePlanTemplateEnabled,
  copyPracticePlanTemplate,
  startPracticePlanRun,
  getPracticePlanRun,
  listPracticePlanRuns,
  savePracticeItemDraft,
  submitPracticeItem,
  listPracticeItemAttempts,
  getPracticeRunItems,
} from './adapters/practice/practice-plan.js';
export {
  recordAiArtifactRun,
  listAiArtifactRuns,
  artifactInputHash,
  type AiArtifactStatus,
  type AiArtifactRun,
  type RecordAiArtifactInput,
  type ListAiArtifactRunsInput,
} from './adapters/practice/ai-artifact-runs.js';
export {
  parseKanaPracticeMemory,
  readKanaPracticeMemories,
  saveKanaPracticeMemory,
} from './adapters/learning-progress/kana-practice-state.js';
export {
  listWordlists,
  bankJlptLevel,
  type WordlistWord,
  type WordlistGroup,
} from './adapters/dictionary/wordlists.js';
export {
  listLessons,
  completeLesson,
  listCompletedLessonSkills,
  listLessonSkills,
  type LessonSection,
  type LessonExample,
  type Lesson,
} from './adapters/curriculum/lessons.js';
export {
  resolveActiveLanguage,
  ensureLanguageProfile,
  mirrorLanguageProfileToMain,
} from './adapters/learning-progress/profile-internals.js';
export {
  KANA_SEEDS,
  HANGUL_SEEDS,
  INITIAL_READING_SEEDS,
  LEARNING_CONTENT_TEMPLATE_SEEDS,
  PITCH_LEXICON,
  LESSON_SEEDS,
  STARTER_WORD_SEEDS,
  N5_WORD_SEEDS,
  INITIAL_CARD_SEEDS,
  INITIAL_EN_CARD_SEEDS,
  INITIAL_QUESTION_SEEDS,
  INITIAL_EN_QUESTION_SEEDS,
  INITIAL_KO_QUESTION_SEEDS,
  INITIAL_MISTAKE_SEEDS,
  INITIAL_SKILL_METRIC_SEEDS,
  lookupPitchEntries,
  extractPitchQueryTokens,
  tryPitchLexiconCoachReply,
  formatPitchLexiconCoachReply,
  type PitchLexiconEntry,
} from './seeds/index.js';
export {
  projectContentSegments,
  listContentSegments,
  reprojectDocumentSegments,
  findDocumentsMissingSegments,
  chunkTextToSegments,
  isProjectionEligible,
  resolveProjectionEligibility,
  listTextbookLines,
  isLinesProjectionEligible,
  projectLinesSegments,
  findDocumentsMissingLineSegments,
  segmentHash,
  type ContentSegment,
  type ContentSegmentKind,
  type ProjectSegmentsInput,
  type TextChunk,
  type TextbookLineRef,
} from './adapters/library/content-segments.js';
export {
  ensureCanonicalContentSources,
  interpretSourceKind,
  getContentSource,
  type ContentSource,
  type InterpretedSourceKind,
} from './adapters/library/content-sources.js';
export {
  captureSelectionContext,
  type SelectionContext,
  type CaptureSelectionInput,
} from './adapters/library/selection-contexts.js';
export {
  saveKnowledgePoints,
  listKnowledgePoints,
  KNOWLEDGE_POINT_KINDS,
  type KnowledgePoint,
  type KnowledgePointKind,
  type SaveKnowledgePointInput,
} from './adapters/library/knowledge-points.js';
export {
  seedTextbookTocSkeleton,
  listTextbookLessonSlots,
  getTextbookAssetStats,
  type SeedTocSkeletonInput,
  type SavedTocSkeleton,
  type TextbookLessonSlotItem,
  type TextbookAssetStats,
} from './adapters/library/toc-skeleton.js';
export { getVisibleDocument, type VisibleDocument } from './adapters/library/document-visibility.js';
export * from './adapters/practice/textbook-attempts.js';
export { readTextbookChapter, commitTextbookLesson } from './adapters/library/lesson-content-transaction.js';
export { SqliteQuestionGenerationRepository } from './adapters/practice/question-generation-repository.js';
