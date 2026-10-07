import { Database } from 'bun:sqlite';
import { submitObjectiveAnswer } from '../modules/practice/persistence/objective-answer.js';
import { submitBankObjectiveAnswer } from '../modules/practice/persistence/bank-answer.js';
import { submitBankSubjectiveAnswer } from '../modules/practice/persistence/bank-subjective-answer.js';
import { readBankGradingContext, settleBankSubjectiveGrade } from '../modules/practice/persistence/bank-grade.js';
import { suggestPreset } from '../modules/question-generation/suggest.js';
import { SqliteQuestionGenerationRepository } from '@study-studio/storage-sqlite';
import type { BankAnswerSubmit, BankGradeSubmit, ObjectiveAnswerInput } from '@study-studio/protocol';
import { prepareTextbookAttempt, getTextbookAttempt, claimTextbookGrade, settleTextbookGrade, textbookExerciseHistory } from '@study-studio/storage-sqlite';
import type { ExerciseGrade, SubmitTextbookExercise } from '@study-studio/protocol';
import type { TextbookGradeAudit, TextbookPracticeRepository } from '@study-studio/learner-core';
import { MASTERED_STABILITY_DAYS } from '@study-studio/learner-core';
import { eq } from 'drizzle-orm';
import { isOk, ok, err, type Result, BusinessError, translateToBusinessError } from '@study-studio/shared';
import type {
  LearnerRepository,
  QuizAttemptRecord,
  SkillMetric,
  LearnerProfileSnapshot,
  LearnerProfile,
  DailyTaskProgress,
  MistakeEntry,
  DailyStudyPlan,
  DailyPlanStepTemplate,
  AdaptiveKanaQueueOptions,
} from '@study-studio/learner-core';
import type {
  Flashcard,
  DocumentItem,
  AnnotationItem,
  KanaItem,
  HangulItem,
  HangulScriptType,
  ReadingPassageSet,
  SubmitReadingPractice,
  PracticeCollection,
  PracticeItem,
  GeneratedQuestion,
  CardReviewRating,
} from '@study-studio/protocol';
import { createDrizzleDb, type DrizzleDb, learnerLanguageProfiles, learnerProfiles } from '@study-studio/storage-sqlite';
import type {
  PracticePlanTemplate,
  PracticePlanRun,
  PracticeItemAttempt,
  PracticeBlockSpec,
  PracticeRunStatus,
  LearnerLevel,
} from '@study-studio/protocol';
import type { TextbookAST } from '@study-studio/document-model';

