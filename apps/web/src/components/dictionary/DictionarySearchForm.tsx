import { Search } from 'lucide-react';
import { Button } from '../ui/button.js';
import type { DictionaryHistoryItem } from '../../queries/useLearnerQueries.js';

interface DictionarySearchFormProps {
  language: string;
  title: string;
  helper: string;
  input: string;
  setInput: (v: string) => void;
  onSubmit: (query: string) => void;
  lookupFetching: boolean;
  history: DictionaryHistoryItem[];
}

/** 词典搜索表单 + 最近查词 chips（空输入禁用提交）。 */
export function DictionarySearchForm({
  language,
  title,
  helper,
  input,
  setInput,
  onSubmit,
  lookupFetching,
  history,
}: DictionarySearchFormProps) {
  return (
    <>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(input.trim());
        }}
      >
        <div className="min-w-0 flex-1">
          <label
            className="text-sm font-semibold text-ink-soft"
            htmlFor={`dictionary-${language}`}
          >
            {title}
          </label>
          <p className="mt-0.5 text-xs text-ink-ghost">{helper}</p>
          <input
            id={`dictionary-${language}`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={language === 'en' ? '例如：resilient' : '输入要查询的词'}
            className="mt-2 h-9 w-full rounded-xl border border-ink-stone-200 bg-tone-white px-3 text-sm text-tone-stone-900 outline-none transition focus:border-tone-amber-500 focus:ring-2 focus:ring-tone-amber-500o20 dark:border-tone-stone-700 dark:bg-tone-stone-900 dark:text-tone-stone-100"
          />
        </div>
        <Button type="submit" size="sm" disabled={!input.trim() || lookupFetching} className="gap-1.5">
          <Search className="h-3.5 w-3.5" />查询
        </Button>
      </form>

      {history.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {history.slice(0, 8).map((h) => (
            <button
              key={`${h.query}-${h.createdAt}`}
              type="button"
              onClick={() => onSubmit(h.query)}
              className="rounded-full border border-ink-stone-200 px-2.5 py-1 text-xs text-ink-stone-500 hover:border-tone-amber-500o50 hover:text-tone-amber-700 dark:border-tone-stone-700 dark:text-ink-stone-400 dark:hover:text-ink-amber-300 transition-colors"
              title={`最近查过（${h.hitCount} 条结果）`}
            >
              {h.query}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
