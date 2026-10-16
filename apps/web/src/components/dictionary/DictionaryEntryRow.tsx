import { BookOpen, BookPlus, Check, Send } from 'lucide-react';
import { sound } from '../../utils/audio.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { WordStudyCard } from '../WordStudyCard.js';
import type { LookupEntry } from '../DictionaryLookupPanel.js';

interface DictionaryEntryRowProps {
  entry: LookupEntry;
  language: 'en' | 'ja' | 'ko';
  studyId: string | null;
  setStudyId: (id: string | null) => void;
  collectedIds: string[];
  collectEntry: (entryId: string) => void;
  studyCompleteEntry: (entryId: string) => void;
  pushEntryToAnki: (entryId: string) => void;
  ankiPushable: boolean;
  collectPending: boolean;
  studyPending: boolean;
  pushPending: boolean;
  pronunciation?: React.ReactNode;
}

/** 词典结果条目：头词/读音/词性/释义/来源 + 收藏/讲透/推送同一动作。 */
export function DictionaryEntryRow({
  entry,
  language,
  studyId,
  setStudyId,
  collectedIds,
  collectEntry,
  studyCompleteEntry,
  pushEntryToAnki,
  ankiPushable,
  collectPending,
  studyPending,
  pushPending,
  pronunciation,
}: DictionaryEntryRowProps) {
  const expanded = studyId === entry.id;
  return (
    <div key={entry.id}>
      <div className="flex flex-col gap-2 rounded-xl bg-wash-amber-50o70 p-3 dark:bg-wash-amber-500o10 sm:flex-row sm:items-center sm:justify-between transition-colors">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-serif text-lg font-bold text-ink">
              {entry.headword}
            </span>
            {entry.reading && (
              <span className="font-mono text-xs text-accent-ink-strong">
                {entry.reading}
              </span>
            )}
            {entry.partOfSpeech && <Badge variant="outline">{entry.partOfSpeech}</Badge>}
            {pronunciation}
            {typeof entry.frequency === 'number' && (
              <Badge variant="secondary" className="font-mono" title="词频（数字越小越常用）">
                #{entry.frequency}
              </Badge>
            )}
            {entry.frequencies && entry.frequencies.length > 0 && (
              <span
                className="font-mono text-xs text-ink-hint"
                title="各来源词频（数字越小越常用）"
              >
                {entry.frequencies.map((f) => `${f.source} ${f.value}`).join(' · ')}
              </span>
            )}
          </div>
          {entry.inflectionNote && (
            <p className="mt-1 text-xs font-semibold text-ink-sky-700-sky-300">
              {entry.inflectionNote}
            </p>
          )}
          <p className="mt-1 text-xs text-ink-faint">
            {entry.meanings.join('；')}
          </p>
          <p className="mt-1 text-xs text-ink-stone-400">来源：{entry.sourceLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={expanded ? 'secondary' : 'ghost'}
            className="gap-1.5 text-xs"
            onClick={() => {
              sound.playClick();
              setStudyId(expanded ? null : entry.id);
            }}
            title="展开讲透卡：先学透发音释义，再决定收不收"
            aria-expanded={expanded}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {expanded ? '收起' : '学透它'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={collectPending}
            onClick={() => collectEntry(entry.id)}
          >
            {collectPending ? (
              <Check className="h-3.5 w-3.5 animate-pulse motion-reduce:animate-none" />
            ) : (
              <BookPlus className="h-3.5 w-3.5" />
            )}
            加入生词本
          </Button>
          {ankiPushable && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs"
              disabled={collectPending || pushPending}
              title="先加入生词本，再按卡片模板推送到本机 Anki"
              onClick={() => pushEntryToAnki(entry.id)}
            >
              <Send className="h-3.5 w-3.5" />
              推送 Anki
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <WordStudyCard
          entry={entry}
          language={language}
          collected={collectedIds.includes(entry.id)}
          collectPending={collectPending}
          studyPending={studyPending}
          onCollect={collectEntry}
          onStudyComplete={studyCompleteEntry}
        />
      )}
    </div>
  );
}
