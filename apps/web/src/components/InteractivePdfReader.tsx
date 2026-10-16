import React, { useState } from 'react';
import { LearningContentPanel } from './textbook/LearningContentPanel.js';
import { StructuredLessonPanel } from './textbook/StructuredLessonPanel.js';
import type { TextbookBook, TextbookLesson } from '../models/textbook.js';
import { usePdfReaderActions } from './pdf-reader/usePdfReaderActions.js';
import { useSelectionLookup } from './pdf-reader/useSelectionLookup.js';
import { useReadingProgress } from './pdf-reader/useReadingProgress.js';
import { PdfReaderToolbar } from './pdf-reader/PdfReaderToolbar.js';
import { SelectionLookupPopover } from './pdf-reader/SelectionLookupPopover.js';
import { PdfPageView } from './pdf-reader/PdfPageView.js';
import { StructuredLessonView } from './pdf-reader/StructuredLessonView.js';

interface InteractivePdfReaderProps {
  book: TextbookBook;
  lesson: TextbookLesson;
  onAddCard: (card: { front: string; back: string; category: string; prompt: string }) => Promise<unknown>;
  onStartLessonQuiz: (lessonId: string, lessonTitle: string) => void;
  onAskAiTutor: (selectedText: string, contextPrompt: string) => void;
}

/**
 * 沉浸式精读工作台：编排容器（查询/草稿/批注/选区编排），
 * 工具栏、悬浮岛与两种排版视图下沉 pdf-reader/ 子模块。
 */
export function InteractivePdfReader({
  book,
  lesson,
  onAddCard,
  onStartLessonQuiz,
  onAskAiTutor,
}: InteractivePdfReaderProps) {
  const [showChineseTranslation, setShowChineseTranslation] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  // Preserve legacy position fields; this content layout has no verified original-PDF pagination.
  const totalPages = 3;

  const { viewMode, setViewMode, currentPage, setCurrentPage, positionKey } = useReadingProgress({
    book,
    lesson,
    totalPages,
  });
  const selection = useSelectionLookup({ lesson, contextKey: book.documentId ?? book.id });
  const { selectedText, popupPosition, wordDetail } = selection;

  const actions = usePdfReaderActions({ book, lesson, selection, positionKey, onAddCard, onAskAiTutor });
  const { annotationsList, collectPending, handleCollectSentence, handleAddVocabToCards, handleAddSelectedToCards, handleSaveAnnotation, handleAskTutorForSelection, handleLookupSelection } = actions;
  const structuredAvailable = Boolean(lesson.content || lesson.learningContent);
  const showZoom = !structuredAvailable && viewMode === 'PDF_PAGE';

  return (
    <div className="space-y-4">
      <PdfReaderToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        structuredAvailable={structuredAvailable}
        showTranslation={showChineseTranslation}
        onToggleTranslation={() => setShowChineseTranslation((v) => !v)}
        zoomLevel={zoomLevel}
        onZoomIn={() => setZoomLevel((z) => Math.min(z + 10, 130))}
        onZoomOut={() => setZoomLevel((z) => Math.max(z - 10, 80))}
        showZoom={showZoom}
        annotationsCount={actions.annotationsQuery.data === undefined ? undefined : annotationsList.length}
        onStartQuiz={() => onStartLessonQuiz(lesson.id, lesson.title)}
      />
      {actions.annotationsQuery.isError && <p role="alert" className="text-xs text-ink-ghost">批注更新失败，已读取批注仍保留。</p>}

      {/* 核心阅读视口容器（自有划选浮层：全局查词浮层不抢） */}
      <div
        onMouseUp={selection.handleMouseUp}
        data-manual-lookup="true"
        className="relative min-h-[600px] p-6 sm:p-10 rounded-3xl bg-surface-dusk border border-line-hairline shadow-inner-hi overflow-hidden select-text"
        style={{ fontSize: `${(zoomLevel / 100) * 16}px` }}
      >
        {lesson.learningContent ? <LearningContentPanel content={lesson.learningContent} showTranslation={showChineseTranslation} /> : lesson.content ? <StructuredLessonPanel content={lesson.content} tab="READER" {...(lesson.directory ? { directory: lesson.directory } : {})} {...(book.language ? { language: book.language } : {})} showTranslation={showChineseTranslation}
          onCollectSentence={handleCollectSentence} onAskAiTutor={text => onAskAiTutor(text, `《${book.title}》${lesson.title}的教材语境`)} /> : viewMode === 'PDF_PAGE' ? (
          <PdfPageView
            book={book}
            lesson={lesson}
            currentPage={currentPage}
            totalPages={totalPages}
            showTranslation={showChineseTranslation}
            collectPending={collectPending}
            onCollectSentence={handleCollectSentence}
            onAskAiTutor={onAskAiTutor}
            onAddVocabWord={handleAddVocabToCards}
            cardsPending={actions.cardsPending}
          />
        ) : (
          <StructuredLessonView
            book={book}
            lesson={lesson}
            showTranslation={showChineseTranslation}
          />
        )}

        <SelectionLookupPopover
          position={popupPosition}
          wordDetail={wordDetail}
          ttsLang={book.language || 'JA'}
          onAddToCards={handleAddSelectedToCards}
          onSaveAnnotation={handleSaveAnnotation}
          onAskTutor={handleAskTutorForSelection}
          onLookup={handleLookupSelection}
          cardsPending={actions.cardsPending}
          annotationPending={actions.annotationPending}
          onDismiss={selection.dismissSelection}
        />
      </div>

    </div>
  );
}
