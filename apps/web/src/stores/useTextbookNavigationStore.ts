import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TextbookLearningContent } from '@study-studio/document-model';

export type LearningSection = Exclude<keyof TextbookLearningContent, 'material'> | 'overview' | 'summary';
interface TextbookNavigation {
  view: 'LIBRARY' | 'CHAPTERS' | 'STUDY'; selectedBookId: string | null;
  chaptersByBook: Record<string, string>; sectionsByChapter: Record<string, LearningSection>; showTranslation: boolean;
  openBook: (bookId: string, chapterId: string) => void;
  openChapterList: (bookId: string) => void;
  selectChapter: (bookId: string, chapterId: string) => void;
  selectSection: (chapterId: string, section: LearningSection) => void;
  backToLibrary: () => void; setShowTranslation: (show: boolean) => void;
}

/** Navigation only: no textbook content, answers, scores or mastery. */
export const useTextbookNavigationStore = create<TextbookNavigation>()(persist(set => ({
  view: 'LIBRARY', selectedBookId: null, chaptersByBook: {}, sectionsByChapter: {}, showTranslation: false,
  openChapterList: selectedBookId => set({ view: 'CHAPTERS', selectedBookId }),
  openBook: (bookId, chapterId) => set(state => ({ view: 'STUDY', selectedBookId: bookId, chaptersByBook: { ...state.chaptersByBook, [bookId]: chapterId } })),
  selectChapter: (bookId, chapterId) => set(state => ({ chaptersByBook: { ...state.chaptersByBook, [bookId]: chapterId } })),
  selectSection: (chapterId, section) => set(state => ({ sectionsByChapter: { ...state.sectionsByChapter, [chapterId]: section } })),
  backToLibrary: () => set({ view: 'LIBRARY' }), setShowTranslation: showTranslation => set({ showTranslation }),
}), {
  name: 'lingua-textbook-navigation',
  partialize: state => ({ view: state.view, selectedBookId: state.selectedBookId, chaptersByBook: state.chaptersByBook, sectionsByChapter: state.sectionsByChapter, showTranslation: state.showTranslation }),
}));
