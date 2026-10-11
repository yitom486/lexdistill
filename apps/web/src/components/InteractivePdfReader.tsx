import React, { useState } from 'react';
import { LearningContentPanel } from './textbook/LearningContentPanel.js';
import { StructuredLessonPanel } from './textbook/StructuredLessonPanel.js';
import { toast } from 'sonner';
import { sound } from '../utils/audio.js';
import { openLookupPopup } from '../lib/lookup-popup-bus.js';
import {
  normalizeSelectionText,
  type LookupLanguage,
} from '../lib/selection-text.js';
import type { TextbookBook, TextbookLesson } from '../models/textbook.js';
import { useAnnotationsQuery, useAddAnnotationMutation, useProposeCardDraftMutation } from '../queries/useLearnerQueries.js';
import { useSelectionLookup } from './pdf-reader/useSelectionLookup.js';
import { useReadingProgress } from './pdf-reader/useReadingProgress.js';
import { PdfReaderToolbar, PdfPageControls } from './pdf-reader/PdfReaderToolbar.js';
import { SelectionLookupPopover } from './pdf-reader/SelectionLookupPopover.js';
import { PdfPageView } from './pdf-reader/PdfPageView.js';
import { StructuredLessonView } from './pdf-reader/StructuredLessonView.js';

interface InteractivePdfReaderProps {
  book: TextbookBook;
  lesson: TextbookLesson;
  onAddCard: (card: { front: string; back: string; category: string; prompt: string }) => void;
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
  const totalPages = 3;

  const { viewMode, setViewMode, currentPage, setCurrentPage, positionKey } = useReadingProgress({
    book,
    lesson,
    totalPages,
  });
  const selection = useSelectionLookup({ lesson });
  const { selectedText, popupPosition, wordDetail } = selection;

  // 划线批注持久化查询与新增
  const { data: annotationsList = [] } = useAnnotationsQuery(book.id);
  const addAnnotation = useAddAnnotationMutation();
  // 句子草稿提议（课文收句子 → 草稿箱确认 → 句子卡；接受时不记相遇词）
  const proposeDraft = useProposeCardDraftMutation();
  const handleCollectSentence = (sentence: string, translation: string) => {
    if (proposeDraft.isPending) return;
    const text = sentence.trim();
    if (!text) return;
    sound.playClick();
    proposeDraft.mutate(
      {
        drafts: [
          {
            language: book.language === 'EN' ? 'en' : book.language === 'KO' ? 'ko' : 'ja',
            headword: text.slice(0, 500),
            meanings: [translation.trim() || '(译文待补)'],
            partOfSpeech: '课文句子',
            source: 'import',
            sourceRef: `${positionKey}/${lesson.id}`,
            kind: 'sentence',
            cardType: 'SENTENCE',
          },
        ],
      },
      {
        onSuccess: (created) => {
          sound.playCorrect();
          toast.success(
            created.length > 0 ? '已收进草稿箱，去生词闪卡页确认入库' : '这句已在草稿箱里了'
          );
        },
        onError: (e) => {
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '收句子失败');
        },
      }
    );
  };

  // 划选查词典：经总线复用全局查词浮层（本书自有浮层保留，各管各的选择）
  const handleLookupSelection = () => {
    const language: LookupLanguage =
      book.language === 'EN' ? 'en' : book.language === 'KO' ? 'ko' : 'ja';
    const text = normalizeSelectionText(selectedText);
    if (!text || !popupPosition) {
      toast.error('请先在课文中划选要查的词。');
      return;
    }
    sound.playClick();
    openLookupPopup({
      text,
      language,
      x: popupPosition.x + 280,
      y: popupPosition.y,
      // P3-1 阅读上下文：查词 occurrence 带文档归属。
      documentId: book.documentId ?? book.id,
    });
  };

  const handleAddSelectedToCards = () => {
    sound.playCorrect();
    onAddCard({
      front: wordDetail?.reading ? `${wordDetail.word} (${wordDetail.reading})` : selectedText,
      back: wordDetail?.meaning || `来自《${book.shortTitle}》${lesson.title}`,
      category: 'VOCAB',
      prompt: `教材划词摘录: 《${book.shortTitle}》${lesson.title}`,
    });
    toast.success(`已加入 FSRS 闪卡：${selectedText}`);
    selection.dismissSelection();
  };

  const handleAskTutorForSelection = () => {
    sound.playClick();
    const isEn = book.language === 'EN';
    onAskAiTutor(
      selectedText,
      isEn
        ? `在《${book.title}》${lesson.title} 的英文课文语境中，请深度剖析这段英语的句式结构、时态/从句成分以及中式英语(Chinglish)常见易错点：`
        : `在《${book.title}》${lesson.title} 的课文语境中，请深度剖析这段日文的语法成分、敬体/简体用法以及母语者语感：`
    );
    selection.dismissSelection();
    toast.info(`已将选句提交给 AI 导师进行深度解析`);
  };

  const handleSaveAnnotation = () => {
    sound.playCorrect();
    addAnnotation.mutate({
      documentId: book.id,
      kind: wordDetail ? 'VOCAB' : 'KEY_POINT',
      quote: selectedText,
      note: wordDetail?.meaning || `课文划线批注: 《${book.shortTitle}》${lesson.title}`,
    });
    toast.success(`已沉淀课文重点批注：${selectedText}`);
    selection.dismissSelection();
  };

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
        annotationsCount={annotationsList.length}
        onStartQuiz={() => onStartLessonQuiz(lesson.id, lesson.title)}
      />

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
            collectPending={proposeDraft.isPending}
            onCollectSentence={handleCollectSentence}
            onAskAiTutor={onAskAiTutor}
            onAddSelectedToCards={handleAddSelectedToCards}
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
        />
      </div>

      {/* 底部页码控制 (PDF 模式) */}
      {!structuredAvailable && viewMode === 'PDF_PAGE' && (
        <PdfPageControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPrev={() => setCurrentPage((p) => Math.max(p - 1, 1))}
          onNext={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
        />
      )}
    </div>
  );
}
