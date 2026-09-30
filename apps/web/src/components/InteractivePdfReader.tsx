import React, { useState, useRef } from 'react';
import { StructuredLessonPanel } from './textbook/StructuredLessonPanel.js';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  FileText,
  Volume2,
  Sparkles,
  BookmarkPlus,
  Layers,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  CheckCircle2,
  HelpCircle,
  Play,
  RotateCcw,
  Highlighter,
} from 'lucide-react';
import { toast } from 'sonner';
import { sound, speechStudio } from '../utils/audio.js';
import { openLookupPopup } from '../lib/lookup-popup-bus.js';
import {
  MANUAL_LOOKUP_ATTR,
  normalizeSelectionText,
  type LookupLanguage,
} from '../lib/selection-text.js';
import { UnifiedTtsPlayer } from './UnifiedTtsPlayer.js';
import type { TextbookBook, TextbookLesson, TextbookVocabulary, FuriganaWord } from '../models/textbook.js';
import { useAnnotationsQuery, useAddAnnotationMutation, useReadingPositionQuery, useSaveReadingPositionMutation, useProposeCardDraftMutation } from '../queries/useLearnerQueries.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';


interface InteractivePdfReaderProps {
  book: TextbookBook;
  lesson: TextbookLesson;
  onAddCard: (card: { front: string; back: string; category: string; prompt: string }) => void;
  onStartLessonQuiz: (lessonId: string, lessonTitle: string) => void;
  onAskAiTutor: (selectedText: string, contextPrompt: string) => void;
}

