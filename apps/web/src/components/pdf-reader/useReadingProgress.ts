import React, { useRef, useState } from 'react';
import {
  useReadingPositionQuery,
  useSaveReadingPositionMutation,
} from '../../queries/useLearnerQueries.js';
import type { TextbookBook, TextbookLesson } from '../../models/textbook.js';

export type ReaderViewMode = 'STRUCTURED' | 'PDF_PAGE';

interface UseReadingProgressOptions {
  book: TextbookBook;
  lesson: TextbookLesson;
  totalPages: number;
}

/**
 * 断点续读：位置键与批注同键（documentId 优先）；同课才恢复页码，不跨课串页。
 * 翻页即记（防抖 800ms；恢复完成前不写，避免首屏覆盖存量）。
 */
export function useReadingProgress({ book, lesson, totalPages }: UseReadingProgressOptions) {
  const [viewMode, setViewMode] = useState<ReaderViewMode>(() =>
    lesson.content || lesson.learningContent ? 'STRUCTURED' : 'PDF_PAGE'
  );
  const [currentPage, setCurrentPage] = useState<number>(1);

  const positionKey = book.documentId ?? book.id;
  const positionQuery = useReadingPositionQuery(positionKey);
  const savedPosition = positionQuery.data;
  const savePosition = useSaveReadingPositionMutation();
  const restoredLessonRef = useRef<string>('');

  React.useEffect(() => {
    if (restoredLessonRef.current === `${positionKey}:${lesson.id}`) return;
    if (savedPosition === undefined || positionQuery.isError) return; // 查询中/失败：不覆盖存量位置
    if (savedPosition && savedPosition.lessonId === lesson.id) {
      const page = savedPosition.page;
      if (typeof page === 'number' && Number.isFinite(page) && page >= 1 && page <= totalPages) {
        setCurrentPage(Math.floor(page));
      }
      if (savedPosition.viewMode === 'STRUCTURED' || savedPosition.viewMode === 'PDF_PAGE') {
        setViewMode(savedPosition.viewMode);
      }
    }
    restoredLessonRef.current = `${positionKey}:${lesson.id}`;
  }, [savedPosition, lesson.id, totalPages, positionKey, positionQuery.isError]);

  React.useEffect(() => {
    if (positionQuery.isError || restoredLessonRef.current !== `${positionKey}:${lesson.id}`) return;
    const timer = setTimeout(() => {
      savePosition.mutate({
        documentId: positionKey,
        locator: { lessonId: lesson.id, page: currentPage, viewMode },
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey, lesson.id, currentPage, viewMode, savedPosition, positionQuery.isError]);

  return { viewMode, setViewMode, currentPage, setCurrentPage, positionKey };
}
