import React from 'react';
import { useReadingFocusStore } from '../../stores/useReadingFocusStore.js';
import {
  useReadingPositionQuery,
  useSaveReadingPositionMutation,
  useRecordReadingExposuresMutation,
} from '../../queries/useLearnerQueries.js';
import type { TextbookBook, TextbookLesson } from '../../models/textbook.js';

interface ReadingEffectsInput {
  currentBook: TextbookBook | undefined;
  currentLesson: TextbookLesson | undefined;
  selectedLessonId: string;
  onRestoreLesson: (lessonId: string) => void;
}

/**
 * 教材阅读副作用编排：阅读焦点登记/清理、断点续读恢复、课次位置记录、
 * 开课相遇词记录。只做数据编排，不渲染。
 */
export function useStoredReadingEffects({
  currentBook,
  currentLesson,
  selectedLessonId,
  onRestoreLesson,
}: ReadingEffectsInput) {
  // P3-3 阅读焦点：打开某书某课即登记，离开教材页（卸载）即清空；
  // chat 仅凭此 store 决定是否附阅读 focus，其他页面保持 undefined。
  const setReadingFocus = useReadingFocusStore((s) => s.setReadingFocus);
  const clearReadingFocus = useReadingFocusStore((s) => s.clearReadingFocus);
  React.useEffect(() => {
    const docId = currentBook?.documentId ?? currentBook?.id;
    if (docId && currentLesson) {
      setReadingFocus({
        documentId: docId,
        lessonId: currentLesson.id,
        surface: `${currentBook?.shortTitle ?? ''} · ${currentLesson.title}`,
      });
    }
    return () => clearReadingFocus();
  }, [currentBook, currentLesson, setReadingFocus, clearReadingFocus]);

  // 断点续读：书就位后，若有保存的课次且合法，切过去（每本书只恢复一次，不跟用户手动选择抢）。
  const positionQuery = useReadingPositionQuery(currentBook?.documentId);
  const savedPosition = positionQuery.data;
  const savePosition = useSaveReadingPositionMutation();
  const restoredBookRef = React.useRef<string>('');
  React.useEffect(() => {
    const book = currentBook;
    const lessonId = savedPosition?.lessonId;
    if (!book?.documentId || savedPosition === undefined || positionQuery.isError) return;
    if (restoredBookRef.current === book.id) return;
    const valid = !!lessonId && book.lessons.some((l) => l.id === lessonId);
    if (valid && lessonId !== selectedLessonId) {
      onRestoreLesson(lessonId);
      return;
    }
    restoredBookRef.current = book.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook, savedPosition, selectedLessonId, positionQuery.isError]);

  // 课次切换即记位置（离散事件，无需防抖；静默失败不打扰阅读）。
  React.useEffect(() => {
    const documentId = currentBook?.documentId;
    if (!documentId || !selectedLessonId) return;
    if (positionQuery.isError || savedPosition === undefined || restoredBookRef.current !== currentBook?.id) return;
    if (!currentBook.lessons.some(lesson => lesson.id === selectedLessonId)) return;
    savePosition.mutate({ documentId, locator: { lessonId: selectedLessonId } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.documentId, selectedLessonId, savedPosition, positionQuery.isError]);

  // 打开课次即记相遇（reading 源）：生词表来自 AST 非 NLP；同课只记一次，同天由网关去重。
  const recordExposures = useRecordReadingExposuresMutation();
  const exposedLessonRef = React.useRef<string>('');
  React.useEffect(() => {
    const book = currentBook;
    const lesson = currentLesson;
    if (!book?.documentId || !lesson || exposedLessonRef.current === `${book.documentId}:${lesson.id}`) return;
    if (savedPosition === undefined || positionQuery.isError || restoredBookRef.current !== book.id || lesson.id !== selectedLessonId) return;
    const language =
      book.language === 'JA' ? 'ja' : book.language === 'EN' ? 'en' : book.language === 'KO' ? 'ko' : null;
    if (!language || lesson.vocabularies.length === 0) {
      exposedLessonRef.current = `${book.documentId}:${lesson.id}`;
      return;
    }
    exposedLessonRef.current = `${book.documentId}:${lesson.id}`;
    recordExposures.mutate({
      documentId: book.documentId,
      lessonId: lesson.id,
      language,
      terms: lesson.vocabularies.slice(0, 30).map((v) => ({
        headword: v.kanji,
        ...(v.kana ? { reading: v.kana } : {}),
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.documentId, currentLesson?.id, savedPosition, positionQuery.isError, selectedLessonId]);
}
