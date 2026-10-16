import React, { useState } from 'react';
import { Search, Volume2, ExternalLink } from 'lucide-react';
import { sound, speechStudio } from '../../utils/audio.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from '../ui/tabs.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import {
  useDictionaryLookupQuery,
  type PitchLexiconItem,
} from '../../queries/useLearnerQueries.js';

interface PitchWordPickerProps {
  words: PitchLexiconItem[];
  selectedWordIndex: number;
  onSelectWord: (index: number) => void;
}

/**
 * 词表导航 + 本地词典查询：
 * 基准词表 Tabs 切换；本地词典优先，OJAD 只作未命中时的外部检索。
 */
export function PitchWordPicker({ words, selectedWordIndex, onSelectWord }: PitchWordPickerProps) {
  const [dictionaryInput, setDictionaryInput] = useState('');
  const [dictionaryQuery, setDictionaryQuery] = useState('');
  const dictionaryLookup = useDictionaryLookupQuery('ja', dictionaryQuery);

  return (
    <div className="space-y-4">
      <Tabs
        value={String(selectedWordIndex)}
        onValueChange={(val) => {
          if (val == null) return;
          sound.playClick();
          onSelectWord(Number(val));
        }}
      >
        <TabsList className="bg-veil-stone-200o60-stone-900 flex-wrap h-auto">
          <TabsIndicator />
          {words.map((item, idx) => (
            <TabsTrigger key={item.id} value={String(idx)} className="px-3 py-1.5 text-xs">
              {item.kanji} ({item.kana})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <form
        className="surface-card rounded-2xl p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setDictionaryQuery(dictionaryInput.trim());
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <label htmlFor="ja-dictionary-query" className="text-sm font-semibold text-ink-soft">
              日语词典查询
            </label>
            <p className="mt-0.5 text-xs text-ink-ghost">
              优先检索应用本地词表；未收录时可前往 OJAD 自行确认。
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <input
              id="ja-dictionary-query"
              value={dictionaryInput}
              onChange={(event) => setDictionaryInput(event.target.value)}
              placeholder="例如：雨、あめ、ame"
              className="h-9 min-w-0 flex-1 rounded-xl border border-line-hairline bg-surface-coal/60 px-3 text-sm text-ink outline-none transition focus-visible:border-tone-amber-500 focus-visible:ring-2 focus-visible:ring-focus-ring sm:w-56"
            />
            <Button type="submit" size="sm" disabled={!dictionaryInput.trim() || dictionaryLookup.isFetching}>
              <Search className="h-3.5 w-3.5" />
              查询
            </Button>
          </div>
        </div>

        {dictionaryQuery && (
          <div className="mt-3 border-t border-line-hairline pt-3 transition-colors">
            {dictionaryLookup.isFetching ? (
              <p className="text-xs text-ink-stone-500">正在查询本地词典…</p>
            ) : dictionaryLookup.isError ? (
              <div className="space-y-2">
                <p className="text-xs text-ink-stone-500">
                  本地词典查询失败，请检查网关后重试。
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void dictionaryLookup.refetch()}
                  className="gap-1 text-xs"
                >
                  重新查询
                </Button>
              </div>
            ) : dictionaryLookup.data?.entries.length ? (
              <div className="space-y-2">
                {dictionaryLookup.data.entries.map((entry) => {
                  const pronunciation = entry.pronunciation as {
                    pitchType?: string;
                    pitchPattern?: string[];
                  } | undefined;
                  return (
                    <div key={entry.id} className="rounded-xl border border-line-hairline bg-surface-coal/60 p-3 text-sm transition-colors">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-serif text-lg font-bold text-ink">{entry.headword}</span>
                        {entry.reading && <span className="font-mono text-gold-warm">{entry.reading}</span>}
                        {entry.romanization && <span className="text-xs text-ink-stone-500">{entry.romanization}</span>}
                        <button
                          type="button"
                          title={`朗读${entry.reading || entry.headword}`}
                          onClick={() => {
                            sound.playClick();
                            void speechStudio.speak(entry.reading || entry.headword, {
                              lang: 'JA',
                              purpose: 'preview',
                            });
                          }}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full hover:bg-gold-warm/10 text-gold-warm cursor-pointer"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                        {pronunciation?.pitchType && <Badge variant="gold">{pronunciation.pitchType}</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-ink-faint">{entry.meanings.join('；')}</p>
                      {pronunciation?.pitchPattern && (
                        <p className="mt-1 font-mono text-xs text-ink-faint-soft">音调走向：{pronunciation.pitchPattern.join(' → ')}</p>
                      )}
                      <p className="mt-2 text-xs text-ink-faint-soft">来源：{entry.sourceLabel}</p>
                    </div>
                  );
                })}
              </div>
            ) : dictionaryLookup.data?.externalLookup ? (
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
                <span>本地词典暂未收录「{dictionaryQuery}」。</span>
                <a
                  href={dictionaryLookup.data.externalLookup.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-gold-warm hover:underline transition-colors"
                >
                  前往 OJAD 查询 <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ) : (
              <p className="text-xs text-ink-stone-500">暂时无法取得词典结果，请稍后重试。</p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
