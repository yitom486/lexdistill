import { ArrowLeft } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { useTextbooksQuery, useImportTextbookMutation } from '../../../queries/textbooks-annotations.js';
import { useTextbookNavigationStore } from '../../../stores/useTextbookNavigationStore.js';
import { useUserProfileStore } from '../../../stores/useUserProfileStore.js';
import { usePipelineJobStore } from '../../../stores/usePipelineJobStore.js';
import { DEFAULT_USER_ID } from '../../../queries/query-keys.js';
import { previewBooks } from '../../../fixtures/textbook-learning-preview.js';
import { exercisePreviewBook } from '../../../fixtures/textbook-exercise-preview.js';
import { previewStudy } from '../../../fixtures/textbook-study-preview.js';
import { TextbookLibraryHome } from './TextbookLibraryHome.js';
import { TextbookChapterList } from './TextbookChapterList.js';
import { LearningPreviewPage } from './LearningPreviewPage.js';
import { savedBookView, type LearningLibraryBook } from './library-view.js';
import { TextbookImporterModal } from '../../TextbookImporterModal.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';

type Card = { front: string; back: string; category: string; prompt: string };
export function TextbookLearningPreview({ onAddCardFromTextbook, onAddCardsBatch, onAskAiTutor }: {
  onAddCardFromTextbook: (card: Card) => void | Promise<unknown>; onAddCardsBatch?: (cards: Card[]) => void | Promise<unknown>;
  onAskAiTutor?: ((text: string, context: string) => void) | undefined;
}) {
  const userId = useUserProfileStore(state => state.profile.userId) || DEFAULT_USER_ID;
  const query = useTextbooksQuery(userId), importBook = useImportTextbookMutation(userId);
  const navigation = useTextbookNavigationStore();
  const importerOpen = usePipelineJobStore(state => state.isImporterModalOpen);
  const setImporterOpen = usePipelineJobStore(state => state.setIsImporterModalOpen);
  const books = [...(query.data ?? []).map(savedBookView), ...previewBooks, exercisePreviewBook];
  const selectedBook = books.find(book => book.id === navigation.selectedBookId);
  const chapter = selectedBook?.chapters.find(item => item.id === navigation.chaptersByBook[selectedBook.id]);
  const openBook = (book: LearningLibraryBook) => {
    const selected = book.chapters.find(item => item.id === navigation.chaptersByBook[book.id]) ?? book.chapters[0];
    if (selected) navigation.openBook(book.id, selected.id);
  };
  const showStudy = navigation.view === 'STUDY' && selectedBook && chapter;
  return <>
    {showStudy ? <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => navigation.openChapterList(selectedBook.id)}><ArrowLeft className="h-4 w-4" />返回章节列表</Button><Button variant="ghost" size="sm" onClick={navigation.backToLibrary}>返回教材首页</Button></div><Select value={chapter.id} onValueChange={id => id && navigation.selectChapter(selectedBook.id, id)}><SelectTrigger className="w-[min(420px,100%)]" aria-label="选择章节"><SelectValue>{chapter.title}</SelectValue></SelectTrigger><SelectContent>{selectedBook.chapters.map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></div>
      <div className="flex h-[calc(100dvh-220px)] min-h-[480px] flex-col overflow-hidden rounded-2xl border border-line-soft"><LearningPreviewPage key={chapter.id} bookId={selectedBook.id} bookTitle={selectedBook.title} chapterTitle={chapter.title} chapterId={chapter.id} subtitle={chapter.subtitle} language={selectedBook.language} content={chapter.content} temporary={selectedBook.temporary} study={selectedBook.temporary ? previewStudy[chapter.id] : undefined} onAskAiTutor={onAskAiTutor} /></div>
    </div> : navigation.view === 'CHAPTERS' && selectedBook ? <TextbookChapterList book={selectedBook} rememberedChapterId={navigation.chaptersByBook[selectedBook.id]} onSelect={id => navigation.openBook(selectedBook.id, id)} onBack={navigation.backToLibrary} /> : <TextbookLibraryHome books={books} rememberedChapters={navigation.chaptersByBook} onOpen={openBook} onBrowse={book => navigation.openChapterList(book.id)} onOpenExerciseExamples={() => openBook(exercisePreviewBook)} onImport={() => setImporterOpen(true)} onRefresh={() => { void query.refetch(); }} loading={query.isFetching} loadError={query.isError} hasSavedResult={query.data !== undefined} />}
    {importerOpen && <TextbookImporterModal isOpen={importerOpen} onClose={() => setImporterOpen(false)} existingBooks={(query.data ?? []).flatMap(book => book.documentId ? [{ documentId: book.documentId, title: book.title, lessons: book.lessons.length }] : [])}
      onImportBook={async book => { await importBook.mutateAsync(book); if (usePipelineJobStore.getState().isImporterModalOpen) openBook(savedBookView(book)); }}
      onSelectBook={id => { const book = books.find(item => item.id === id); if (book) openBook(book); setImporterOpen(false); }}
      onAddCardsBatch={async cards => { if (onAddCardsBatch) await onAddCardsBatch(cards); else await Promise.all(cards.map(onAddCardFromTextbook)); }} />}
  </>;
}
