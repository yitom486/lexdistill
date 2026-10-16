import React, { useState } from 'react';
import { toast } from 'sonner';
import { sound } from '../utils/audio.js';
import { usePipelineJobStore } from '../stores/usePipelineJobStore.js';
import { TextbookImporterModal } from './TextbookImporterModal.js';
import {
  useTextbooksQuery,
  useImportTextbookMutation,
} from '../queries/useLearnerQueries.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { useVocabularyQuery } from '../queries/vocabulary.js';
import { pickDefaultTextbook, targetLanguageToFilter } from '../lib/textbook-default.js';
import { Button } from './ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js';
import { StoredCurriculumHeader, type LanguageFilter } from './textbook/StoredCurriculumHeader.js';
import { StoredLessonList } from './textbook/StoredLessonList.js';
import { StoredLessonDetail, type LessonSubTab } from './textbook/StoredLessonDetail.js';
import { useStoredLessonActions } from './textbook/useStoredLessonActions.js';
import { useStoredReadingEffects } from './textbook/useStoredReadingEffects.js';

interface TextbookCurriculumProps {
  onStartLessonQuiz: (lessonId: string, lessonTitle: string) => void;
  onAddCardFromTextbook: (vocab: { front: string; back: string; category: string; prompt: string }) => Promise<unknown>;
  onAddCardsBatch?: (cards: { front: string; back: string; category: string; prompt: string }[]) => void | Promise<unknown>;
  onAskAiTutor?: (selectedText: string, contextPrompt: string) => void;
}

const TextbookLearningPreview = import.meta.env?.DEV ? React.lazy(() =>
  import('./textbook/preview/TextbookLearningPreview.js').then(module => ({ default: module.TextbookLearningPreview }))
) : null;

export function TextbookCurriculum(props: TextbookCurriculumProps) {
  return TextbookLearningPreview
    ? <React.Suspense fallback={<p className="p-6 text-sm text-ink-muted">正在打开教材学习页面…</p>}><TextbookLearningPreview {...props} /></React.Suspense>
    : <StoredTextbookCurriculum {...props} />;
}

