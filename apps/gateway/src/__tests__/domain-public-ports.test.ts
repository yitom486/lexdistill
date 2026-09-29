import { describe, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import * as lexiconPublic from '../modules/dictionary/public.js';
import * as learningPublic from '../modules/learning-progress/public.js';
import * as flashcardsPublic from '../modules/flashcards/public.js';

/**
 * M1-2 领域公共表面与仓储契约合规（结构不断言业务行为；行为由各域单测覆盖）。
 *
 * - 各域 public.ts 必须导出约定键（跨模块只许走 public 面，见 module-boundaries R5）；
 *   library/public.ts 自 E2b 起只转出仓储契约类型（archive 解包已迁独立包）；
 * - DrizzleLearnerRepository（:memory:）必须实现四域 ports 的全部方法
 *   （签名一致性由 `implements` 在编译期锁定，此处锁定运行时存在性）；
 * - flashcards/public.ts 当前只转出类型契约，运行时命名空间必须为空
 *  （未来加值导出时必须同步更新本测试 = 有意识决策）。
 */

const CONTENT_METHODS = [
  'getDocumentById', 'saveDocument', 'listDocuments', 'deleteDocument', 'saveCanonicalAst',
  'createImportTask', 'updateImportTask', 'getImportTask', 'executeTextbookPipeline',
  'seedTextbookTocSkeleton', 'commitLessonKnowledge', 'importDocumentFile',
  'saveAnnotation', 'listAnnotations', 'deleteAnnotation', 'convertAnnotationToCard',
  'saveDocumentStructure', 'getDocumentStructure', 'listDocumentLessonRefs', 'saveReadingPosition',
  'getReadingPosition', 'shredDocument', 'materializeSeedDocument', 'saveKnowledgePoints',
  'listKnowledgePoints', 'getAdaptiveKanaQueue',
  'getCurriculumHangul', 'getCurriculumKana', 'listReadingSets', 'saveReadingSet',
  'recordKanaPractice', 'recordHangulPractice', 'recordReadingPractice',
] as const;

const LEXICON_METHODS = [
  'searchLocalDictionary', 'collectDictionaryEntry', 'recordDictionarySearch',
  'getDictionarySearchHistory', 'recordTermExposure', 'listEncounteredTerms',
  'backfillEncounteredTermsFromHistory', 'recordReadingExposures', 'getTermExamples',
  'listWordlists', 'updateDictionarySourceConfig', 'sampleLocalDictionaryEntries',
] as const;

const LEARNING_METHODS = [
  'getQuestions', 'saveQuestions', 'isPlacementRun', 'startPlacementExam',
  'finishPlacementExam', 'getPlacementByRunId', 'listContentTemplates', 'listPracticeCollections',
  'listPracticeItems',   'convertPracticeItemsToCards', 'collectPracticeQuestions', 'resolveMistake',
  'retryMistake', 'countPlacementAttempts', 'commitReviewOutcome',
] as const;

const FLASHCARDS_METHODS = [
  'proposeCardDrafts', 'listCardDrafts', 'updateCardDraft', 'acceptCardDraft', 'dismissCardDraft',
  'listCardFormats', 'saveCardFormat', 'resetCardFormat', 'previewCardFormat', 'getAnkiPushSettings',
  'saveAnkiPushSettings', 'pushCardToAnki', 'importApkgNotes', 'exportApkgFile', 'readMediaFile',
  'storeMediaFile',
] as const;

describe('M1-2 domain public surface', () => {
  it('dictionary/learning-progress public.ts 导出约定键', () => {
    for (const key of ['buildTermKey', 'recordTermExposure'] as const) {
      expect(typeof (lexiconPublic as Record<string, unknown>)[key]).toBe('function');
    }
    for (const key of ['resolveActiveLanguage', 'buildAnalysisSnapshot', 'setTrackLevel'] as const) {
      expect(typeof (learningPublic as Record<string, unknown>)[key]).toBe('function');
    }
  });

  it('flashcards/public.ts 当前只转出类型契约（运行时命名空间为空）', () => {
    expect(Object.keys(flashcardsPublic)).toEqual([]);
  });

  it('DrizzleLearnerRepository 实现四域 ports 全部方法（:memory:）', () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const rec = repo as unknown as Record<string, unknown>;
      for (const name of [...CONTENT_METHODS, ...LEXICON_METHODS, ...LEARNING_METHODS, ...FLASHCARDS_METHODS]) {
        expect(typeof rec[name], name).toBe('function');
      }
    } finally {
      repo.getRawDb().close();
    }
  });
});