export function InteractivePdfReader({
  book,
  lesson,
  onAddCard,
  onStartLessonQuiz,
  onAskAiTutor,
}: InteractivePdfReaderProps) {
  const [viewMode, setViewMode] = useState<'STRUCTURED' | 'PDF_PAGE'>(() => lesson.content ? 'STRUCTURED' : 'PDF_PAGE');
  const [showChineseTranslation, setShowChineseTranslation] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const totalPages = 3;

  // 划词浮动选区状态
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectionPopupPosition, setSelectionPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [activeWordDetail, setActiveWordDetail] = useState<{
    word: string;
    reading?: string;
    meaning?: string;
    pos?: string;
    pitch?: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

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

  // 断点续读：位置键与批注同键（documentId 优先）；同课才恢复页码，不跨课串页。
  const positionKey = book.documentId ?? book.id;
  const { data: savedPosition } = useReadingPositionQuery(positionKey);
  const savePosition = useSaveReadingPositionMutation();
  const restoredLessonRef = useRef<string>('');
  React.useEffect(() => {
    if (restoredLessonRef.current === lesson.id) return;
    if (savedPosition === undefined) return; // 查询中：读写都暂停，等结果
    if (savedPosition && savedPosition.lessonId === lesson.id) {
      const page = savedPosition.page;
      if (typeof page === 'number' && Number.isFinite(page) && page >= 1 && page <= totalPages) {
        setCurrentPage(Math.floor(page));
      }
      if (savedPosition.viewMode === 'STRUCTURED' || savedPosition.viewMode === 'PDF_PAGE') {
        setViewMode(savedPosition.viewMode);
      }
    }
    restoredLessonRef.current = lesson.id;
  }, [savedPosition, lesson.id]);

  // 翻页即记（防抖 800ms；恢复完成前不写，避免首屏 page=1 覆盖存量）。
  React.useEffect(() => {
    if (restoredLessonRef.current !== lesson.id) return;
    const timer = setTimeout(() => {
      savePosition.mutate({
        documentId: positionKey,
        locator: { lessonId: lesson.id, page: currentPage, viewMode },
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey, lesson.id, currentPage, viewMode]);

  // 处理文本划选
  const handleMouseUp = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && text.length > 0) {
      setSelectedText(text);
      setSelectionPopupPosition({
        x: Math.min(Math.max(e.clientX - 100, 20), window.innerWidth - 300),
        y: e.clientY - 60,
      });

      // 自动尝试在生词表中比对
      const matchedVocab = lesson.vocabularies.find(
        (v) => text.includes(v.kanji) || text.includes(v.kana)
      );
      if (matchedVocab) {
        setActiveWordDetail({
          word: matchedVocab.kanji,
          reading: matchedVocab.kana,
          meaning: matchedVocab.chinese,
          pos: matchedVocab.pos,
          pitch: matchedVocab.pitchAccent,
        });
      } else {
        setActiveWordDetail({
          word: text,
          reading: '句段 / 词汇',
          meaning: '可直接唤起 AI 导师深度剖析语法结构与接续',
        });
      }
    } else {
      // 延迟清除，以免点击浮窗内的按钮被取消
      setTimeout(() => {
        if (!window.getSelection()?.toString().trim()) {
          setSelectionPopupPosition(null);
        }
      }, 150);
    }
  };

  // 划选查词典：经总线复用全局查词浮层（本书自有浮层保留，各管各的选择）
  const handleLookupSelection = () => {
    const language: LookupLanguage =
      book.language === 'EN' ? 'en' : book.language === 'KO' ? 'ko' : 'ja';
    const text = normalizeSelectionText(selectedText);
    if (!text || !selectionPopupPosition) {
      toast.error('请先在课文中划选要查的词。');
      return;
    }
    sound.playClick();
    openLookupPopup({
      text,
      language,
      x: selectionPopupPosition.x + 280,
      y: selectionPopupPosition.y,
      // P3-1 阅读上下文：查词 occurrence 带文档归属。
      documentId: book.documentId ?? book.id,
    });
  };

  const handleSpeak = (text: string) => {
    sound.playClick();
    speechStudio.speak(text, { lang: book.language || 'JA', purpose: 'reading' });
  };

  const handleAddSelectedToCards = () => {
    sound.playCorrect();
    onAddCard({
      front: activeWordDetail?.reading ? `${activeWordDetail.word} (${activeWordDetail.reading})` : selectedText,
      back: activeWordDetail?.meaning || `来自《${book.shortTitle}》${lesson.title}`,
      category: 'VOCAB',
      prompt: `教材划词摘录: 《${book.shortTitle}》${lesson.title}`,
    });
    toast.success(`已加入 FSRS 闪卡：${selectedText}`);
    setSelectionPopupPosition(null);
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
    setSelectionPopupPosition(null);
    toast.info(`已将选句提交给 AI 导师进行深度解析`);
  };

  const handleSaveAnnotation = () => {
    sound.playCorrect();
    addAnnotation.mutate({
      documentId: book.id,
      kind: activeWordDetail ? 'VOCAB' : 'KEY_POINT',
      quote: selectedText,
      note: activeWordDetail?.meaning || `课文划线批注: 《${book.shortTitle}》${lesson.title}`,
    });
    toast.success(`已沉淀课文重点批注：${selectedText}`);
    setSelectionPopupPosition(null);
  };


  return (
    <div className="space-y-4">
      {/* 顶部阅读器控制条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-paper-soft border border-line-accent shadow-sm">
        {/* 模式切换 */}
        <Tabs
          value={viewMode}
          onValueChange={(val) => {
            if (!val) return;
            sound.playClick();
            setViewMode(val as 'STRUCTURED' | 'PDF_PAGE');
          }}
        >
          <TabsList className="bg-veil-stone-200o70-stone-800o80">
            <TabsIndicator />
            {!lesson.content && <TabsTrigger value="PDF_PAGE" className="px-3 py-1.5 text-xs gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              原版教材排版精读
            </TabsTrigger>}
            <TabsTrigger value="STRUCTURED" className="px-3 py-1.5 text-xs gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              结构分解导读
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* 快捷工具 */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              sound.playClick();
              setShowChineseTranslation(!showChineseTranslation);
            }}
            className="gap-1.5"
          >
            {showChineseTranslation ? (
              <>
                <Eye className="w-3.5 h-3.5 text-accent-ink" />
                <span>中文对照: 开启</span>
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5 text-ink-stone-400" />
                <span>中文对照: 隐藏</span>
              </>
            )}
          </Button>

          {!lesson.content && viewMode === 'PDF_PAGE' && (
            <div className="flex items-center gap-1 border border-line-soft rounded-xl px-1 py-0.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setZoomLevel((z) => Math.max(z - 10, 80))}
                className="h-7 w-7 text-ink-stone-500"
                title="缩小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[11px] font-mono font-semibold px-1 text-ink-faint">
                {zoomLevel}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setZoomLevel((z) => Math.min(z + 10, 130))}
                className="h-7 w-7 text-ink-stone-500"
                title="放大"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {annotationsList.length > 0 && (
            <Badge variant="amber" className="text-[11px] gap-1 px-2.5 py-1">
              <Highlighter className="w-3 h-3" />
              <span>{annotationsList.length} 条重点批注</span>
            </Badge>
          )}

          <Button
            variant="amber"
            size="sm"
            onClick={() => {
              sound.playClick();
              onStartLessonQuiz(lesson.id, lesson.title);
            }}
            className="gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            练习本课测验
          </Button>
        </div>
      </div>

      {/* 核心阅读视口容器（自有划选浮层：全局查词浮层不抢） */}
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        data-manual-lookup="true"
        className="relative min-h-[600px] p-6 sm:p-10 rounded-3xl bg-surface-dusk border border-line-accent shadow-sm overflow-hidden select-text"
        style={{ fontSize: `${(zoomLevel / 100) * 16}px` }}
      >
        {lesson.content ? <StructuredLessonPanel content={lesson.content} tab="READER" {...(lesson.directory ? { directory: lesson.directory } : {})} {...(book.language ? { language: book.language } : {})} showTranslation={showChineseTranslation}
          onCollectSentence={handleCollectSentence} onAskAiTutor={text => onAskAiTutor(text, `《${book.title}》${lesson.title}的教材语境`)} /> : viewMode === 'PDF_PAGE' ? (
          /* 仿真原版双栏教材排版 */
          <div className="max-w-4xl mx-auto space-y-8">
            {/* 顶栏教材标识 */}
            <div className="flex items-center justify-between border-b-2 border-line-stone-800-stone-300 pb-3">
              <div className="flex items-center gap-3">
                <Badge className="rounded-md bg-ink text-surface border-transparent hover:bg-tone-stone-900">
                  {book.shortTitle}
                </Badge>
                <span className="font-bold text-sm tracking-wider text-ink-soft">
                  {lesson.title}
                </span>
              </div>
              <span className="text-xs font-mono text-ink-stone-400">
                PAGE {currentPage} / {totalPages}
              </span>
            </div>

            {/* 课文主对话区 */}
            <div className="space-y-4">
              <div className="inline-block px-3 py-1 rounded-md bg-wash-amber-500o10 text-ink-amber-800-amber-300 text-xs font-bold mb-2">
                {book.language === 'EN' ? '【Dialogue · 课文会话】' : '【基本会话 · 基本会話】'}
              </div>
              <div className="space-y-4 leading-relaxed font-serif">
                {lesson.dialogues.map((dlg) => (
                  <div
                    key={dlg.id}
                    className="p-3.5 rounded-xl hover:bg-wash-amber-500o5 transition-colors border-l-2 border-transparent hover:border-tone-amber-500o40"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="font-bold text-accent-ink-warm shrink-0 font-sans text-xs px-2 py-0.5 rounded-md bg-wash-amber-500o10">
                        {dlg.speaker}
                      </span>
                      <div className="flex-1 space-y-1">
                        <div className="text-ink text-base flex flex-wrap items-center gap-x-2">
                          <span>{dlg.japanese}</span>
                          <UnifiedTtsPlayer
                            variant="inline"
                            text={dlg.japanese}
                            lang={book.language || 'JA'}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              sound.playClick();
                              onAskAiTutor(
                                dlg.japanese,
                                `在《${book.title}》${lesson.title}（${dlg.speaker}）的语境中，请讲透这句的语法成分、关键助词/接续与语感，并给中文翻译对照：`
                              );
                              toast.info('已将整句提交给 AI 导师讲透');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold text-tone-amber-700 hover:bg-wash-amber-500o10 dark:text-ink-amber-300 cursor-pointer transition-colors"
                            title="整句讲透：语法成分 + 助词接续 + 语感（不用先划选）"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            讲透
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCollectSentence(dlg.japanese, dlg.chinese)}
                            disabled={proposeDraft.isPending}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold text-ink-stone-500 hover:bg-wash-amber-500o10 hover:text-tone-amber-700 dark:text-ink-stone-400 dark:hover:text-ink-amber-300 cursor-pointer transition-colors"
                            title="收进生词草稿箱，确认后建成句子卡"
                          >
                            <BookmarkPlus className="w-3.5 h-3.5" />
                            收句子
                          </button>
                        </div>
                        {showChineseTranslation && (
                          <div className="text-xs text-ink-ghost font-sans">
                            {dlg.chinese}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 双栏底注与语法句型 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-line-soft">
              {/* 左栏: 核心语法句型 */}
              <div className="space-y-4">
                <div className="font-bold text-xs text-ink flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-tone-amber-600"></span>
                  {book.language === 'EN' ? '【Core Grammar · 核心语法】' : '【重要文法 · 文法ノート】'}
                </div>
                <div className="space-y-3">
                  {lesson.grammarPoints.map((gp) => (
                    <div
                      key={gp.id}
                      className="p-3 rounded-xl bg-paper-cream-deep border border-line-stone-200-stone-800o80 space-y-1.5"
                    >
                      <div className="text-xs font-bold text-accent-ink-warm">
                        {gp.title}
                      </div>
                      <div className="text-[11px] font-mono text-ink-faint">
                        接续: {gp.structure}
                      </div>
                      <p className="text-xs text-ink-ghost leading-normal">
                        {gp.explanation}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 右栏: 本课生词表 */}
              <div className="space-y-4">
                <div className="font-bold text-xs text-ink flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-tone-emerald-600"></span>
                  {book.language === 'EN' ? '【Vocabulary · 重点词汇】' : '【新出単語 · 生词表】'}
                </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {lesson.vocabularies.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-paper-cream-deep text-xs hover:bg-wash-amber-500o10 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink">
                          {v.kanji}
                        </span>
                        <span className="text-[11px] text-ink-stone-400">({v.kana})</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-line-soft text-ink-faint">
                          {v.pos}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-ink-faint-soft">{v.chinese}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleAddSelectedToCards()}
                          className="h-7 w-7 text-ink-stone-400 hover:text-tone-amber-600"
                          title="加入闪卡"
                        >
                          <BookmarkPlus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* 结构分解排版模式 */
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="p-4 rounded-2xl bg-wash-amber-500o10 border border-line-amber-900o10-amber-500o20">
              <h4 className="text-sm font-bold text-ink mb-1">
                {lesson.subTitle}
              </h4>
              <p className="text-xs text-ink-ghost">
                本模式对长课文进行段落与语义分块，支持单句反复回放与语法点对齐。
              </p>
            </div>

            <div className="space-y-6">
              {lesson.dialogues.map((dlg, idx) => (
                <div
                  key={dlg.id}
                  className="p-5 rounded-2xl bg-paper-cream-night border border-line-soft space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-tone-amber-600 text-tone-white">
                      第 {idx + 1} 句 · {dlg.speaker}
                    </span>
                    <UnifiedTtsPlayer
                      variant="button"
                      text={dlg.japanese}
                      lang={book.language || 'JA'}
                      label="朗读"
                    />
                  </div>
                  <div className="text-lg font-serif text-ink">
                    {dlg.japanese}
                  </div>
                  {showChineseTranslation && (
                    <div className="text-sm text-ink-ghost border-t border-line-stone-200-stone-800o80 pt-2">
                      {dlg.chinese}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 划词划句浮动操作卡片 */}
        <AnimatePresence>
          {selectionPopupPosition && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 5 }}
              style={{
                position: 'fixed',
                left: selectionPopupPosition.x,
                top: selectionPopupPosition.y,
              }}
              className="z-50 p-3 rounded-2xl bg-surface-coal-fixed text-tone-white shadow-2xl border border-line-amber-500o30 flex flex-col gap-2 min-w-[240px] max-w-[320px]"
            >
              {/* 词义预览 */}
              {activeWordDetail && (
                <div className="space-y-0.5 border-b border-tone-stone-700 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink-amber-400 text-xs flex items-center gap-1">
                      {activeWordDetail.word}
                      <UnifiedTtsPlayer
                        variant="inline"
                        text={activeWordDetail.word}
                        lang={book.language || 'JA'}
                      />
                    </span>
                    {activeWordDetail.reading && (
                      <span className="text-[10px] text-ink-stone-400">
                        {activeWordDetail.reading}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-tone-stone-300 line-clamp-2">
                    {activeWordDetail.meaning}
                  </p>
                </div>
              )}

              {/* 操作按钮流 */}
              <div className="flex items-center gap-1.5 pt-1">
                <Button
                  onClick={handleAddSelectedToCards}
                  size="sm"
                  className="flex-1 h-8 gap-1 bg-tone-amber-600 hover:bg-tone-amber-700 text-[11px] text-tone-white"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  转为闪卡
                </Button>
                <Button
                  onClick={handleSaveAnnotation}
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 border-tone-stone-700 text-tone-stone-300 hover:bg-tone-stone-800 text-[11px]"
                >
                  <Highlighter className="w-3.5 h-3.5 text-ink-amber-400" />
                  划线重点
                </Button>
                <Button
                  onClick={handleAskTutorForSelection}
                  size="sm"
                  variant="secondary"
                  className="flex-1 h-8 gap-1 bg-tone-stone-800 hover:bg-tone-stone-700 text-[11px] text-ink-amber-300"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  导师点拨
                </Button>
                <Button
                  onClick={handleLookupSelection}
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 border-tone-stone-700 text-tone-stone-300 hover:bg-tone-stone-800 text-[11px]"
                >
                  <BookOpen className="w-3.5 h-3.5 text-tone-sky-400" />
                  查词典
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 底部页码控制 (PDF 模式) */}
      {!lesson.content && viewMode === 'PDF_PAGE' && (
        <div className="flex items-center justify-center gap-4 py-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs font-mono font-semibold text-ink-faint-soft">
            第 {currentPage} 页 / 共 {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
