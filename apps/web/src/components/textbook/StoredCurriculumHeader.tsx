import { Plus } from 'lucide-react';
import { sound } from '../../utils/audio.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from '../ui/tabs.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import type { TextbookBook } from '../../models/textbook.js';
import { BookStructureRow } from '../BookStructureRow.js';
import { EnrichJobPanel } from '../EnrichJobPanel.js';

export type LanguageFilter = 'ALL' | 'JA' | 'EN' | 'KO';

const LANGUAGE_FILTER_LABELS: Record<LanguageFilter, string> = {
  ALL: '全部语种',
  JA: '日语',
  EN: '英语',
  KO: '韩语',
};

interface CurriculumHeaderProps {
  booksList: TextbookBook[];
  filteredBooks: TextbookBook[];
  currentBook: TextbookBook;
  languageFilter: LanguageFilter;
  onFilterChange: (next: LanguageFilter) => void;
  selectedBookId: string;
  onSelectBook: (id: string) => void;
  onOpenImporter: () => void;
}

/** 教材头（纯展示）：书名信息、语种筛选、教材切换、导入入口与结构/任务行。 */
export function StoredCurriculumHeader({
  booksList,
  filteredBooks,
  currentBook,
  languageFilter,
  onFilterChange,
  selectedBookId,
  onSelectBook,
  onOpenImporter,
}: CurriculumHeaderProps) {
  return (
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
              onFilterChange(val as LanguageFilter);
            }}
          >
            <SelectTrigger className="w-[7.5rem]" aria-label="语种筛选">
              <SelectValue>{LANGUAGE_FILTER_LABELS[languageFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部语种</SelectItem>
              <SelectItem value="JA">日语</SelectItem>
              <SelectItem value="EN">英语</SelectItem>
              <SelectItem value="KO">韩语</SelectItem>
            </SelectContent>
          </Select>

          <Tabs value={selectedBookId} onValueChange={(val) => val && onSelectBook(val)}>
            <TabsList className="bg-veil-stone-200o60-stone-900">
              <TabsIndicator />
              {filteredBooks.map((book) => (
                <TabsTrigger key={book.id} value={book.id} className="px-3 py-1.5 text-xs">
                  {book.shortTitle}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Button variant="amber" size="sm" onClick={onOpenImporter}>
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
  );
}
