import type { TextbookLearningContent } from '@study-studio/document-model';
import type { ReactNode } from 'react';
import type { LearningSection } from '../../../stores/useTextbookNavigationStore.js';

/** Temporary presentation contract. Proposed persisted fields are documented separately. */
export interface StudySegment {
  text: string; translation?: string; speaker?: string; note?: string; knowledgeTitles?: string[];
}
export interface ChapterStudy {
  introduction: string; goals: string[];
  steps: { title: string; description: string; section: LearningSection }[];
  summary: string; selfCheck: { question: string; answer: string }[];
  articles: Record<string, StudySegment[]>;
}
export interface StudyDetail {
  title: string; text: string; translation?: string; explanation?: string; knowledgeTitles?: string[];
}
export interface StudyActions {
  language: string;
  explain: (detail: StudyDetail, label: string, disabled?: boolean) => ReactNode;
}
export type StudyContentProps = StudyActions & { content: TextbookLearningContent; showTranslation: boolean };