// P0-1 拆分：语种 / 词典 / 通用工具已下沉 domains；本地 import 供剩余方法使用，
// 底部 export 保持对外契约不变（index.ts 经 export * 转出）。
import type { TrackLanguage } from '@study-studio/shared';
import { normalizeTrackLanguage, inferLanguageFromSkillId } from '@study-studio/shared';
import type {
  LocalDictionaryEntry,
  DictionaryEntryCollection,
  DictionarySearchRecord,
} from '../modules/dictionary/persistence/dictionary.js';
import {
  searchLocalDictionary as searchLocalDictionaryDomain,
  collectDictionaryEntry as collectDictionaryEntryDomain,
  sampleLocalDictionaryEntries as sampleLocalDictionaryEntriesDomain,
  recordDictionarySearch as recordDictionarySearchDomain,
  getDictionarySearchHistory as getDictionarySearchHistoryDomain,
  updateDictionarySourceConfig as updateDictionarySourceConfigDomain,
} from '../modules/dictionary/persistence/dictionary.js';
import {
  recordTermExposure as recordTermExposureDomain,
  listEncounteredTerms as listEncounteredTermsDomain,
  backfillEncounteredTermsFromHistory as backfillEncounteredTermsFromHistoryDomain,
  recordReadingExposures as recordReadingExposuresDomain,
  type EncounteredTerm,
  type RecordTermExposureInput,
  type RecordReadingExposuresInput,
} from '@study-studio/storage-sqlite';
import type { AgentAdapter } from '@study-studio/agent-runtime';
import type { FsrsState, SchedulerOutput } from '@study-studio/learning-algorithms';
import type { ContentRepository } from '../modules/library/ports.js';
import type { LexiconRepository } from '../modules/dictionary/ports.js';
import type { LearningRepository } from '../modules/practice/ports.js';
import type { FlashcardsRepository } from '../modules/flashcards/ports.js';
import {
  getTermExamples as getTermExamplesDomain,
  type TermExampleItem,
} from '../modules/dictionary/application/term-examples.js';
import {
  proposeCardDrafts as proposeCardDraftsDomain,
  listCardDrafts as listCardDraftsDomain,
  updateCardDraft as updateCardDraftDomain,
  acceptCardDraft as acceptCardDraftDomain,
  dismissCardDraft as dismissCardDraftDomain,
  type CardDraft,
  type CardDraftStatus,
  type ProposeCardDraftInput,
  type UpdateCardDraftPatch,
} from '../modules/flashcards/persistence/card-drafts.js';
import {
  maybeEvaluateLevel as maybeEvaluateLevelDomain,
  getLevelInfo as getLevelInfoDomain,
  setTrackLevel as setTrackLevelDomain,
  type LevelChange,
} from '../modules/learning-progress/persistence/level.js';
import {
  startPlacementExam as startPlacementExamDomain,
  finishPlacementExam as finishPlacementExamDomain,
  isPlacementRunId as isPlacementRunIdDomain,
  getPlacementByRunId as getPlacementByRunIdDomain,
  type PlacementExam,
  type PlacementFinishResult,
} from '../modules/practice/persistence/placement.js';
import {
  saveReadingPosition as saveReadingPositionDomain,
  getReadingPosition as getReadingPositionDomain,
  listDocumentLessonRefs as listDocumentLessonRefsDomain,
  type ReadingPosition,
} from '@study-studio/storage-sqlite';
import {
  exportDatabaseSnapshot as exportDatabaseSnapshotDomain,
  type DatabaseSnapshotInfo,
} from '@study-studio/storage-sqlite';
import {
  listCardFormats as listCardFormatsDomain,
  saveCardFormat as saveCardFormatDomain,
  resetCardFormat as resetCardFormatDomain,
  type SaveCardFormatInput,
} from '@study-studio/storage-sqlite';
import {
  listLessons as listLessonsDomain,
  completeLesson as completeLessonDomain,
  listCompletedLessonSkills as listCompletedLessonSkillsDomain,
  listLessonSkills as listLessonSkillsDomain,
  type Lesson,
} from '@study-studio/storage-sqlite';
import {
  getTextbookFocus as getTextbookFocusDomain,
  type TextbookFocus,
} from '@study-studio/storage-sqlite';
import {
  getCourseRoute as getCourseRouteDomain,
} from '@study-studio/storage-sqlite';
import type { CourseRouteSnapshot } from '@study-studio/learner-core';
import {
  listWordlists as listWordlistsDomain,
  type WordlistGroup,
} from '@study-studio/storage-sqlite';
import {
  saveDocumentStructure as saveDocumentStructureDomain,
  getDocumentStructure as getDocumentStructureDomain,
  type SavedDocumentStructure,
} from '../modules/library/persistence/document-structure.js';
import {
  shredDocument as shredDocumentDomain,
  shredIntoTransaction as shredIntoTransactionDomain,
  reprojectDocumentSegments as reprojectDocumentSegmentsDomain,
  findDocumentsMissingSegments as findDocumentsMissingSegmentsDomain,
  projectLinesSegments as projectLinesSegmentsDomain,
  findDocumentsMissingLineSegments as findDocumentsMissingLineSegmentsDomain,
  listContentSegments as listContentSegmentsDomain,
  recordAiArtifactRun as recordAiArtifactRunDomain,
  listAiArtifactRuns as listAiArtifactRunsDomain,
  type ContentSegment,
  type RecordAiArtifactInput,
  type ListAiArtifactRunsInput,
  type AiArtifactRun,
  type ShredStats,
} from '@study-studio/storage-sqlite';
import {
  saveKnowledgePoints as saveKnowledgePointsDomain,
  listKnowledgePoints as listKnowledgePointsDomain,
} from '../modules/library/persistence/knowledge-points.js';
import type {
  SaveKnowledgePointInput,
  KnowledgePoint,
} from '@study-studio/storage-sqlite';
import type { StudyGateSnapshot } from '@study-studio/learner-core';
import {
  previewCard as previewCardDomain,
  type PreviewCardRequest,
  type PreviewCardResult,
} from '../modules/flashcards/application/card-preview.js';
import {
  getAnkiSettings as getAnkiSettingsDomain,
  saveAnkiSettings as saveAnkiSettingsDomain,
  type AnkiPushSettings,
} from '@study-studio/storage-sqlite';
import {
  pushCardToAnki as pushCardToAnkiDomain,
  type AnkiPushRequest,
  type AnkiPushResult,
} from '../modules/flashcards/application/anki-push.js';
import {
  importApkgNotes as importApkgNotesDomain,
  type ApkgImportNotesOptions,
  type ApkgImportNotesResult,
} from '../modules/flashcards/application/apkg-import.js';
import {
  exportApkgFromCards as exportApkgFromCardsDomain,
  type ApkgExportOptions,
  type ApkgExportResult,
} from '../modules/flashcards/application/apkg-export.js';
import {
  readMediaBytes as readMediaBytesDomain,
} from '@study-studio/storage-sqlite';
import { storeMedia as storeMediaDomain } from '@study-studio/storage-sqlite';
import type { StoredMedia } from '@study-studio/storage-sqlite';
import type { AnkiCardFormat } from '@study-studio/learner-core';
import {
  resolveActiveLanguage as resolveActiveLanguageDomain,
  ensureLanguageProfile as ensureLanguageProfileDomain,
  mirrorLanguageProfileToMain as mirrorLanguageProfileToMainDomain,
} from '@study-studio/storage-sqlite';
import {
  getLearnerProfile as getLearnerProfileDomain,
  updateLearnerProfile as updateLearnerProfileDomain,
  getProfileSnapshot as getProfileSnapshotDomain,
  saveSkillMetric as saveSkillMetricDomain,
} from '../modules/learning-progress/persistence/profile.js';
import {
  getDailyTaskProgress as getDailyTaskProgressDomain,
  getActivityHistory as getActivityHistoryDomain,
  recordDailyActivity as recordDailyActivityDomain,
  getOrCreateDailyStudyPlan as getOrCreateDailyStudyPlanDomain,
  completeDailyPlanStep as completeDailyPlanStepDomain,
} from '../modules/learning-progress/persistence/activity-plan.js';
import {
  getDueCards as getDueCardsDomain,
  getFlashcard as getFlashcardDomain,
  saveCard as saveCardDomain,
  markCardStudied as markCardStudiedDomain,
} from '../modules/review/persistence/cards.js';
import { commitReviewOutcome as commitReviewOutcomeDomain } from '../modules/review/persistence/review-outcome.js';
import {
  runWithTransaction,
  runWithSavepointSandbox,
} from './persistence/savepoints.js';
import {
  getQuestions as getQuestionsDomain,
  saveQuestion as saveQuestionDomain,
  saveQuestions as saveQuestionsDomain,
  recordQuizAttempt as recordQuizAttemptDomain,
  type PersistableQuestion,
} from '../modules/practice/persistence/questions.js';
import {
  saveMistake as saveMistakeDomain,
  getMistakes as getMistakesDomain,
  resolveMistake as resolveMistakeDomain,
  retryMistake as retryMistakeDomain,
} from '../modules/learning-progress/persistence/mistakes.js';
import {
  saveDocument as saveDocumentDomain,
  saveCanonicalAst as saveCanonicalAstDomain,
  listDocuments as listDocumentsDomain,
  getDocumentById as getDocumentByIdDomain,
  deleteDocument as deleteDocumentDomain,
  saveAnnotation as saveAnnotationDomain,
  listAnnotations as listAnnotationsDomain,
  deleteAnnotation as deleteAnnotationDomain,
  convertAnnotationToCard as convertAnnotationToCardDomain,
} from '../modules/library/persistence/documents-annotations.js';
import {
  createImportTask as createImportTaskDomain,
  updateImportTask as updateImportTaskDomain,
  getImportTask as getImportTaskDomain,
  type ImportTask,
  type ImportTaskStatus,
} from '@study-studio/storage-sqlite';
import {
  seedTextbookTocSkeleton as seedTextbookTocSkeletonDomain,
  writeTextbookContent, readTextbookMaterial, completeTextbookChapter, readTextbookChapter, commitTextbookLesson, type TextbookScope,
  appendImportEvent, listImportEvents, getImportEvent,
  listTextbookLessonSlots as listTextbookLessonSlotsDomain,
  getTextbookAssetStats as getTextbookAssetStatsDomain,
  type SeedTocSkeletonInput,
  type SavedTocSkeleton,
  type CommitLessonKnowledgeOutput,
  type TextbookLessonSlotItem,
  type TextbookAssetStats,
} from '@study-studio/storage-sqlite';
import {
  executeTextbookPipeline as executeTextbookPipelineDomain,
  type TextbookPipelineInput,
  type TextbookPipelineOutput,
} from '../modules/library/application/textbook-pipeline.js';
import {
  importDocument as importDocumentDomain,
  type DocumentImportInput,
  type DocumentImportOutput,
  type DocumentImportDeps,
} from '../modules/library/application/document-import/document-import-service.js';
import {
  getCurriculumKana as getCurriculumKanaDomain,
  getAdaptiveKanaQueue as getAdaptiveKanaQueueDomain,
  getCurriculumHangul as getCurriculumHangulDomain,
  listContentTemplates as listContentTemplatesDomain,
  listReadingSets as listReadingSetsDomain,
  saveReadingSet as saveReadingSetDomain,
} from '../modules/curriculum/persistence/curriculum-content.js';
import {
  recordKanaPractice as recordKanaPracticeDomain,
  recordHangulPractice as recordHangulPracticeDomain,
  recordReadingPractice as recordReadingPracticeDomain,
} from '../modules/learning-progress/persistence/learning-records.js';
import {
  getBeginnerTrail as getBeginnerTrailDomain,
  type BeginnerTrail,
} from '../modules/learning-progress/persistence/trail.js';
import {
  collectPracticeQuestions as collectPracticeQuestionsDomain,
  listPracticeCollections as listPracticeCollectionsDomain,
  listPracticeItems as listPracticeItemsDomain,
  convertPracticeItemsToCards as convertPracticeItemsToCardsDomain,
} from '../modules/practice/persistence/practice.js';
import {
  savePracticePlanTemplate as savePracticePlanTemplateDomain,
  listPracticePlanTemplates as listPracticePlanTemplatesDomain,
  getPracticePlanTemplate as getPracticePlanTemplateDomain,
  deletePracticePlanTemplate as deletePracticePlanTemplateDomain,
  setPracticePlanTemplateEnabled as setPracticePlanTemplateEnabledDomain,
  copyPracticePlanTemplate as copyPracticePlanTemplateDomain,
  startPracticePlanRun as startPracticePlanRunDomain,
  getPracticePlanRun as getPracticePlanRunDomain,
  listPracticePlanRuns as listPracticePlanRunsDomain,
  savePracticeItemDraft as savePracticeItemDraftDomain,
  submitPracticeItem as submitPracticeItemDomain,
  listPracticeItemAttempts as listPracticeItemAttemptsDomain,
  getPracticeRunItems as getPracticeRunItemsDomain,
} from '@study-studio/storage-sqlite';
import { finalizePracticePlanRun as finalizePracticePlanRunDomain } from '../modules/practice/persistence/practice-plan.js';
import {
  getTodayString,
  getYesterdayString,
  safeJsonParse,
  defaultLanguageProfileSeed,
} from '@study-studio/shared';
import type { RepoDeps } from './persistence/repo-context.js';
import { collectGlobalVocabulary, listVocabulary, getVocabularyEntry, saveVocabularyLearning as saveVocabularyLearningDomain, getVocabularyMasteryByJlpt } from '@study-studio/storage-sqlite';
import type { SaveVocabularyLearningInput } from '@study-studio/storage-sqlite';
import type { VocabularyScope } from '@study-studio/protocol';

export type {
  TrackLanguage,
  LocalDictionaryEntry,
  DictionaryEntryCollection,
  RepoDeps,
};
export {
  normalizeTrackLanguage,
  inferLanguageFromSkillId,
  getTodayString,
  getYesterdayString,
  safeJsonParse,
  defaultLanguageProfileSeed,
};

