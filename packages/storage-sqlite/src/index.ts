/**
 * D2 M4 存储包唯一公共出口（白名单制）。
 * - `export * from './schema.js'` 为 verbatim 继承（前身 gateway db/index.ts，
 *   Drizzle 表定义的唯一透传），其余一律具名重导出，禁新增 `export *`；
 * - Gateway 保留数据库生命周期拥有（选库/装配/启停/health），本包只提供
 *   连接工厂与数据层实现（schema/DDL/迁移/种子/诊断/修复/排序）。
 */
export * from './schema.js';

export { createDrizzleDb, type DrizzleDb, type DrizzleInstance } from './connection.js';
export { initSchema, runMigrations, ensureDictionaryFts } from './ddl.js';
export { SCHEMA_MIGRATIONS, type SchemaMigration } from './migrations/index.js';
export { seedInitialData, pitchMeaningToGlosses } from './seed-bootstrap.js';
export { runDoctor, formatDoctorReport, type DoctorFinding, type DoctorReport } from './doctor.js';
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
export {
  planLessonOrdering,
  applyLessonOrdering,
  verifyDense,
  formatOrderingPlan,
  type LessonOrderingDocPlan,
  type LessonOrderingPlan,
  type LessonOrderingApplyResult,
} from './lesson-ordering.js';
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
  KANA_SEEDS,
  HANGUL_SEEDS,
  INITIAL_READING_SEEDS,
  LEARNING_CONTENT_TEMPLATE_SEEDS,
  PITCH_LEXICON,
  TEXTBOOK_BOOKS,
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
