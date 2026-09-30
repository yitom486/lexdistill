import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  ChevronRight,
  Layers,
  Sparkles,
  BookmarkPlus,
  BookmarkCheck,
  CheckCircle2,
  ArrowRight,
  ExternalLink,
  HelpCircle,
  Award,
  Zap,
  Plus,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type FuriganaWord,
  type TextbookVocabulary,
} from '../models/textbook.js';
import { sound } from '../utils/audio.js';
import { useReadingFocusStore } from '../stores/useReadingFocusStore.js';
import { usePipelineJobStore } from '../stores/usePipelineJobStore.js';
import { ShimmerButton } from './magicui/index.js';
import { InteractivePdfReader } from './InteractivePdfReader.js';
import { TextbookImporterModal } from './TextbookImporterModal.js';
import { BookStructureRow } from './BookStructureRow.js';
import { EnrichJobPanel } from './EnrichJobPanel.js';
import {
  useTextbooksQuery,
  useImportTextbookMutation,
  useEnrichLessonMutation,
  useTextbookLessonQuizMutation,
  usePrependQuestionMutation,
  useReadingPositionQuery,
  useSaveReadingPositionMutation,
  useRecordReadingExposuresMutation,
} from '../queries/useLearnerQueries.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { pickDefaultTextbook, targetLanguageToFilter } from '../lib/textbook-default.js';
import { toUiQuizType } from '@study-studio/protocol';
import type { QuizQuestionItem } from '../models/learning.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';

interface TextbookCurriculumProps {
  onStartLessonQuiz: (lessonId: string, lessonTitle: string) => void;
  onAddCardFromTextbook: (vocab: { front: string; back: string; category: string; prompt: string }) => void;
  onAddCardsBatch?: (cards: { front: string; back: string; category: string; prompt: string }[]) => void;
  onAskAiTutor?: (selectedText: string, contextPrompt: string) => void;
}