export class DrizzleLearnerRepository
  implements LearnerRepository, ContentRepository, LexiconRepository, LearningRepository, FlashcardsRepository, TextbookPracticeRepository
{
  // 本类是纯委托门面：每个方法一行，转调各域 persistence 实现；读法是“查目录→跳域文件”。
  // 分节速览（节内方法均以 `XXXDomain(this.deps, …)` 委托，冒号后为实现落点）：
  //  A 词典读/写      searchLocalDictionary…getTermExamples        → modules/dictionary/persistence/
  //  B 卡片草稿        proposeCardDrafts…dismissCardDraft           → modules/flashcards/persistence/
  //  C 课程与课文      getLevelInfo…listWordlists                   → modules/curriculum/persistence/
  //  D 文档段     saveDocumentStructure → modules/library/persistence/ + storage-sqlite
  //  D2 目录挂载知识点 saveKnowledgePoints/listKnowledgePoints     → modules/library/persistence/knowledge-points.ts
  //  E 定级与阅读      getStudyGate…getReadingPosition              → modules/practice/persistence/
  //  F 卡片格式/Anki/媒体 sampleLocalDictionaryEntries止           → modules/flashcards/persistence/ + tts-proxy
  //  G 画像与每日任务  getLearnerProfile…saveSkillMetric            → modules/learning-progress/persistence/
  //  H 卡片/题库/错题  getDueCards…commitReviewOutcome              → modules/review/persistence/ + practice + learning-progress
  //  I 文档与批注      saveDocument…（Documents/Annotations 节）    → modules/library/persistence/
  //  J 假名/谚文/阅读  getCurriculumKana…（Curriculum 节）          → modules/curriculum/persistence/
  //  K 练习集与计划    collectPracticeQuestions…末尾                → modules/practice/persistence/
  //  通用：withTransaction/withSavepointSandbox → infrastructure/persistence/savepoints.ts
  private readonly db: DrizzleDb;
  private readonly sqlite: Database;
  /** 建库路径（':memory:' 或外部传入 Database 时为标记值；备份导出需真实文件路径）。 */
  private readonly dbPath: string;

  constructor(dbOrPath: Database | string = ':memory:') {
    const instance = createDrizzleDb(dbOrPath);
    this.db = instance.db;
    this.sqlite = instance.sqlite;
    this.dbPath = typeof dbOrPath === 'string' ? dbOrPath : ':memory:';
  }

  public getRawDb(): Database {
    return this.sqlite;
  }

  private textbookCommand<T>(command: () => T, fallbackMessage = '作答记录保存或读取失败，请重试'): Promise<Result<T, BusinessError>> {
    try { return Promise.resolve(ok(command())); }
    catch (cause) { return Promise.resolve(err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage }))); }
  }
  public prepareTextbookAttempt(userId: string, input: SubmitTextbookExercise) { return this.textbookCommand(() => prepareTextbookAttempt(this.db, userId, input)); }
  public getTextbookAttempt(userId: string, id: string) { return this.textbookCommand(() => getTextbookAttempt(this.db, userId, id)); }
  public claimTextbookGrade(userId: string, id: string, gradingRunId: string) { return this.textbookCommand(() => claimTextbookGrade(this.db, userId, id, gradingRunId)); }
  public settleTextbookGrade(userId: string, id: string, audit: TextbookGradeAudit | undefined, grade: ExerciseGrade | undefined, errorCode?: string) { return this.textbookCommand(() => settleTextbookGrade(this.db, userId, id, audit, grade, errorCode)); }
  public textbookExerciseHistory(userId: string, documentId: string, chapterId: string) { return this.textbookCommand(() => textbookExerciseHistory(this.db, userId, documentId, chapterId)); }
  public listVocabulary(userId: string, language: string, scope: VocabularyScope = {}) { return this.textbookCommand(() => listVocabulary(this.db, userId, language, scope), '词汇库读取失败，请重试'); }
  public getVocabularyById(userId: string, language: string, vocabularyId: string) { return this.textbookCommand(() => getVocabularyEntry(this.db, userId, language, vocabularyId), '词汇读取失败，请重试'); }
  public getVocabularyMasteryByJlpt(userId: string, language: string) { return this.textbookCommand(() => getVocabularyMasteryByJlpt(this.db, userId, language, MASTERED_STABILITY_DAYS), '词汇掌握统计读取失败，请重试'); }
  public saveVocabularyLearning(userId: string, input: Omit<SaveVocabularyLearningInput, 'userId'>) { return this.textbookCommand(() => saveVocabularyLearningDomain(this.db, { ...input, userId }), '词汇讲解保存失败，请重试'); }
  public collectGlobalVocabulary(userId: string, vocabularyId: string, scope: VocabularyScope = {}) { return this.textbookCommand(() => collectGlobalVocabulary(this.db, userId, vocabularyId, scope), '词汇加入复习失败，请重试'); }
  public getFlashcard(userId: string, cardId: string) { return getFlashcardDomain(this.deps, userId, cardId); }

  // ==================== A 词典读/写（→ modules/dictionary/persistence/） ====================

  /**
   * 查询本地、可再分发的词典资产。第三方词典只可作为外链兜底，绝不在此抓取。
   * 实现已下沉 domains/dictionary.ts，此处仅委托。
   */
  public async searchLocalDictionary(
    language: TrackLanguage,
    query: string,
    limit = 20
  ): Promise<Result<LocalDictionaryEntry[], BusinessError>> {
    return searchLocalDictionaryDomain(this.deps, language, query, limit);
  }

  /**
   * 将一个已安装的本地词典条目收集为用户生词卡。
   * 词典内容仍保持公共只读资产；这里只创建或返回用户自己的 FSRS 状态。
   * 实现已下沉 domains/dictionary.ts，此处仅委托。
   */
  public async collectDictionaryEntry(
    userId: string,
    entryId: string
  ): Promise<Result<DictionaryEntryCollection, BusinessError>> {
    return collectDictionaryEntryDomain(this.deps, userId, entryId);
  }

  /**
   * 记录一次用户查词（画像“查过什么”信号源；失败静默，永不抛）。
   * 实现已下沉 dictionary 域，此处仅委托。
   */
  public async recordDictionarySearch(
    userId: string,
    language: TrackLanguage,
    query: string,
    hitCount: number,
    topEntryId?: string
  ): Promise<void> {
    return recordDictionarySearchDomain(this.deps, userId, language, query, hitCount, topEntryId);
  }

  /**
   * 最近查词（去重取最新，供面板快捷入口与画像消费）。
   * 实现已下沉 dictionary 域，此处仅委托。
   */
  public async getDictionarySearchHistory(
    userId: string,
    language: TrackLanguage,
    limit = 10
  ): Promise<Result<DictionarySearchRecord[], BusinessError>> {
    return getDictionarySearchHistoryDomain(this.deps, userId, language, limit);
  }

  /**
   * 记录一次相遇词（查词/收藏/阅读信号聚合；失败走 Result，由调用方定级）。
   * 实现已下沉 dictionary 域，此处仅委托。
   */
  public async recordTermExposure(
    input: RecordTermExposureInput
  ): Promise<Result<EncounteredTerm, BusinessError>> {
    return recordTermExposureDomain(this.deps, input);
  }

  /** 相遇词列表（按最近相遇倒序）。实现已下沉 dictionary 域，此处仅委托。 */
  public async listEncounteredTerms(
    userId: string,
    language: string,
    limit = 50
  ): Promise<Result<EncounteredTerm[], BusinessError>> {
    return listEncounteredTermsDomain(this.deps, userId, language, limit);
  }

  /** 查词历史冷启动回填相遇词。实现已下沉 dictionary 域，此处仅委托。 */
  public async backfillEncounteredTermsFromHistory(
    userId: string,
    language: string
  ): Promise<Result<{ terms: number; occurrences: number }, BusinessError>> {
    return backfillEncounteredTermsFromHistoryDomain(this.deps, userId, language);
  }

  /** 打开课次即记（reading 源，同课同天一次）。实现已下沉 dictionary 域，此处仅委托。 */
  public async recordReadingExposures(
    input: RecordReadingExposuresInput
  ): Promise<Result<{ recorded: number; skipped: boolean }, BusinessError>> {
    return recordReadingExposuresDomain(this.deps, input);
  }

  /**
   * 词条例句（缓存优先；未命中且有模型则生成入库）。
   * adapter 由调用方（路由层）传入，仓储不持有模型。
   */
  public async getTermExamples(
    input: { language: string; headword: string; reading?: string; meanings: string[] },
    adapter?: AgentAdapter | undefined
  ): Promise<Result<TermExampleItem[], BusinessError>> {
    return getTermExamplesDomain(this.deps, adapter, {
      language: input.language,
      headword: input.headword,
      ...(input.reading !== undefined ? { reading: input.reading } : {}),
      meanings: input.meanings,
    });
  }

  // ==================== B 卡片草稿（→ modules/flashcards/persistence/） ====================

  /** 批量提议生词草稿（幂等去重）。实现已下沉 flashcards 域，此处仅委托。 */
  public async proposeCardDrafts(
    inputs: ProposeCardDraftInput[]
  ): Promise<Result<CardDraft[], BusinessError>> {
    return proposeCardDraftsDomain(this.deps, inputs);
  }

  /** 草稿列表。实现已下沉 flashcards 域，此处仅委托。 */
  public async listCardDrafts(
    userId: string,
    language: string,
    status: CardDraftStatus = 'pending',
    limit = 50
  ): Promise<Result<CardDraft[], BusinessError>> {
    return listCardDraftsDomain(this.deps, userId, language, status, limit);
  }

  /** 用户逐字段改草稿。实现已下沉 flashcards 域，此处仅委托。 */
  public async updateCardDraft(
    userId: string,
    draftId: string,
    patch: UpdateCardDraftPatch
  ): Promise<Result<CardDraft, BusinessError>> {
    return updateCardDraftDomain(this.deps, userId, draftId, patch);
  }

  /** 接受草稿入库成卡。实现已下沉 flashcards 域，此处仅委托。 */
  public async acceptCardDraft(
    userId: string,
    draftId: string
  ): Promise<Result<{ draft: CardDraft; cardId: string }, BusinessError>> {
    return acceptCardDraftDomain(this.deps, userId, draftId);
  }

  /** 驳回草稿。实现已下沉 flashcards 域，此处仅委托。 */
  public async dismissCardDraft(
    userId: string,
    draftId: string
  ): Promise<Result<CardDraft, BusinessError>> {
    return dismissCardDraftDomain(this.deps, userId, draftId);
  }

  // ==================== C 课程与课文（→ modules/curriculum/persistence/ + learning-progress） ====================

  /** 档位信息（当前档 + 升级提示语）。实现已下沉 learning-progress 域，此处仅委托。 */
  public async getLevelInfo(
    userId: string,
    language: string
  ): Promise<Result<{ level: LearnerLevel; hint: string }, BusinessError>> {
    return getLevelInfoDomain(this.deps, userId, language);
  }

  /** 按轨道写档。实现已下沉 learning-progress 域，此处仅委托。 */
  public async setTrackLevel(
    userId: string,
    track: TrackLanguage,
    level: LearnerLevel
  ): Promise<Result<LearnerLevel, BusinessError>> {
    return setTrackLevelDomain(this.deps, userId, track, level);
  }

  /** 讲义列表（含学完态）。实现已下沉 curriculum 域，此处仅委托。 */
  public async listLessons(userId: string, language: string): Promise<Result<Lesson[], BusinessError>> {
    return listLessonsDomain(this.deps, userId, language);
  }

  /** 讲义学完打卡（幂等）。实现已下沉 curriculum 域，此处仅委托。 */
  public async completeLesson(
    userId: string,
    skillId: string
  ): Promise<Result<{ skillId: string; completedAt: string }, BusinessError>> {
    return completeLessonDomain(this.deps, userId, skillId);
  }

  /** 教材焦点（最近读到的教材课次；无记录返回 null）。实现已下沉 library 域，此处仅委托。 */
  public async getTextbookFocus(
    userId: string,
    language: string
  ): Promise<Result<TextbookFocus | null, BusinessError>> {
    return getTextbookFocusDomain(this.deps, userId, language);
  }

  /** 课程路线（求值 + 新掌握写档）。实现已下沉 learning-progress 域，此处仅委托。 */
  public async getCourseRoute(
    userId: string,
    language: string
  ): Promise<Result<CourseRouteSnapshot, BusinessError>> {
    return getCourseRouteDomain(this.deps, userId, language);
  }

  /** 零基础单词表（含已收/已学透态）。实现已下沉 dictionary 域，此处仅委托。 */
  public async listWordlists(
    userId: string,
    language: string
  ): Promise<Result<WordlistGroup[], BusinessError>> {
    return listWordlistsDomain(this.deps, userId, language);
  }

  // ==================== D 文档段/种子物化（→ modules/library/persistence/ + storage-sqlite） ====================

  /** 保存文档结构分类。实现已下沉 library 域，此处仅委托。 */
  public async saveDocumentStructure(
    userId: string,
    documentId: string,
    input: {
      headings: Array<{ page: number; text: string }>;
      classes: Array<{
        text: string;
        page: number;
        kind: 'lesson' | 'section' | 'toc' | 'noise';
        lessonNo: string | null;
        skillId: string | null;
      }>;
      model: string;
      effort: string;
      dropped: number;
    }
  ): Promise<Result<SavedDocumentStructure, BusinessError>> {
    return saveDocumentStructureDomain(this.deps, userId, documentId, input);
  }

  /** 读取文档结构分类（无记录返回 null）。实现已下沉 library 域，此处仅委托。 */
  public async getDocumentStructure(
    userId: string,
    documentId: string
  ): Promise<Result<SavedDocumentStructure | null, BusinessError>> {
    return getDocumentStructureDomain(this.deps, userId, documentId);
  }

  /**
   * AI-Native 教材端到端导入一条龙流水线。
   * 包含：任务台账 -> Phase 0 骨架优先校验建槽 -> Phase 1&2 Worker并发提炼与白名单回填 -> 任务终结。
   */
  public async executeTextbookPipeline(
    input: TextbookPipelineInput
  ): Promise<Result<TextbookPipelineOutput, BusinessError>> {
    return executeTextbookPipelineDomain(this, input);
  }

  /**
   * 目录优先骨架落库（单调递增强校验 + 槽位批量初始化）。
   */
  public async seedTextbookTocSkeleton(
    input: SeedTocSkeletonInput
  ): Promise<Result<SavedTocSkeleton, BusinessError>> {
    return seedTextbookTocSkeletonDomain(this.deps, input);
  }
  public writeTextbookContent(scope: TextbookScope, kind: import('@study-studio/document-model').TextbookContentKind, input: unknown) {
    return writeTextbookContent(this.deps, scope, kind, input);
  }
  public readTextbookMaterial(scope: TextbookScope) { return readTextbookMaterial(this.deps, scope); }
  public completeTextbookChapter(scope: TextbookScope) { return completeTextbookChapter(this.deps, scope); }
  public readTextbookChapter(scope: TextbookScope) { return readTextbookChapter(this.deps, scope); }
  public commitTextbookLesson(scope: TextbookScope, changes: readonly import('@study-studio/document-model').TextbookContentChange[]) { return commitTextbookLesson(this.deps, scope, changes); }

  public appendImportEvent(input: Parameters<typeof appendImportEvent>[1]) { return appendImportEvent(this.deps, input); }
  public listImportEvents(query: Parameters<typeof listImportEvents>[1]) { return listImportEvents(this.deps, query); }
  public getImportEvent(userId: string, traceId: string, sequence: number) { return getImportEvent(this.deps, userId, traceId, sequence); }

  /**
   * 章节内容提炼原子回填（TOC 白名单对齐核验 + 槽位状态翻转为 ready）。
   */

  /**
   * 查询指定教材文档已建立的章节槽位状态列表。
   */
  public async listTextbookLessonSlots(
    documentId: string
  ): Promise<Result<TextbookLessonSlotItem[], BusinessError>> {
    return listTextbookLessonSlotsDomain(this.deps, documentId);
  }

  /**
   * 极速统计指定教材在 SQLite 中的真实资产（课次、正文行、生词、语法、练习）。
   */
  public async getTextbookAssetStats(
    documentId: string
  ): Promise<Result<TextbookAssetStats, BusinessError>> {
    return getTextbookAssetStatsDomain(this.deps, documentId);
  }

  /**
   * 教材 shred（AST 大绳拆关系行 + FTS + 精确映射，同事务全删全插）。
   * AST 落库为主路径；调用方失败只 warn，不推翻已存课文。实现已下沉 library 域。
   */
  public async shredDocument(
    documentId: string,
    book: TextbookAST
  ): Promise<Result<ShredStats, BusinessError>> {
    return shredDocumentDomain(this.deps, documentId, book);
  }

  /**
   * 段显式重放（P2-1 恢复路径）：读行 content→切分→投影，hash 幂等；
   * 供脚本／测试／未来装配显式调用，不配路由／Tool。
   */
  public async reprojectDocumentSegments(
    userId: string,
    documentId: string
  ): Promise<Result<{ inserted: number; skipped: number }, BusinessError>> {
    return reprojectDocumentSegmentsDomain(this.deps, { userId, documentId });
  }

  /**
   * 待投影查询（P2-1 重试信号）：只读，不触发投影。
   */
  public async findDocumentsMissingSegments(
    userId?: string | undefined
  ): Promise<Result<Array<{ id: string; userId: string; sourceKind: string }>, BusinessError>> {
    return findDocumentsMissingSegmentsDomain(this.deps, userId);
  }

  /**
   * lines → segments 投影（P2-2a；提交后显式步骤，整单事务化；
   * 已有段整单跳过）。供 PDF／TOC／enrich／种子装配显式调用。
   */
  public async projectLinesSegments(
    userId: string,
    documentId: string
  ): Promise<Result<{ inserted: number; skipped: number; note?: string }, BusinessError>> {
    return projectLinesSegmentsDomain(this.deps, { userId, documentId });
  }

  /**
   * 待投影（lines）查询：有资格、lines＞0、尚无 segments。只读。
   */
  public async findDocumentsMissingLineSegments(
    userId?: string | undefined
  ): Promise<Result<Array<{ id: string; userId: string; sourceKind: string }>, BusinessError>> {
    return findDocumentsMissingLineSegmentsDomain(this.deps, userId);
  }

  /**
   * 列段（P3-2 文档 GET opt-in 桥）：只读，无隐式写入；未投影即空数组。
   */
  public async listContentSegments(
    documentId: string
  ): Promise<Result<ContentSegment[], BusinessError>> {
    return listContentSegmentsDomain(this.deps, documentId);
  }

  // ==================== D2 目录挂载知识点（→ modules/library/persistence/knowledge-points.ts） ====================

  /**
   * 蒸馏知识点幂等写入（v30；同键重存刷新释义，不增行）。
   * AI 提取/用户追问讲解的入库口；悬空（无 source_refs）合法。
   */
  public async saveKnowledgePoints(input: {
    documentId: string;
    lessonId: string;
    points: SaveKnowledgePointInput[];
  }): Promise<Result<{ saved: number; updated: number }, BusinessError>> {
    return saveKnowledgePointsDomain(this.deps, input.documentId, input.lessonId, input.points);
  }

  /**
   * 按文档（可选按课）列知识点；未提取即空数组。
   */
  public async listKnowledgePoints(
    documentId: string,
    lessonId?: string
  ): Promise<Result<KnowledgePoint[], BusinessError>> {
    return listKnowledgePointsDomain(this.deps, documentId, lessonId);
  }

  /**
   * AI 运行审计写入（P4-1；只插不改）。供批改等 Tool 经门面调用，
   * Tool 不得直调 getRawDb（G5 边界锁）。
   */
  public async recordAiArtifactRun(
    input: RecordAiArtifactInput
  ): Promise<Result<AiArtifactRun, BusinessError>> {
    return recordAiArtifactRunDomain(this.deps, input);
  }

  /**
   * AI 运行审计只读（P4-2 item2）：按 userId 精确过滤，未接路由／Tool。
   */
  public async listAiArtifactRuns(
    input: ListAiArtifactRunsInput
  ): Promise<Result<AiArtifactRun[], BusinessError>> {
    return listAiArtifactRunsDomain(this.deps, input);
  }

  /**
   * 整库只读快照导出（P5-1）：检查点＋拷贝＋校验＋原子落盘。
   * 目标路径由调用方（桌面 save-dialog）提供；取消即不调用，零副作用。
   */
  public async exportDatabaseSnapshot(
    targetPath: string
  ): Promise<Result<DatabaseSnapshotInfo, BusinessError>> {
    return exportDatabaseSnapshotDomain(this.deps, {
      sourcePath: this.dbPath,
      targetPath,
    });
  }

  // ==================== E 定级与阅读位置（→ modules/practice/persistence/） ====================

  /**
   * 出题门快照（档位 + 已学完技能 + 本轨道有讲义技能；一次取齐，四个出题口复用）。
   * 档位读不到整体 err（调用方 fail-open，不过门）。
   */
  public async getStudyGate(
    userId: string,
    language: string
  ): Promise<Result<StudyGateSnapshot, BusinessError>> {
    const levelRes = await getLevelInfoDomain(this.deps, userId, language);
    if (!isOk(levelRes)) return err(levelRes.error);
    const completedRes = await listCompletedLessonSkillsDomain(this.deps, userId);
    if (!isOk(completedRes)) return err(completedRes.error);
    const lessonsRes = await listLessonSkillsDomain(this.deps, language);
    if (!isOk(lessonsRes)) return err(lessonsRes.error);
    return ok({
      level: levelRes.value.level,
      completedSkills: completedRes.value,
      lessonSkills: lessonsRes.value,
    });
  }

  /** 定级考开考（跳级通道）。实现已下沉 practice 域，此处仅委托。 */
  public async startPlacementExam(
    userId: string,
    track: TrackLanguage,
    targetLevel: LearnerLevel
  ): Promise<Result<{ exam: PlacementExam; runId: string }, BusinessError>> {
    return startPlacementExamDomain(this.deps, userId, track, targetLevel);
  }

  /** 定级考交卷（过线写档）。实现已下沉 practice 域，此处仅委托。 */
  public async finishPlacementExam(
    userId: string,
    examId: string
  ): Promise<Result<PlacementFinishResult, BusinessError>> {
    return finishPlacementExamDomain(this.deps, userId, examId);
  }

  /** 是否定级考 run（装配难度门豁免判定；同步查询，查不到返回 false）。 */
  public isPlacementRun(runId: string): boolean {
    return isPlacementRunIdDomain(this.deps, runId);
  }

  /** 按 run 取考试（含冻结蓝图；查不到返回 null）。 */
  public async getPlacementByRunId(runId: string): Promise<PlacementExam | null> {
    return getPlacementByRunIdDomain(this.deps, runId);
  }

  /**
   * M1-2 学习域能力：已终结定级考计数（passed/failed；装配轮换偏移用，查不到计 0）。
   * 收敛 practice-assembly 内联 SQL，使上层只依赖能力接口。
   */
  public async countPlacementAttempts(userId: string, targetLevel: string): Promise<number> {
    try {
      const row = this.sqlite
        .query(
          `SELECT COUNT(*) AS n FROM placement_exams
           WHERE user_id = ? AND target_level = ? AND status IN ('passed', 'failed')`
        )
        .get(userId, targetLevel) as { n: number } | null;
      return row?.n ?? 0;
    } catch {
      return 0;
    }
  }

  /** 保存阅读位置（每用户每文档一条 upsert）。实现已下沉 library 域，此处仅委托。 */
  public async saveReadingPosition(
    userId: string,
    documentId: string,
    locator: unknown
  ): Promise<Result<ReadingPosition, BusinessError>> {
    return saveReadingPositionDomain(this.deps, userId, documentId, locator);
  }

  /** 读取阅读位置（无记录返回 null）。实现已下沉 library 域，此处仅委托。 */
  public async getReadingPosition(
    userId: string,
    documentId: string
  ): Promise<Result<ReadingPosition | null, BusinessError>> {
    return getReadingPositionDomain(this.deps, userId, documentId);
  }

  /**
   * 列出某文档下 locator 引用的 lessonId（只读，不含用户身份；shadow 风险评估用）。
   */
  public async listDocumentLessonRefs(documentId: string): Promise<Result<string[], BusinessError>> {
    return listDocumentLessonRefsDomain(this.deps, documentId);
  }

  // ==================== F 卡片格式/Anki/媒体（→ modules/flashcards/persistence/） ====================

  /**
   * 词典包配置更新（开关 / 排序权重）。
   * 实现已下沉 dictionary 域，此处仅委托。
   */
  public async updateDictionarySourceConfig(
    sourceId: string,
    patch: { enabled?: boolean; priority?: number }
  ): Promise<Result<{ id: string; enabled: boolean; priority: number }, BusinessError>> {
    return updateDictionarySourceConfigDomain(this.deps, sourceId, patch);
  }

  /**
   * 卡片模板包：列出全部（含内置懒播种）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async listCardFormats(): Promise<Result<AnkiCardFormat[], BusinessError>> {
    return listCardFormatsDomain(this.deps);
  }

  /**
   * 卡片模板包：保存（新建或覆盖；校验不通过拒绝写入）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async saveCardFormat(
    input: SaveCardFormatInput
  ): Promise<Result<AnkiCardFormat, BusinessError>> {
    return saveCardFormatDomain(this.deps, input);
  }

  /**
   * 卡片模板包：恢复内置版本（仅内置 id）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async resetCardFormat(id: string): Promise<Result<AnkiCardFormat, BusinessError>> {
    return resetCardFormatDomain(this.deps, id);
  }

  /**
   * 卡片预览：模板 + 条目 → 字段/正反面 HTML（草稿只渲染不入库）。
   * HTTP 预览与 `flashcards.render` Tool 共用此命令。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async previewCardFormat(
    request: PreviewCardRequest
  ): Promise<Result<PreviewCardResult, BusinessError>> {
    return previewCardDomain(this.deps, request);
  }

  /**
   * Anki 推送开关读/写（默认关闭；TTS 凭证永不落盘）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async getAnkiPushSettings(): Promise<AnkiPushSettings> {
    return getAnkiSettingsDomain(this.deps);
  }

  public async saveAnkiPushSettings(
    patch: { enabled?: boolean; endpoint?: string }
  ): Promise<Result<AnkiPushSettings, BusinessError>> {
    return saveAnkiSettingsDomain(this.deps, patch);
  }

  /**
   * 生词卡推送本机 Anki（HTTP 与 flashcards.anki_push Tool 共用此命令）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async pushCardToAnki(
    request: AnkiPushRequest
  ): Promise<Result<AnkiPushResult, BusinessError>> {
    return pushCardToAnkiDomain(this.deps, fetch, request);
  }

  /**
   * `.apkg` 笔记搬家：笔记 → 用户 FSRS 卡（进度一律 NEW，去重，媒体只计数）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async importApkgNotes(
    bytes: Uint8Array,
    options: ApkgImportNotesOptions
  ): Promise<Result<ApkgImportNotesResult, BusinessError>> {
    return importApkgNotesDomain(this.deps, bytes, options);
  }

  /**
   * `.apkg` 导出：用户 FSRS 卡 → Anki 包（移动端同步通道；进度不导出）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async exportApkgFile(
    options: ApkgExportOptions
  ): Promise<Result<ApkgExportResult, BusinessError>> {
    return exportApkgFromCardsDomain(this.deps, options);
  }

  /**
   * 用户媒体库读取（内容寻址；哈希即权限）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async readMediaFile(
    fileHash: string,
    mediaRoot?: string
  ): Promise<Result<{ bytes: Uint8Array; mediaType: string }, BusinessError>> {
    return readMediaBytesDomain(this.deps, fileHash, mediaRoot);
  }

  /**
   * 用户媒体库写入（内容寻址去重；mediaRoot 仅单测注入）。
   * 实现已下沉 flashcards 域，此处仅委托。
   */
  public async storeMediaFile(
    sourceId: string,
    filename: string,
    bytes: Uint8Array,
    mediaRoot?: string
  ): Promise<Result<StoredMedia, BusinessError>> {
    return storeMediaDomain(this.deps, sourceId, filename, bytes, mediaRoot);
  }

  /**
   * 随机抽取本地词典条目（假名单词听写等系统随机出题场景）。
   * 实现已下沉 dictionary 域，此处仅委托。
   */
  public async sampleLocalDictionaryEntries(
    language: TrackLanguage,
    limit = 10
  ): Promise<Result<LocalDictionaryEntry[], BusinessError>> {
    return sampleLocalDictionaryEntriesDomain(this.deps, language, limit);
  }

  private get deps(): RepoDeps {
    return { db: this.db, sqlite: this.sqlite, repo: this };
  }

  private async resolveActiveLanguage(userId: string): Promise<TrackLanguage> {
    return resolveActiveLanguageDomain(this.deps, userId);
  }

  private async ensureLanguageProfile(
    userId: string,
    language: TrackLanguage,
    seed?: Partial<{
      studyGoal: string;
      learnerLevel: string;
      overallLevel: string;
      overallProficiency: number;
      streakDays: number;
      maxStreakDays: number;
      lastActiveDate: string | null;
      retentionRate: number;
      dailyGoalQuizzes: number;
      dailyGoalCards: number;
      totalStudyMinutes: number;
      totalCardsReviewed: number;
      totalQuizzesAnswered: number;
    }>
  ): Promise<typeof learnerLanguageProfiles.$inferSelect> {
    return ensureLanguageProfileDomain(this.deps, userId, language, seed);
  }

  private async mirrorLanguageProfileToMain(
    userId: string,
    language: TrackLanguage,
    langRow: typeof learnerLanguageProfiles.$inferSelect,
    displayName?: string
  ): Promise<void> {
    return mirrorLanguageProfileToMainDomain(this.deps, userId, language, langRow, displayName);
  }

  // ==================== G 画像与每日任务（→ modules/learning-progress/persistence/） ====================

  /**
   * 实现已下沉 domains/profile.ts，此处仅委托。
   */
  public async getLearnerProfile(userId: string, language?: string): Promise<Result<LearnerProfile, BusinessError>> {
    return getLearnerProfileDomain(this.deps, userId, language);
  }

  /**
   * 实现已下沉 domains/profile.ts，此处仅委托。
   */
  public async updateLearnerProfile(
    userId: string,
    input: Partial<LearnerProfile>
  ): Promise<Result<LearnerProfile, BusinessError>> {
    return updateLearnerProfileDomain(this.deps, userId, input);
  }

  /**
   * 实现已下沉 domains/activity-plan.ts，此处仅委托。
   */
  public async getDailyTaskProgress(
    userId: string,
    date?: string,
    language?: string
  ): Promise<Result<DailyTaskProgress, BusinessError>> {
    return getDailyTaskProgressDomain(this.deps, userId, date, language);
  }

  /**
   * 实现已下沉 domains/activity-plan.ts，此处仅委托。
   */
  public async getActivityHistory(
    userId: string,
    days: number = 28,
    targetLanguage?: TrackLanguage | string
  ): Promise<Result<DailyTaskProgress[], BusinessError>> {
    return getActivityHistoryDomain(this.deps, userId, days, targetLanguage);
  }

  /**
   * 在独立事务中执行操作（回调 resolve 即提交，throw 即整体回滚）。
   * 实现已下沉 infrastructure/persistence/savepoints.ts，此处仅委托。
   */
  public async withTransaction<T>(
    fn: (repo: DrizzleLearnerRepository) => Promise<T>
  ): Promise<T> {
    return runWithTransaction(this.sqlite, () => fn(this));
  }

  /**
   * 使用 SAVEPOINT 进行沙盒测试执行，并在执行完毕后无条件回滚，确保测试数据绝不污染真实数据库。
   * 实现已下沉 infrastructure/persistence/savepoints.ts，此处仅委托。
   */
  public async withSavepointSandbox<T>(
    fn: (repo: DrizzleLearnerRepository) => Promise<T>
  ): Promise<T> {
    return runWithSavepointSandbox(this.sqlite, () => fn(this));
  }

  /**
   * 实现已下沉 domains/activity-plan.ts，此处仅委托。
   */
  public async recordDailyActivity(
    userId: string,
    delta: {
      quizzes?: number;
      cards?: number;
      listeningMinutes?: number;
      mistakesResolved?: number;
      reading?: number;
      kanaDrills?: number;
      hangulDrills?: number;
      date?: string;
      language?: TrackLanguage | string;
    }
  ): Promise<Result<DailyTaskProgress, BusinessError>> {
    return recordDailyActivityDomain(this.deps, userId, delta);
  }

  /**
   * 实现已下沉 domains/activity-plan.ts，此处仅委托。
   */
  public async getOrCreateDailyStudyPlan(
    userId: string,
    date?: string,
    language?: string
  ): Promise<Result<DailyStudyPlan, BusinessError>> {
    return getOrCreateDailyStudyPlanDomain(this.deps, userId, date, language);
  }

  /**
   * 实现已下沉 domains/activity-plan.ts，此处仅委托。
   */
  public async completeDailyPlanStep(
    userId: string,
    stepId: string,
    date?: string,
    language?: string
  ): Promise<Result<DailyStudyPlan, BusinessError>> {
    return completeDailyPlanStepDomain(this.deps, userId, stepId, date, language);
  }

  /**
   * 实现已下沉 domains/profile.ts，此处仅委托。
   */
  public async getProfileSnapshot(
    userId: string,
    langOverride?: string
  ): Promise<Result<LearnerProfileSnapshot, BusinessError>> {
    return getProfileSnapshotDomain(this.deps, userId, langOverride);
  }

  /**
   * 实现已下沉 domains/profile.ts，此处仅委托。
   */
  public async saveSkillMetric(
    userId: string,
    metric: SkillMetric
  ): Promise<Result<void, BusinessError>> {
    return saveSkillMetricDomain(this.deps, userId, metric);
  }

  // ==================== H 卡片/题库/错题/复习提交（→ modules/review + practice + learning-progress） ====================

  /**
   * 实现已下沉 domains/cards-questions.ts，此处仅委托。
   */
  public async getDueCards(
    userId: string,
    limit: number = 500,
    options?: { dueOnly?: boolean; language?: string }
  ): Promise<Result<Flashcard[], BusinessError>> {
    return getDueCardsDomain(this.deps, userId, limit, options);
  }

  /**
   * 实现已下沉 domains/cards-questions.ts，此处仅委托。
   */
  public async getQuestions(
    userId: string,
    limit: number = 50,
    langOverride?: string,
    filter?: {
      types?: string[] | undefined;
      difficulty?: number | undefined;
      skillIds?: string[] | undefined;
    }
  ): Promise<Result<PersistableQuestion[], BusinessError>> {
    return getQuestionsDomain(this.deps, userId, limit, langOverride, filter);
  }

  /**
   * 实现已下沉 domains/cards-questions.ts，此处仅委托。
   */
  public async saveQuestion(question: PersistableQuestion): Promise<Result<void, BusinessError>> {
    return saveQuestionDomain(this.deps, question);
  }

  /**
   * 实现已下沉 domains/cards-questions.ts，此处仅委托。
   */
  public async saveQuestions(questions: PersistableQuestion[]): Promise<Result<void, BusinessError>> {
    return saveQuestionsDomain(this.deps, questions);
  }

  /**
   * 实现已下沉 domains/cards-questions.ts，此处仅委托。
   */
  public async saveCard(card: Flashcard): Promise<Result<void, BusinessError>> {
    return saveCardDomain(this.deps, card);
  }

  /**
   * 标记讲透（M2 学习门；幂等）。实现已下沉 review 域，此处仅委托。
   */
  public async markCardStudied(
    userId: string,
    cardId: string
  ): Promise<Result<{ cardId: string; studiedAt: string }, BusinessError>> {
    return markCardStudiedDomain(this.deps, userId, cardId);
  }

  /**
   * 实现已下沉 domains/cards-questions.ts，此处仅委托。
   */
  public async recordQuizAttempt(
    attempt: QuizAttemptRecord
  ): Promise<Result<void, BusinessError>> {
    const res = await recordQuizAttemptDomain(this.deps, attempt);
    if (isOk(res)) {
      // 等级自动边：做题落盘后求值一次；失败静默，不挡主路径。
      await maybeEvaluateLevelDomain(this.deps, attempt.userId, inferLanguageFromSkillId(attempt.testedSkillId));
    }
    return res;
  }

  public submitObjectiveAnswer(userId: string, input: ObjectiveAnswerInput) {
    return submitObjectiveAnswer(this.deps, userId, input);
  }

  /**
   * P2 新题库作答：经试卷快照判分并写入同一 quiz_attempts/mistakes 事实表。
   * 实现已下沉 practice/persistence/bank-answer，此处仅委托（与客观入口同口径）。
   */
  public submitBankObjectiveAnswer(userId: string, input: BankAnswerSubmit) {
    return submitBankObjectiveAnswer({ ...this.deps, bank: new SqliteQuestionGenerationRepository(this.sqlite) }, userId, input);
  }

  public submitBankSubjectiveAnswer(userId: string, input: BankAnswerSubmit) {
    return submitBankSubjectiveAnswer({ ...this.deps, bank: new SqliteQuestionGenerationRepository(this.sqlite) }, userId, input);
  }

  public readBankGradingContext(userId: string, input: BankGradeSubmit) {
    return readBankGradingContext({ ...this.deps, bank: new SqliteQuestionGenerationRepository(this.sqlite) }, userId, input);
  }

  public settleBankSubjectiveGrade(userId: string, input: BankGradeSubmit,
    outcome: Parameters<typeof settleBankSubjectiveGrade>[3]) {
    return settleBankSubjectiveGrade({ ...this.deps, bank: new SqliteQuestionGenerationRepository(this.sqlite) }, userId, input, outcome);
  }

  /**
   * P4 出题建议：只读画像目标语种、未解决错题与授权教材数，不做复杂画像，
   * 无数据用可见默认值。实现为纯函数（suggestPreset），此处仅组装事实源。
   */
  public async suggestGenerationPreset(userId: string, language?: string) {
    if (!userId.trim()) throw new BusinessError('E_GENERATION_SCOPE', '任务归属不正确', 'SECURITY');
    const [profile] = await this.db.select({ targetLanguage: learnerProfiles.targetLanguage }).from(learnerProfiles)
      .where(eq(learnerProfiles.userId, userId)).limit(1);
    const track = (language === 'ja' || language === 'ko' || language === 'en') ? language
      : (profile?.targetLanguage === 'ja' || profile?.targetLanguage === 'ko' ? profile.targetLanguage : 'en');
    const mistakes = await this.getMistakes(userId, { resolved: false, language: track });
    if (!isOk(mistakes)) throw mistakes.error;
    const course = this.sqlite.query('SELECT count(*) AS n FROM documents WHERE user_id=? AND language=?').get(
      userId, track) as { n: number };
    return suggestPreset({
      requestedLanguage: language === 'ja' || language === 'ko' || language === 'en' ? language : undefined,
      profileLanguage: profile?.targetLanguage ?? null,
      unresolvedMistakeSkillIds: mistakes.value.map(entry => entry.question.testedSkillId).filter((skill): skill is string => typeof skill === 'string'),
      textbookCount: course.n,
    });
  }

  /**
   * 实现已下沉 domains/mistakes.ts，此处仅委托。
   */
  public async saveMistake(mistake: MistakeEntry): Promise<Result<void, BusinessError>> {
    return saveMistakeDomain(this.deps, mistake);
  }

  /**
   * 实现已下沉 domains/mistakes.ts，此处仅委托。
   */
  public async getMistakes(
    userId: string,
    filter?: { resolved?: boolean; language?: string }
  ): Promise<Result<MistakeEntry[], BusinessError>> {
    return getMistakesDomain(this.deps, userId, filter);
  }

  /**
   * 实现已下沉 domains/mistakes.ts，此处仅委托。
   */
  public async resolveMistake(mistakeId: string): Promise<Result<void, BusinessError>> {
    return resolveMistakeDomain(this.deps, mistakeId);
  }

  /**
   * 实现已下沉 domains/mistakes.ts，此处仅委托。
   */
  public async retryMistake(
    userId: string,
    mistakeId: string,
    isCorrect: boolean
  ): Promise<Result<Pick<MistakeEntry, 'consecutiveCorrect' | 'isResolved' | 'retryCount'>, BusinessError>> {
    return retryMistakeDomain(this.deps, userId, mistakeId, isCorrect);
  }

  /**
   * M4-2 复习提交原子命令（review 域）。
   * 实现已下沉 modules/review/persistence/review-outcome.ts，此处仅委托。
   */
  public async commitReviewOutcome(input: {
    userId: string;
    card: Flashcard;
    rating: CardReviewRating;
    scheduled: SchedulerOutput<FsrsState>;
  }): Promise<Result<{ cardId: string; eventId: string }, BusinessError>> {
    return commitReviewOutcomeDomain(this.deps, input);
  }

  // ==================== 文档与教材资产 (Documents) ====================

  /**
   * 实现已下沉 domains/documents-annotations.ts，此处仅委托。
   */
  public async saveDocument(doc: DocumentItem): Promise<Result<DocumentItem, BusinessError>> {
    return saveDocumentDomain(this.deps, doc);
  }

  /**
   * 唯一 canonical AST 写入口（documents 写回 + shred 同一事务；失败整体回滚）。
   */
  public async saveCanonicalAst(
    docBase: Omit<DocumentItem, 'astJson'>,
    book: TextbookAST
  ): Promise<Result<DocumentItem, BusinessError>> {
    return saveCanonicalAstDomain(this.deps, docBase, book);
  }

  /**
   * 实现已下沉 domains/documents-annotations.ts，此处仅委托。
   */
  public async listDocuments(
    userId: string,
    sourceKind?: string
  ): Promise<Result<DocumentItem[], BusinessError>> {
    return listDocumentsDomain(this.deps, userId, sourceKind);
  }

  /**
   * 实现已下沉 domains/documents-annotations.ts，此处仅委托。
   */
  public async getDocumentById(id: string): Promise<Result<DocumentItem | null, BusinessError>> {
    return getDocumentByIdDomain(this.deps, id);
  }

  /**
   * 实现已下沉 domains/documents-annotations.ts，此处仅委托。
   */
  public async deleteDocument(id: string, userId: string): Promise<Result<void, BusinessError>> {
    return deleteDocumentDomain(this.deps, id, userId);
  }

  /**
   * 文档导入任务：建任务 / 更新状态 / 读取（读侧永不抛，由领域返回 undefined）。
   * 实现已下沉 library/persistence/import-tasks.ts，此处仅委托。
   */
  public async createImportTask(input: {
    userId: string;
    sourceKind: ImportTask['sourceKind'];
    filename: string;
  }): Promise<Result<ImportTask, BusinessError>> {
    return createImportTaskDomain(this.deps, input);
  }

  public async updateImportTask(
    id: string,
    patch: { status: ImportTaskStatus; documentId?: string; lessons?: number; error?: string }
  ): Promise<Result<ImportTask, BusinessError>> {
    return updateImportTaskDomain(this.deps, id, patch);
  }

  public async getImportTask(id: string): Promise<ImportTask | undefined> {
    return getImportTaskDomain(this.deps, id);
  }

  /**
   * 文档统一导入（PDF/EPUB/文本同一命令；任务落库，失败可重发）。
   * 实现已下沉 library/application/document-import，此处仅委托。
   */
  public async importDocumentFile(
    input: DocumentImportInput,
    readers?: DocumentImportDeps
  ): Promise<Result<DocumentImportOutput, BusinessError>> {
    return importDocumentDomain(this.deps, readers ?? {}, input);
  }

  // ==================== 划线高亮与批注 (Annotations) ====================

  /**
   * 实现已下沉 domains/documents-annotations.ts，此处仅委托。
   */
  public async saveAnnotation(ann: AnnotationItem): Promise<Result<AnnotationItem, BusinessError>> {
    return saveAnnotationDomain(this.deps, ann);
  }

  /**
   * 实现已下沉 domains/documents-annotations.ts，此处仅委托。
   */
  public async listAnnotations(
    documentId: string,
    userId: string
  ): Promise<Result<AnnotationItem[], BusinessError>> {
    return listAnnotationsDomain(this.deps, documentId, userId);
  }

  /**
   * 实现已下沉 domains/documents-annotations.ts，此处仅委托。
   */
  public async deleteAnnotation(
    annotationId: string,
    userId: string
  ): Promise<Result<void, BusinessError>> {
    return deleteAnnotationDomain(this.deps, annotationId, userId);
  }

  /**
   * 实现已下沉 domains/documents-annotations.ts，此处仅委托。
   */
  public async convertAnnotationToCard(
    annotationId: string,
    userId: string,
    cardData: {
      front: string;
      back: string;
      tag?: string | undefined;
      pos?: string | undefined;
      phonetic?: string | undefined;
    }
  ): Promise<Result<Flashcard, BusinessError>> {
    return convertAnnotationToCardDomain(this.deps, annotationId, userId, cardData);
  }

  // ==================== 五十音课程底座 (Curriculum Kana) ====================

  /**
   * 实现已下沉 domains/curriculum-reading.ts，此处仅委托。
   */
  public async getCurriculumKana(
    type?: string
  ): Promise<Result<KanaItem[], BusinessError>> {
    return getCurriculumKanaDomain(this.deps, type);
  }

  /** 按用户逐项复习状态获取本轮假名题目。 */
  public async getAdaptiveKanaQueue(
    userId: string,
    options?: AdaptiveKanaQueueOptions
  ): Promise<Result<KanaItem[], BusinessError>> {
    return getAdaptiveKanaQueueDomain(this.deps, userId, options);
  }

  // ==================== 谚文字母课程底座 (Curriculum Hangul) ====================

  /**
   * 实现已下沉 curriculum 域，此处仅委托。
   */
  public async getCurriculumHangul(
    type?: string
  ): Promise<Result<HangulItem[], BusinessError>> {
    return getCurriculumHangulDomain(this.deps, type);
  }

  /**
   * 实现已下沉 learning-progress 域，此处仅委托。
   */
  public async recordHangulPractice(
    userId: string,
    hangulId: string,
    isCorrect: boolean,
    scriptType: HangulScriptType = 'CONSONANT'
  ): Promise<Result<{ proficiency: number }, BusinessError>> {
    const res = await recordHangulPracticeDomain(this.deps, userId, hangulId, isCorrect, scriptType);
    if (isOk(res)) {
      await maybeEvaluateLevelDomain(this.deps, userId, 'ko');
    }
    return res;
  }

  /**
   * 实现已下沉 domains/curriculum-reading.ts，此处仅委托。
   */
  public async listContentTemplates(options: {
    action: string;
    language: string;
    skillId?: string | undefined;
    format?: string | undefined;
    genre?: string | undefined;
    limit?: number | undefined;
  }): Promise<
    Result<
      Array<{
        id: string;
        language: string;
        action: string;
        format: string | null;
        skillId: string | null;
        difficulty: number;
        topic: string | null;
        genre: string | null;
        sortOrder: number;
        payload: Record<string, unknown>;
      }>,
      BusinessError
    >
  > {
    return listContentTemplatesDomain(this.deps, options);
  }

  /**
   * 实现已下沉 domains/curriculum-reading.ts，此处仅委托。
   */
  public async recordKanaPractice(
    userId: string,
    kanaId: string,
    isCorrect: boolean,
    scriptType: 'HIRAGANA' | 'KATAKANA' | 'ROMAJI' = 'HIRAGANA'
  ): Promise<Result<{ proficiency: number }, BusinessError>> {
    const res = await recordKanaPracticeDomain(this.deps, userId, kanaId, isCorrect, scriptType);
    if (isOk(res)) {
      await maybeEvaluateLevelDomain(this.deps, userId, 'ja');
    }
    return res;
  }

  /**
   * 实现已下沉 domains/curriculum-reading.ts，此处仅委托。
   */
  public async listReadingSets(
    userId: string,
    origin?: 'ai' | 'news' | 'user_import',
    language?: 'JA' | 'EN' | 'KO'
  ): Promise<Result<ReadingPassageSet[], BusinessError>> {
    return listReadingSetsDomain(this.deps, userId, origin, language);
  }

  /**
   * 实现已下沉 domains/curriculum-reading.ts，此处仅委托。
   */
  public async saveReadingSet(
    userId: string,
    set: ReadingPassageSet
  ): Promise<Result<ReadingPassageSet, BusinessError>> {
    return saveReadingSetDomain(this.deps, userId, set);
  }

  /**
   * 实现已下沉 domains/curriculum-reading.ts，此处仅委托。
   */
  public async recordReadingPractice(
    userId: string,
    input: SubmitReadingPractice
  ): Promise<Result<{ proficiency: number }, BusinessError>> {
    return recordReadingPracticeDomain(this.deps, userId, input);
  }

  /**
   * 新手带路进度聚合（实现已下沉 learning-progress 域，此处仅委托）。
   */
  public async getBeginnerTrail(
    userId: string,
    track: 'ja' | 'en' | 'ko'
  ): Promise<Result<BeginnerTrail, BusinessError>> {
    return getBeginnerTrailDomain(this.deps, userId, track);
  }

  /**
   * 实现已下沉 domains/practice.ts，此处仅委托。
   */
  public async collectPracticeQuestions(input: {
    userId: string;
    title: string;
    intent?: string;
    layoutHint?: string | undefined;
    sourceRef?: string | undefined;
    questions: GeneratedQuestion[];
    /** P5：关联练习运行/块/批改模式（可空，向后兼容） */
    planRunId?: string | undefined;
    blockId?: string | undefined;
    gradingMode?: string | undefined;
  }): Promise<Result<{ collection: PracticeCollection; items: PracticeItem[] }, BusinessError>> {
    return collectPracticeQuestionsDomain(this.deps, input);
  }

  /**
   * 实现已下沉 domains/practice.ts，此处仅委托。
   */
  public async listPracticeCollections(
    userId: string,
    limit = 20
  ): Promise<Result<PracticeCollection[], BusinessError>> {
    return listPracticeCollectionsDomain(this.deps, userId, limit);
  }

  /**
   * 实现已下沉 domains/practice.ts，此处仅委托。
   */
  public async listPracticeItems(
    userId: string,
    collectionId: string
  ): Promise<Result<PracticeItem[], BusinessError>> {
    return listPracticeItemsDomain(this.deps, userId, collectionId);
  }

  /**
   * 实现已下沉 domains/practice.ts，此处仅委托。
   */
  public async convertPracticeItemsToCards(
    userId: string,
    itemIds: string[]
  ): Promise<
    Result<{ createdCount: number; cardIds: string[]; skippedItemIds: string[] }, BusinessError>
  > {
    return convertPracticeItemsToCardsDomain(this.deps, userId, itemIds);
  }

  // ===================== P5：可配置练习计划 =====================

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async savePracticePlanTemplate(
    template: PracticePlanTemplate
  ): Promise<Result<PracticePlanTemplate, BusinessError>> {
    return savePracticePlanTemplateDomain(this.deps, template);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async listPracticePlanTemplates(
    userId: string,
    opts?: { language?: string | undefined; includeDisabled?: boolean | undefined }
  ): Promise<Result<PracticePlanTemplate[], BusinessError>> {
    return listPracticePlanTemplatesDomain(this.deps, userId, opts);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async getPracticePlanTemplate(
    userId: string,
    templateId: string
  ): Promise<Result<PracticePlanTemplate | null, BusinessError>> {
    return getPracticePlanTemplateDomain(this.deps, userId, templateId);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async deletePracticePlanTemplate(
    userId: string,
    templateId: string
  ): Promise<Result<void, BusinessError>> {
    return deletePracticePlanTemplateDomain(this.deps, userId, templateId);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async setPracticePlanTemplateEnabled(
    userId: string,
    templateId: string,
    enabled: boolean
  ): Promise<Result<PracticePlanTemplate | null, BusinessError>> {
    return setPracticePlanTemplateEnabledDomain(this.deps, userId, templateId, enabled);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async copyPracticePlanTemplate(
    userId: string,
    templateId: string
  ): Promise<Result<PracticePlanTemplate, BusinessError>> {
    return copyPracticePlanTemplateDomain(this.deps, userId, templateId);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async startPracticePlanRun(
    userId: string,
    params: {
      language: 'en' | 'ja' | 'ko';
      templateId?: string | undefined;
      blocks?: PracticeBlockSpec[] | undefined;
    }
  ): Promise<Result<PracticePlanRun, BusinessError>> {
    return startPracticePlanRunDomain(this.deps, userId, params);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async getPracticePlanRun(
    userId: string,
    runId: string
  ): Promise<Result<PracticePlanRun | null, BusinessError>> {
    return getPracticePlanRunDomain(this.deps, userId, runId);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async listPracticePlanRuns(
    userId: string,
    opts?: { language?: string | undefined; status?: PracticeRunStatus | undefined }
  ): Promise<Result<PracticePlanRun[], BusinessError>> {
    return listPracticePlanRunsDomain(this.deps, userId, opts);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async savePracticeItemDraft(
    userId: string,
    runId: string,
    itemId: string,
    userAnswer: string
  ): Promise<Result<PracticeItemAttempt, BusinessError>> {
    return savePracticeItemDraftDomain(this.deps, userId, runId, itemId, userAnswer);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async submitPracticeItem(
    userId: string,
    runId: string,
    itemId: string,
    userAnswer: string,
    gradingResult?: Record<string, unknown>,
    timeSpentMs?: number
  ): Promise<Result<PracticeItemAttempt, BusinessError>> {
    return submitPracticeItemDomain(this.deps, userId, runId, itemId, userAnswer, gradingResult, timeSpentMs);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async listPracticeItemAttempts(
    runId: string
  ): Promise<Result<PracticeItemAttempt[], BusinessError>> {
    return listPracticeItemAttemptsDomain(this.deps, runId);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async getPracticeRunItems(
    userId: string,
    runId: string
  ): Promise<Result<Array<{ itemId: string; blockId: string; gradingMode: string; question: GeneratedQuestion }>, BusinessError>> {
    return getPracticeRunItemsDomain(this.deps, userId, runId);
  }

  /**
   * 实现已下沉 domains/practice-plan.ts，此处仅委托。
   */
  public async finalizePracticePlanRun(
    userId: string,
    runId: string
  ): Promise<Result<PracticePlanRun, BusinessError>> {
    return finalizePracticePlanRunDomain(this.deps, userId, runId);
  }
}
