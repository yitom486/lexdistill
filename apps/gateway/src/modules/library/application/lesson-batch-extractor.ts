import type { TocEntry, TextbookLessonStage, TextbookModelActivity } from '@lexdistill/document-model';
import type { CommitLessonKnowledgeOutput } from '../ports.js';
import type { PdfTaskFile } from './pdf-import/pdf-task-workspace.js';

export interface LessonExtractionJob {
  documentId: string;
  lessonId: string;
  title: string;
  language: string;
  allowAiExercises: boolean;
  tocEntries: readonly TocEntry[];
  tocPath: readonly TocEntry[];
  text: string;
  pdfFile?: PdfTaskFile;
}
export type LessonStage = TextbookLessonStage;
export interface BatchExtractionProgress {
  documentId: string; lessonId: string; stage: LessonStage;
  completedCount: number; totalCount: number; successfulCount?: number;
  allLessonsReady: boolean; error?: string;
  stats: CommitLessonKnowledgeOutput['stats'];
  modelActivity?: TextbookModelActivity;
}