export function TextbookCurriculum({
  onStartLessonQuiz,
  onAddCardFromTextbook,
  onAddCardsBatch,
  onAskAiTutor,
}: TextbookCurriculumProps) {
  const { data: booksList = [] } = useTextbooksQuery();
  const targetLanguage = useUserProfileStore((s) => s.profile.targetLanguage);
  const importTextbook = useImportTextbookMutation();
  const enrichLesson = useEnrichLessonMutation();
  const [selectedBookId, setSelectedBookId] = useState<string>('');
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [lessonSubTab, setLessonSubTab] = useState<'READER' | 'VOCAB' | 'GRAMMAR'>('READER');
  const [activeWordCard, setActiveWordCard] = useState<FuriganaWord | null>(null);
  const [addedCardsMap, setAddedCardsMap] = useState<Record<string, boolean>>({});
  const isImporterOpen = usePipelineJobStore((s) => s.isImporterModalOpen);
  const setIsImporterOpen = usePipelineJobStore((s) => s.setIsImporterModalOpen);
  // B：默认跟轨道（ja→JA/en→EN/ko→KO，不要 ALL），ALL 仍在下拉里可手选。
  const [languageFilter, setLanguageFilter] = useState<'ALL' | 'JA' | 'EN' | 'KO'>(
    () => targetLanguageToFilter(targetLanguage)
  );

  React.useEffect(() => {
    if (booksList.length === 0) return;
    const stillValid = booksList.some((b) => b.id === selectedBookId);
    if (!stillValid) {
      const pick = pickDefaultTextbook(booksList, languageFilter);
      setSelectedBookId(pick?.id ?? '');
      setSelectedLessonId(pick?.lessons[0]?.id ?? '');
    }
  }, [booksList, selectedBookId, languageFilter]);

  const filteredBooks = booksList.filter((b) => {
    if (languageFilter === 'ALL') return true;
    return (b.language || 'JA') === languageFilter;
  });

  const currentBook =
    filteredBooks.find((b) => b.id === selectedBookId || (b.documentId && b.documentId === selectedBookId)) ??
    pickDefaultTextbook(filteredBooks, languageFilter) ??
    pickDefaultTextbook(booksList, languageFilter);
  const currentLesson = currentBook?.lessons.find((l) => l.id === selectedLessonId) ?? currentBook?.lessons[0];

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

  // 本课真出题（自包含：mutation + 题库前插 + 切 QUIZ；App 传的旧假跳转仅作无 documentId 防御回退）。
  const lessonQuiz = useTextbookLessonQuizMutation();
  const prependQuestion = usePrependQuestionMutation();
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const setQuestionIndex = useStudySessionStore((s) => s.setQuestionIndex);
  const [quizzing, setQuizzing] = useState(false);

  const toQuizItem = (raw: Record<string, unknown>, category: string): QuizQuestionItem => {
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const rawOptions = Array.isArray(raw.options)
      ? raw.options.map((text: unknown, i: number) => ({
          key: String.fromCharCode(65 + i),
          text: str(text),
        }))
      : undefined;
    return {
      id: str(raw.id),
      type: toUiQuizType(str(raw.type) || 'MULTIPLE_CHOICE'),
      category,
      prompt: str(raw.prompt),
      content: str(raw.content),
      ...(rawOptions ? { options: rawOptions } : {}),
      correctAnswer: str(raw.correctAnswer),
      explanation: str(raw.explanation),
      testedSkill: str(raw.testedSkillId),
    };
  };

  const startRealLessonQuiz = async (
    documentId: string | undefined,
    lessonId: string,
    lessonTitle: string
  ) => {
    if (!documentId) {
      onStartLessonQuiz(lessonId, lessonTitle);
      return;
    }
    sound.playClick();
    setQuizzing(true);
    try {
      const r = await lessonQuiz.mutateAsync({ documentId, lessonId, count: 5 });
      if (r.questions.length === 0) {
        toast.error('本课暂无可用语料出题');
        return;
      }
      const category = `教材专属 · 《${r.bookTitle}》${r.lessonTitle}`;
      // 逐题前插：倒序插回后正序（首题即第 0 题）。
      for (let i = r.questions.length - 1; i >= 0; i--) {
        prependQuestion.mutate(toQuizItem(r.questions[i] ?? {}, category));
      }
      setQuestionIndex(0);
      setActiveTab('QUIZ');
      sound.playSuccess();
      toast.success(`已按本课出 ${r.questions.length} 道题（已同步收进练习队列）`);
    } catch (e) {
      sound.playMistake();
      toast.error(e instanceof Error ? e.message : '本课出题失败');
    } finally {
      setQuizzing(false);
    }
  };

  // 断点续读：书就位后，若有保存的课次且合法，切过去（每本书只恢复一次，不跟用户手动选择抢）。
  const { data: savedPosition } = useReadingPositionQuery(currentBook?.documentId);
  const savePosition = useSaveReadingPositionMutation();
  const restoredBookRef = React.useRef<string>('');
  React.useEffect(() => {
    const book = currentBook;
    const lessonId = savedPosition?.lessonId;
    if (!book?.documentId || !lessonId) return;
    if (restoredBookRef.current === book.id) return;
    restoredBookRef.current = book.id;
    const valid = book.lessons.some((l) => l.id === lessonId);
    if (valid && lessonId !== selectedLessonId) {
      setSelectedLessonId(lessonId);
    }
  }, [currentBook, savedPosition, selectedLessonId]);

  // 课次切换即记位置（离散事件，无需防抖；静默失败不打扰阅读）。
  React.useEffect(() => {
    const documentId = currentBook?.documentId;
    if (!documentId || !selectedLessonId) return;
    savePosition.mutate({ documentId, locator: { lessonId: selectedLessonId } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.documentId, selectedLessonId]);

  // 打开课次即记相遇（reading 源）：生词表来自 AST 非 NLP；同课只记一次，同天由网关去重。
  const recordExposures = useRecordReadingExposuresMutation();
  const exposedLessonRef = React.useRef<string>('');
  React.useEffect(() => {
    const book = currentBook;
    const lesson = currentLesson;
    if (!book?.documentId || !lesson || exposedLessonRef.current === lesson.id) return;
    const language =
      book.language === 'JA' ? 'ja' : book.language === 'EN' ? 'en' : book.language === 'KO' ? 'ko' : null;
    if (!language || lesson.vocabularies.length === 0) {
      exposedLessonRef.current = lesson.id;
      return;
    }
    exposedLessonRef.current = lesson.id;
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
  }, [currentBook?.documentId, currentLesson?.id]);

  if (!currentBook || !currentLesson) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-sm text-ink-stone-500">
          {booksList.length === 0
            ? '暂无教材。内置课程教材由 Gateway 启动时自动入库；也可导入自定义教材 AST。'
            : '教材结构加载中…'}
        </p>
        {booksList.length === 0 && (
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              setIsImporterOpen(true);
            }}
            className="text-xs font-semibold text-accent-ink-warm underline underline-offset-4"
          >
            打开教材导入器
          </button>
        )}
        {/* 注意：导入器必须在 early return 内也挂载，否则空库时点击无反应 */}
        <TextbookImporterModal
          isOpen={isImporterOpen}
          onClose={() => setIsImporterOpen(false)}
          existingBooks={booksList
            .filter((b) => b.documentId)
            .map((b) => ({
              documentId: b.documentId as string,
              title: b.shortTitle || b.title,
              lessons: b.lessons.length,
            }))}
          onImportBook={(newBook) => {
            importTextbook.mutate(newBook);
            setSelectedBookId(newBook.id);
            setSelectedLessonId(newBook.lessons[0]?.id ?? '');
          }}
          onSelectBook={(documentId) => {
            setSelectedBookId(documentId);
            setIsImporterOpen(false);
          }}
          onAddCardsBatch={(cards) => {
            if (onAddCardsBatch) {
              onAddCardsBatch(cards);
            } else {
              cards.forEach((c) => onAddCardFromTextbook(c));
            }
          }}
        />
      </div>
    );
  }

  const handleWordClick = (word: FuriganaWord) => {
    sound.playClick();
    setActiveWordCard(word);
  };

  const handleAddCard = (word: FuriganaWord | TextbookVocabulary) => {
    sound.playCorrect();
    const isVocab = 'kanji' in word;
    const frontText = isVocab ? `${word.kanji} (${word.kana})` : `${word.surface} ${word.reading ? `(${word.reading})` : ''}`;
    const backText = isVocab ? `${word.chinese} [${word.pos} · ${word.pitchAccent}]` : `${word.meaning ?? ''} [${word.pos ?? ''}]`;
    const cardKey = isVocab ? word.id : word.surface;

    onAddCardFromTextbook({
      front: frontText,
      back: backText,
      category: 'VOCAB',
      prompt: `来自《${currentBook.shortTitle}》${currentLesson.title}`,
    });

    setAddedCardsMap((prev) => ({ ...prev, [cardKey]: true }));
    toast.success(`已加入 FSRS 记忆闪卡：${frontText}`);
  };

  return (
    <div className="space-y-6">
      {/* 顶部教材选择器与信息栏 */}
      <div className="bg-paper-soft rounded-2xl p-4 sm:p-6 border border-line-accent shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="amber">{currentBook.level}</Badge>
              <span className="text-xs text-ink-ghost">
                {currentBook.publisher} · 共 {currentBook.totalLessons} 课
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-ink mt-1">
              {currentBook.title}
            </h2>
          </div>

          {/* 语种筛选与教材快速切换 Tab 与导入入口 */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={languageFilter}
              onValueChange={(val) => {
                if (!val) return;
                sound.playClick();
                const nextFilter = val as 'ALL' | 'JA' | 'EN' | 'KO';
                setLanguageFilter(nextFilter);
                const match = booksList.find(
                  (b) => nextFilter === 'ALL' || (b.language || 'JA') === nextFilter
                );
                if (match) {
                  setSelectedBookId(match.id);
                  setSelectedLessonId(match.lessons[0]?.id ?? '');
                }
              }}
            >
              <SelectTrigger className="w-[7.5rem]">
                <SelectValue placeholder="语种" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部语种</SelectItem>
                <SelectItem value="JA">🇯🇵 日语</SelectItem>
                <SelectItem value="EN">🇬🇧 英语</SelectItem>
                <SelectItem value="KO">🇰🇷 韩语</SelectItem>
              </SelectContent>
            </Select>

            <Tabs
              value={selectedBookId}
              onValueChange={(val) => {
                if (!val) return;
                sound.playClick();
                setSelectedBookId(val);
                const book = filteredBooks.find((b) => b.id === val);
                setSelectedLessonId(book?.lessons[0]?.id ?? '');
              }}
            >
              <TabsList className="bg-veil-stone-200o60-stone-900">
                <TabsIndicator />
                {filteredBooks.map((book) => (
                  <TabsTrigger key={book.id} value={book.id} className="px-3 py-1.5 text-xs">
                    {book.language === 'EN' ? '🇬🇧 ' : book.language === 'KO' ? '🇰🇷 ' : '🇯🇵 '}
                    {book.shortTitle}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Button
              variant="amber"
              size="sm"
              onClick={() => {
                sound.playClick();
                setIsImporterOpen(true);
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>导入新教材</span>
            </Button>
          </div>
        </div>
        <BookStructureRow
          documentId={currentBook?.documentId}
          bookTitle={currentBook?.shortTitle || currentBook?.title || ''}
        />
        <div className="mt-3">
          <EnrichJobPanel
            documentId={currentBook?.documentId}
            pendingCount={
              currentBook?.lessons.filter((l) => l.vocabularies.length === 0).length ?? 0
            }
          />
        </div>
      </div>



      {/* 主体两栏布局：左侧课次导航树，右侧课文精读/词汇/文法工作台 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧：课次列表 */}
        <div className="lg:col-span-4 space-y-2">
          <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="text-sm font-bold text-ink-mute flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-accent-ink" />
              课程大纲结构 (Textbook AST)
            </h3>
            <span className="text-xs text-ink-hint">
              {currentBook.lessons.length} 个单元
            </span>
          </div>

          <div className="space-y-2">
            {currentBook.lessons.map((lesson) => {
              const isSelected = lesson.id === selectedLessonId;
              return (
                <Button
                  key={lesson.id}
                  variant="ghost"
                  onClick={() => {
                    sound.playClick();
                    setSelectedLessonId(lesson.id);
                    setActiveWordCard(null);
                  }}
                  className={`w-full h-auto text-left p-3.5 rounded-xl border justify-start transition-colors ${
                    isSelected
                      ? 'bg-wash-amber-500o10 dark:bg-tone-amber-500o20 border-tone-amber-500o40 shadow-sm hover:bg-wash-amber-500o15'
                      : 'bg-paper-soft border-line-amber-900o10-amber-500o10 hover:border-line-amber-500o30'
                  }`}
                >
                  <div className="w-full">
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge variant="amber" className="rounded text-[11px] font-mono">
                        Lesson {lesson.lessonNumber}
                      </Badge>
                      <h4 className="text-sm font-bold text-ink mt-1">
                        {lesson.title}
                      </h4>
                      <p className="text-xs text-ink-ghost mt-0.5">
                        {lesson.subTitle}
                      </p>
                    </div>
                    {isSelected && (
                      <ChevronRight className="w-4 h-4 text-accent-ink shrink-0 mt-1" />
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-2 text-[11px] text-ink-hint">
                    <span>词汇: {lesson.vocabularies.length}</span>
                    <span>文法: {lesson.grammarPoints.length}</span>
                    <span>会话: {lesson.dialogues.length}</span>
                  </div>
                  </div>
                </Button>
              );
            })}
          </div>
        </div>

        {/* 右侧：课文精读 / 词汇 / 文法 / 专属测验（划选查词域：语种由课本声明） */}
        <div
          className="lg:col-span-8 space-y-4"
          data-lookup-scope={currentBook.language === 'EN' ? 'en' : currentBook.language === 'KO' ? 'ko' : 'ja'}
        >
          {/* 课次标题与快速靶向测验启动栏 */}
          <div className="bg-paper-soft rounded-2xl p-5 border border-line-accent shadow-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-accent-ink-warm font-semibold">
                    场景：{currentLesson.scene}
                  </span>
                  <span className="text-xs text-ink-stone-400">•</span>
                  <span className="text-xs text-ink-ghost">
                    等级：{currentLesson.targetLevel}
                  </span>
                </div>
                <h3 className="text-xl font-bold font-serif text-ink mt-1">
                  {currentLesson.title}
                </h3>
              </div>

              {/* 针对本课出题按钮 */}
              <div className="flex items-center gap-2 shrink-0">
                {currentLesson.vocabularies.length === 0 && currentBook.documentId && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={enrichLesson.isPending}
                    onClick={() => {
                      sound.playClick();
                      enrichLesson.mutate(
                        { documentId: currentBook.documentId as string, lessonId: currentLesson.id },
                        {
                          onSuccess: (r) => {
                            sound.playCorrect();
                            toast.success(
                              `AI 抽取完成：生词 ${r.vocabularies} · 文法 ${r.grammarPoints}` +
                                (r.dropped > 0 ? `（丢弃可疑 ${r.dropped} 条）` : '') +
                                (r.draftsProposed > 0
                                  ? ` · ${r.draftsProposed} 条已进生词草稿箱待确认`
                                  : '')
                            );
                          },
                          onError: (e) => {
                            sound.playMistake();
                            toast.error(e instanceof Error ? e.message : '抽生词失败');
                          },
                        }
                      );
                    }}
                    className="gap-1.5"
                    title="AI 按本课课文抽生词与文法（非法条目自动丢弃）"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-tone-amber-500" />
                    <span>{enrichLesson.isPending ? '抽取中…' : 'AI 抽生词'}</span>
                  </Button>
                )}
                <ShimmerButton
                  onClick={() => {
                    sound.playClick();
                    void startRealLessonQuiz(
                      currentBook?.documentId,
                      currentLesson.id,
                      currentLesson.title
                    );
                  }}
                  className="px-4 py-2 text-xs font-semibold flex items-center gap-2 shadow-md shrink-0"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{quizzing ? '出题中…' : '启动本课专属自测 (按课文出题)'}</span>
                </ShimmerButton>
              </div>
            </div>

            {/* 子选项卡：交互精读与原版排版 | 核心词汇 | 核心语法 */}
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-line-amber-900o10-amber-500o10">
              <Tabs
                value={lessonSubTab}
                onValueChange={(val) => {
                  if (!val) return;
                  sound.playClick();
                  setLessonSubTab(val as typeof lessonSubTab);
                }}
              >
                <TabsList className="bg-transparent p-0 border-0">
                  <TabsIndicator className="bg-tone-amber-500 shadow-sm" />
                  <TabsTrigger
                    value="READER"
                    className="px-3 py-1.5 text-xs data-[selected]:text-tone-stone-950"
                  >
                    📖 交互精读与排版 ({currentLesson.dialogues.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="VOCAB"
                    className="px-3 py-1.5 text-xs data-[selected]:text-tone-stone-950"
                  >
                    📚 重点词汇库 ({currentLesson.vocabularies.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="GRAMMAR"
                    className="px-3 py-1.5 text-xs data-[selected]:text-tone-stone-950"
                  >
                    💡 核心文法剖析 ({currentLesson.grammarPoints.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          {/* 子内容 1: 交互式阅读器 (双模式：原版双栏排版 + 划词查词 + 闪卡 + AI 导师) */}
          {lessonSubTab === 'READER' && (
            <InteractivePdfReader
              book={currentBook}
              lesson={currentLesson}
              onAddCard={onAddCardFromTextbook}
              onStartLessonQuiz={(lessonId, lessonTitle) =>
                void startRealLessonQuiz(currentBook?.documentId, lessonId, lessonTitle)
              }
              onAskAiTutor={onAskAiTutor ?? (() => {})}
            />
          )}


          {/* 子内容 2: 重点词汇库 */}
          {lessonSubTab === 'VOCAB' && (
            <div className="bg-paper-soft rounded-2xl p-5 border border-line-accent space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {currentLesson.vocabularies.map((vocab) => {
                  const isAdded = addedCardsMap[vocab.id];
                  return (
                    <div
                      key={vocab.id}
                      className="p-3.5 rounded-xl bg-veil-stone-100o70-stone-900o50 border border-tone-stone-200o80-stone-800 flex flex-col justify-between gap-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-base font-bold text-ink">
                              {vocab.kanji}
                            </span>
                            <span className="text-xs text-accent-ink-warm font-mono">
                              {vocab.kana}
                            </span>
                          </div>
                          <p className="text-xs text-ink-faint-soft mt-1 font-serif">
                            {vocab.chinese}
                          </p>
                        </div>

                        <div className="flex items-center gap-1">
                          <Badge variant="secondary" className="rounded text-[10px] font-mono">
                            {vocab.pitchAccent} {vocab.pitchType}
                          </Badge>
                        </div>
                      </div>

                      <div className="text-[11px] text-ink-ghost bg-veil-stone-200o50-stone-800o40 p-2 rounded-lg">
                        <p className="font-medium text-ink-mute">{vocab.exampleSentence}</p>
                        <p className="text-ink-stone-500">{vocab.exampleTranslation}</p>
                      </div>

                      <div className="flex justify-end pt-1">
                        <Button
                          variant={isAdded ? 'secondary' : 'amber'}
                          size="sm"
                          onClick={() => handleAddCard(vocab)}
                          disabled={isAdded}
                          className="gap-1 h-7"
                        >
                          {isAdded ? (
                            <>
                              <BookmarkCheck className="w-3.5 h-3.5" />
                              <span>已加入复习</span>
                            </>
                          ) : (
                            <>
                              <BookmarkPlus className="w-3.5 h-3.5" />
                              <span>加为 FSRS 闪卡</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 子内容 3: 核心文法剖析 */}
          {lessonSubTab === 'GRAMMAR' && (
            <div className="space-y-4">
              {currentLesson.grammarPoints.map((gp) => (
                <div
                  key={gp.id}
                  className="bg-paper-soft rounded-2xl p-5 border border-line-accent space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <h4 className="text-base font-bold text-ink font-serif">
                      {gp.title}
                    </h4>
                    <Badge variant="amber" className="text-[11px] font-mono">
                      {gp.structure}
                    </Badge>
                  </div>

                  <p className="text-xs sm:text-sm text-ink-mute leading-relaxed">
                    {gp.explanation}
                  </p>

                  {gp.contrast && (
                    <div className="p-2.5 rounded-xl bg-wash-amber-500o10-amber-500o15 border border-tone-amber-500o20 text-xs text-ink-amber-950-amber-200">
                      💡 <span className="font-semibold">辨析要点：</span>{gp.contrast}
                    </div>
                  )}

                  <div className="space-y-1.5 pt-2">
                    <p className="text-xs font-semibold text-ink-ghost">典型用例：</p>
                    {gp.examples.map((ex, exIdx) => (
                      <div
                        key={exIdx}
                        className="p-2.5 rounded-lg bg-veil-stone-100o80-stone-900o60 text-xs space-y-0.5"
                      >
                        <p className="font-medium text-ink">{ex.ja}</p>
                        <p className="text-ink-ghost font-serif">{ex.zh}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 导入教材模态框 */}
      <TextbookImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        existingBooks={booksList
          .filter((b) => b.documentId)
          .map((b) => ({
            documentId: b.documentId as string,
            title: b.shortTitle || b.title,
            lessons: b.lessons.length,
          }))}
        onImportBook={(newBook) => {
          importTextbook.mutate(newBook);
          setSelectedBookId(newBook.id);
          setSelectedLessonId(newBook.lessons[0]?.id ?? '');
        }}
        onSelectBook={(docId) => {
          const matched = booksList.find((b) => b.id === docId || (b.documentId && b.documentId === docId));
          if (matched) {
            setSelectedBookId(matched.id);
            setSelectedLessonId(matched.lessons[0]?.id ?? '');
          } else {
            setSelectedBookId(docId);
          }
          setIsImporterOpen(false);
          sound.playCorrect();
        }}
        onAddCardsBatch={(cards) => {
          if (onAddCardsBatch) {
            onAddCardsBatch(cards);
          } else {
            cards.forEach((c) => onAddCardFromTextbook(c));
          }
        }}
      />
    </div>
  );
}

