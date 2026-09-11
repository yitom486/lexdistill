// P1-2 拆分：键与默认用户已下沉 query-keys.ts，此处重导出保持对外不变。
import { DEFAULT_USER_ID, QUERY_KEYS, invalidateAllLearningQueries } from './query-keys.js';

export { DEFAULT_USER_ID, QUERY_KEYS, invalidateAllLearningQueries };

// P1-2 拆分：画像/计划/分析组已下沉 profile-plan-analysis.ts，此处重导出保持对外不变。
export { useLearnerProfileQuery, useDailyTaskQuery, useDailyPlanQuery, useCompletePlanStepMutation, useLearningAnalysisQuery, useRefreshLearningAnalysisMutation, useActivityHistoryQuery, useBeginnerTrailQuery, type TrailStageStatus, type BeginnerTrail, useLevelInfoQuery, type LevelInfo, useCourseRouteQuery, type CourseRoute, type CourseRouteUnit, courseStageName } from './profile-plan-analysis.js';

// P1-2 拆分：卡片/错题/题库组已下沉 cards-mistakes-questions.ts，此处重导出保持对外不变。
export { useCardsQuery, useAddCardsMutation, useUpdateCardMutation, vocabToStudyCard, useMistakesQuery, useUpdateMistakeMutation, useAddMistakeMutation, useQuestionsQuery, usePrependQuestionMutation, useMarkCardStudiedMutation } from './cards-mistakes-questions.js';

// 生词草稿箱组已下沉 flashcards-drafts.ts（提议由网关/AI 侧写入，前端只确认）。
export { useCardDraftsQuery, useUpdateCardDraftMutation, useAcceptCardDraftMutation, useDismissCardDraftMutation, useProposeCardDraftMutation, type CardDraftItem, type ProposeDraftVars } from './flashcards-drafts.js';

// P1-2 拆分注：usePrependQuestionMutation / useAddCardsMutation / useUpdateCardMutation / useUpdateMistakeMutation / useAddMistakeMutation 已下沉 cards-mistakes-questions.ts，见文件顶部 barrel 重导出。
// 双传输收敛：同名 useSubmitQuizMutation 只保留 useAgentMutations 的 WS 版（HTTP 记足迹版零消费已删除）。

// P1-2 拆分：教材/批注组已下沉 textbooks-annotations.ts，此处重导出保持对外不变。
export { useTextbooksQuery, useImportTextbookMutation, useImportPdfMutation, type ImportPdfResult, useImportDocumentMutation, type ImportDocumentResult, useMapPdfMutation, type MapPdfResult, type PdfPageHeading, type PdfTocEntry, useAppendPdfMutation, type AppendPdfResult, useEnrichLessonMutation, type EnrichLessonResult, useTextbookLessonQuizMutation, type TextbookLessonQuizResult, useClassifyStructureMutation, type ClassifyStructureResult, type StructureClassItem, type StructureHeading, useSaveDocumentStructureMutation, useDocumentStructureQuery, type SavedStructure, useAnnotationsQuery, useAddAnnotationMutation, useAnnotationToCardMutation, useReadingPositionQuery, useSaveReadingPositionMutation, type ReadingPositionLocator, useRecordReadingExposuresMutation, type TocPdfSource, requestDiscoverToc, useDiscoverTocMutation, streamDiscoverToc, type StreamDiscoverTocResult, requestExtractTocBaseline, streamExtractTocBaseline, type StreamExtractTocResult, useExtractTocBaselineMutation, requestReviewToc, useReviewTocMutation, requestFolioCandidates, useFolioCandidatesMutation, type PreviewTocSegmentsVars, requestPreviewTocSegments, usePreviewTocSegmentsMutation, type ImportTocLessonVars, requestImportTocLesson, useImportTocLessonMutation, type PrepareSessionVars, requestPrepareSession, usePrepareSessionMutation, requestSessionStatus, useSessionStatusQuery, type ExecuteSessionChunkVars, useExecuteSessionChunkMutation } from './textbooks-annotations.js';

// P1-2 拆分：练习队列组已下沉 practice-collect.ts，此处重导出保持对外不变。
export { usePracticeCollectionsQuery, usePracticeItemsQuery, usePracticeItemsToCardsMutation } from './practice-collect.js';

// P1-2 拆分：词典/假名/课程阅读/新闻组已下沉 dictionary-curriculum-reading.ts，此处重导出保持对外不变。
export { useCurriculumKanaQuery, useAdaptiveKanaQueueQuery, useKanaPracticeMutation, useCurriculumHangulQuery, useHangulPracticeMutation, useReadingSetsQuery, useNewsTopicsQuery, type PitchLexiconItem, type DictionaryLookupResult, type DictionaryPackageInfo, type DictionaryHistoryItem, type DictionaryEntryCollection, useDictionaryPackagesQuery, useInstallDictionaryPackageMutation, useInstallCustomDictionaryMutation, useUpdateDictionaryPackageMutation, useCollectDictionaryEntryMutation, useDictionaryLookupQuery, useDictionaryHistoryQuery, type EncounteredTermItem, useEncounteredTermsQuery, useBackfillEncounteredTermsMutation, type TermExampleItem, useTermExamplesQuery, usePitchLexiconQuery, useGenerateReadingSetMutation, useSubmitReadingPracticeMutation, type WritingPromptItem, type DictationChallengeItem, useGenerateWritingPromptsMutation, useGenerateDictationMutation, type KanaWordItem, useGenerateKanaWordsMutation, type HangulWordItem, useGenerateHangulWordsMutation, type AnkiCardFormatInfo, type CardPreviewResult, type CardPreviewEntry, useCardFormatsQuery, useSaveCardFormatMutation, useResetCardFormatMutation, usePreviewCardMutation, type AnkiPushStatus, type AnkiPushResult, type AnkiPushTts, useAnkiStatusQuery, useSaveAnkiSettingsMutation, usePushToAnkiMutation, type ApkgModelDraft, type ApkgAnalysis, type ApkgImportResult, useAnalyzeApkgMutation, useImportApkgNotesMutation, useExportApkgMutation } from './dictionary-curriculum-reading.js';

// P-TTS：语音合成代理组已下沉 tts.ts，此处重导出保持对外不变。
export { useAzureVoicesQuery, useInvalidateTtsVoices, type AzureVoiceOption } from './tts.js';

// 后台抽取任务组（整本 enrich Job：启动/轮询/取消/WS 订阅）。
export { useStartEnrichJobMutation, useEnrichJobQuery, useCancelEnrichJobMutation, useEnrichJobSubscription } from './enrich-jobs.js';

// P1-2 拆分：练习计划组已下沉 practice-plan.ts，此处重导出保持对外不变。
export { usePracticeTemplatesQuery, useSavePracticeTemplateMutation, useDeletePracticeTemplateMutation, useTogglePracticeTemplateMutation, useCopyPracticeTemplateMutation, useStartPracticeRunMutation, usePracticeRunQuery, useSavePracticeDraftMutation, useSubmitObjectiveMutation, useSubmitSubjectiveMutation, useSubmitBatchMutation, useFinalizePracticeRunMutation, type AssessBatchResult, useGradeBatchMutation, type AssessSingleResult, useGradeSingleMutation, useAssemblePracticeRunMutation, type PracticeRunnerItemDTO, usePracticeRunItemsQuery, type PracticeProposalDTO, useProposeTemplateMutation, useApplyProposalMutation, type RunSummaryDTO, usePracticeRunSummaryQuery, type PlacementLevel, type PlacementExamInfo, type PlacementFinishInfo, useStartPlacementMutation, useFinishPlacementMutation } from './practice-plan.js';
