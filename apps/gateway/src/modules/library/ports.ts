import type { Result, BusinessError } from '@study-studio/shared';
import type { AdaptiveKanaQueueOptions } from '@study-studio/learner-core';
import type {
  DocumentItem,
  Flashcard,
  AnnotationItem,
  KanaItem,
  HangulItem,
  HangulScriptType,
  ReadingPassageSet,
  SubmitReadingPractice,
} from '@study-studio/protocol';
import type { TextbookAST } from '@study-studio/document-model';
import type { ImportTask, ImportTaskStatus } from '@study-studio/storage-sqlite';
import type {
  DocumentImportInput,
  DocumentImportOutput,
  DocumentImportDeps,
} from './application/document-import/document-import-service.js';
import type { SavedDocumentStructure } from './persistence/document-structure.js';
import type { ShredStats } from '@study-studio/storage-sqlite';
import type { MaterializeSeedInput } from '@study-studio/storage-sqlite';
import type { ReadingPosition } from '@study-studio/storage-sqlite';
import type {
  SaveKnowledgePointInput,
  KnowledgePoint,
  SeedTocSkeletonInput,
  SavedTocSkeleton,
  CommitLessonKnowledgeInput,
  CommitLessonKnowledgeOutput,
} from '@study-studio/storage-sqlite';
import type {
  TextbookPipelineInput,
  TextbookPipelineOutput,
} from './application/textbook-pipeline.js';

/**
 * M1-2 内容（content）领域仓储能力契约（文档/教材/课程底座/导入任务）。
 *
 * - 方法签名与 DrizzleLearnerRepository 实现逐字对齐（`implements` 编译期锁定）；
 * - 只收上层实际消费的高层方法，不含 raw 句柄、drizzle 直连与测试探针；
 * - 课程类方法（completeLesson/listLessons 等）仍由 curriculum 路由经具体类调用，
 *   所有权归属 M5 再定，本契约暂不收录。
 */
export interface ContentRepository {
  executeTextbookPipeline(
    input: TextbookPipelineInput
  ): Promise<Result<TextbookPipelineOutput, BusinessError>>;
  seedTextbookTocSkeleton(
    input: SeedTocSkeletonInput
  ): Promise<Result<SavedTocSkeleton, BusinessError>>;
  commitLessonKnowledge(
    input: CommitLessonKnowledgeInput
  ): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>>;
  getDocumentById(id: string): Promise<Result<DocumentItem | null, BusinessError>>;
  saveDocument(doc: DocumentItem): Promise<Result<DocumentItem, BusinessError>>;
  listDocuments(
    userId: string,
    sourceKind?: string
  ): Promise<Result<DocumentItem[], BusinessError>>;
  deleteDocument(id: string, userId: string): Promise<Result<void, BusinessError>>;
  saveCanonicalAst(
    docBase: Omit<DocumentItem, 'astJson'>,
    book: TextbookAST
  ): Promise<Result<DocumentItem, BusinessError>>;
  createImportTask(input: {
    userId: string;
    sourceKind: ImportTask['sourceKind'];
    filename: string;
  }): Promise<Result<ImportTask, BusinessError>>;
  updateImportTask(
    id: string,
    patch: { status: ImportTaskStatus; documentId?: string; lessons?: number; error?: string }
  ): Promise<Result<ImportTask, BusinessError>>;
  getImportTask(id: string): Promise<ImportTask | undefined>;
  importDocumentFile(
    input: DocumentImportInput,
    readers?: DocumentImportDeps
  ): Promise<Result<DocumentImportOutput, BusinessError>>;
  saveAnnotation(ann: AnnotationItem): Promise<Result<AnnotationItem, BusinessError>>;
  listAnnotations(
    documentId: string,
    userId: string
  ): Promise<Result<AnnotationItem[], BusinessError>>;
  deleteAnnotation(
    annotationId: string,
    userId: string
  ): Promise<Result<void, BusinessError>>;
  convertAnnotationToCard(
    annotationId: string,
    userId: string,
    cardData: {
      front: string;
      back: string;
      tag?: string | undefined;
      pos?: string | undefined;
      phonetic?: string | undefined;
    }
  ): Promise<Result<Flashcard, BusinessError>>;
  saveDocumentStructure(
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
  ): Promise<Result<SavedDocumentStructure, BusinessError>>;
  getDocumentStructure(
    userId: string,
    documentId: string
  ): Promise<Result<SavedDocumentStructure | null, BusinessError>>;
  listDocumentLessonRefs(documentId: string): Promise<Result<string[], BusinessError>>;
  saveKnowledgePoints(input: {
    documentId: string;
    lessonId: string;
    points: SaveKnowledgePointInput[];
  }): Promise<Result<{ saved: number; updated: number }, BusinessError>>;
  listKnowledgePoints(
    documentId: string,
    lessonId?: string
  ): Promise<Result<KnowledgePoint[], BusinessError>>;
  saveReadingPosition(
    userId: string,
    documentId: string,
    locator: unknown
  ): Promise<Result<ReadingPosition, BusinessError>>;
  getReadingPosition(
    userId: string,
    documentId: string
  ): Promise<Result<ReadingPosition | null, BusinessError>>;
  shredDocument(
    documentId: string,
    book: TextbookAST
  ): Promise<Result<ShredStats, BusinessError>>;
  materializeSeedDocument(
    docBase: MaterializeSeedInput['docBase'],
    book: TextbookAST,
    fingerprint: string,
    materializerVersion: number
  ): Promise<Result<DocumentItem, BusinessError>>;
  getAdaptiveKanaQueue(
    userId: string,
    options?: AdaptiveKanaQueueOptions
  ): Promise<Result<KanaItem[], BusinessError>>;
  getCurriculumHangul(type?: string): Promise<Result<HangulItem[], BusinessError>>;
  getCurriculumKana(type?: string): Promise<Result<KanaItem[], BusinessError>>;
  listReadingSets(
    userId: string,
    origin?: 'ai' | 'news' | 'user_import',
    language?: 'JA' | 'EN' | 'KO'
  ): Promise<Result<ReadingPassageSet[], BusinessError>>;
  saveReadingSet(
    userId: string,
    set: ReadingPassageSet
  ): Promise<Result<ReadingPassageSet, BusinessError>>;
  recordKanaPractice(
    userId: string,
    kanaId: string,
    isCorrect: boolean,
    scriptType?: 'HIRAGANA' | 'KATAKANA' | 'ROMAJI'
  ): Promise<Result<{ proficiency: number }, BusinessError>>;
  recordHangulPractice(
    userId: string,
    hangulId: string,
    isCorrect: boolean,
    scriptType?: HangulScriptType
  ): Promise<Result<{ proficiency: number }, BusinessError>>;
  recordReadingPractice(
    userId: string,
    input: SubmitReadingPractice
  ): Promise<Result<{ proficiency: number }, BusinessError>>;
}

export type {
  SeedTocSkeletonInput,
  SavedTocSkeleton,
  CommitLessonKnowledgeInput,
  CommitLessonKnowledgeOutput,
  TextbookPipelineInput,
  TextbookPipelineOutput,
};