function StoredTextbookCurriculum({
  onStartLessonQuiz,
  onAddCardFromTextbook,
  onAddCardsBatch,
  onAskAiTutor,
}: TextbookCurriculumProps) {
  const textbooksQuery = useTextbooksQuery();
  const booksList = textbooksQuery.data ?? [];
  const targetLanguage = useUserProfileStore((s) => s.profile.targetLanguage);
  const importTextbook = useImportTextbookMutation();
  const [selectedBookId, setSelectedBookId] = useState<string>('');
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [lessonSubTab, setLessonSubTab] = useState<LessonSubTab>('READER');
  const isImporterOpen = usePipelineJobStore((s) => s.isImporterModalOpen);
  const setIsImporterOpen = usePipelineJobStore((s) => s.setIsImporterModalOpen);
  // B：默认跟轨道（ja→JA/en→EN/ko→KO，不要 ALL），ALL 仍在下拉里可手选。
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
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
    pickDefaultTextbook(filteredBooks, languageFilter);
  const currentLesson = currentBook?.lessons.find((l) => l.id === selectedLessonId) ?? currentBook?.lessons[0];
  const vocabularyQuery = useVocabularyQuery(currentBook?.language?.toLowerCase() ?? targetLanguage);

  useStoredReadingEffects({
    currentBook,
    currentLesson,
    selectedLessonId,
    onRestoreLesson: setSelectedLessonId,
  });

  const actions = useStoredLessonActions({
    currentBook,
    currentLesson,
    vocabularyEntries: vocabularyQuery.data ?? [],
    onStartLessonQuiz,
  });

  const openImporter = () => {
    sound.playClick();
    setIsImporterOpen(true);
  };

  const selectBook = (id: string) => {
    sound.playClick();
    setSelectedBookId(id);
    const book = filteredBooks.find((b) => b.id === id);
    setSelectedLessonId(book?.lessons[0]?.id ?? '');
  };

  const selectLesson = (id: string) => {
    setSelectedLessonId(id);
  };

  const changeFilter = (next: LanguageFilter) => {
    setLanguageFilter(next);
    const match = booksList.find(
      (b) => next === 'ALL' || (b.language || 'JA') === next
    );
    if (match) {
      setSelectedBookId(match.id);
      setSelectedLessonId(match.lessons[0]?.id ?? '');
    } else {
      setSelectedBookId('');
      setSelectedLessonId('');
    }
  };

  // 导入器在空库与有书分支都要挂载（共用同一元素，不复制接线）。
  const importerModal = (
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
      onImportBook={async (newBook) => {
        await importTextbook.mutateAsync(newBook);
        if (usePipelineJobStore.getState().isImporterModalOpen) {
            setSelectedBookId(newBook.id);
            setSelectedLessonId(newBook.lessons[0]?.id ?? '');
        }
      }}
      onSelectBook={(documentId) => {
        const matched = booksList.find((b) => b.id === documentId || (b.documentId && b.documentId === documentId));
        if (matched) {
          setSelectedBookId(matched.id);
          setSelectedLessonId(matched.lessons[0]?.id ?? '');
        } else {
          setSelectedBookId(documentId);
        }
        setIsImporterOpen(false);
        sound.playCorrect();
      }}
      onAddCardsBatch={async (cards) => {
        if (onAddCardsBatch) {
          await onAddCardsBatch(cards);
        } else {
          await Promise.all(cards.map(c => onAddCardFromTextbook(c)));
        }
      }}
    />
  );

  // 加载/失败/成功空各自准确，不以空库掩盖失败
  if (textbooksQuery.isPending) {
    return (
      <div className="p-10 text-center space-y-3">
        <p role="status" className="text-sm text-ink-stone-500">
          正在读取教材库…
        </p>
      </div>
    );
  }
  if (textbooksQuery.isError && !booksList.length) {
    return (
      <div className="p-10 text-center space-y-3">
        <p role="alert" className="text-sm text-ink-stone-500">
          教材库读取失败，请检查网关后重试。
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => void textbooksQuery.refetch()} className="gap-1 text-xs">
          重新读取
        </Button>
      </div>
    );
  }

  if (!currentBook) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-sm text-ink-stone-500">
          {booksList.length ? '当前语种没有教材，可切换语种或导入教材。' : '暂无教材，可导入教材开始学习。'}
        </p>
        {booksList.length > 0 && <Select value={languageFilter} onValueChange={value => { if (value) changeFilter(value as LanguageFilter); }}>
          <SelectTrigger aria-label="教材语种" className="mx-auto w-40"><SelectValue>{({ ALL: '全部语种', JA: '日语', EN: '英语', KO: '韩语' })[languageFilter]}</SelectValue></SelectTrigger>
          <SelectContent>{(['ALL', 'JA', 'EN', 'KO'] as const).map(value => <SelectItem key={value} value={value}>{({ ALL: '全部语种', JA: '日语', EN: '英语', KO: '韩语' })[value]}</SelectItem>)}</SelectContent>
        </Select>}
        <button
          type="button"
          onClick={openImporter}
          className="text-xs font-semibold text-accent-ink-warm underline underline-offset-4"
        >
          打开教材导入器
        </button>
        {/* 注意：导入器必须在 early return 内也挂载，否则空库时点击无反应 */}
        {importerModal}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {textbooksQuery.isError && <p role="alert" className="text-xs text-ink-ghost">教材更新失败，以下是已读取内容。<Button size="sm" variant="outline" onClick={() => void textbooksQuery.refetch()}>重新读取</Button></p>}
      {/* 顶部教材选择器与信息栏 */}
      <StoredCurriculumHeader
        booksList={booksList}
        filteredBooks={filteredBooks}
        currentBook={currentBook}
        languageFilter={languageFilter}
        onFilterChange={changeFilter}
        selectedBookId={selectedBookId}
        onSelectBook={selectBook}
        onOpenImporter={openImporter}
      />

      {/* 主体两栏布局：左侧课次导航树，右侧课文精读/词汇/文法工作台 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <StoredLessonList
          lessons={currentBook.lessons}
          selectedLessonId={selectedLessonId}
          onSelect={selectLesson}
        />

        {/* 右侧：课文精读 / 词汇 / 文法 / 专属测验（划选查词域：语种由课本声明） */}
        <div
          className="lg:col-span-8 space-y-4"
          data-lookup-scope={currentBook.language === 'EN' ? 'en' : currentBook.language === 'KO' ? 'ko' : 'ja'}
        >
          {currentLesson ? <StoredLessonDetail
            book={currentBook}
            lesson={currentLesson}
            subTab={lessonSubTab}
            onSubTabChange={setLessonSubTab}
            actions={actions}
            onAddCardFromTextbook={onAddCardFromTextbook}
            onStartLessonQuiz={onStartLessonQuiz}
            {...(onAskAiTutor ? { onAskAiTutor } : {})}
          /> : <p className="text-sm text-ink-ghost">本教材暂无课次，可选择其他教材或打开导入器。</p>}
        </div>
      </div>

      {/* 导入教材模态框 */}
      {importerModal}
    </div>
  );
}
