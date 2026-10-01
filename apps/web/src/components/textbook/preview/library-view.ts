import type { TextbookLearningContent } from '@study-studio/document-model';
import type { TextbookBook } from '../../../models/textbook.js';

export interface LearningLibraryBook {
  id: string; title: string; language: string; level: string; temporary: boolean;
  chapters: { id: string; title: string; subtitle: string; content: TextbookLearningContent }[];
}

export function savedBookView(book: TextbookBook): LearningLibraryBook {
  return { id: book.documentId ?? book.id, title: book.title, language: book.language ?? '', level: book.level, temporary: false,
    chapters: book.lessons.map(chapter => ({ id: chapter.id, title: chapter.title, subtitle: chapter.subTitle !== chapter.title ? chapter.subTitle : '',
      content: chapter.learningContent ?? { vocabulary: [], grammar: [], articles: [], sentences: [], exercises: [], material: null } })),
  };
}
