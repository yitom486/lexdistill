import { Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { sound } from '../../utils/audio.js';
import type { WordlistGroup } from '../../queries/wordlists.js';
import { WordStudyCard } from '../WordStudyCard.js';

interface DictionaryWordlistProps {
  language: 'en' | 'ja' | 'ko';
  groups: WordlistGroup[];
  wordlistsLoading: boolean;
  wordlistsError?: boolean;
  onRetry?: () => void;
  collectedIds: string[];
  studyId: string | null;
  setStudyId: (id: string | null) => void;
  collectEntry: (entryId: string) => void;
  studyCompleteEntry: (entryId: string) => void;
  collectPending: boolean;
  studyPending: boolean;
  onGoToStudy?: (() => void) | undefined;
}

/** 零基础单词表：按顺序点词展开学透（收进生词本直接纳入 FSRS 复习）。 */
export function DictionaryWordlist({
  language,
  groups,
  wordlistsLoading,
  wordlistsError,
  onRetry,
  collectedIds,
  studyId,
  setStudyId,
  collectEntry,
  studyCompleteEntry,
  collectPending,
  studyPending,
  onGoToStudy,
}: DictionaryWordlistProps) {
  return (
    <div className="mt-3 border-t border-ink-stone-200 pt-3 dark:border-tone-stone-800 space-y-3 transition-colors">
      {onGoToStudy && (
        <div className="flex items-center justify-between rounded-2xl border border-line-amber-900o10 bg-wash-amber-500o5 p-3 text-xs">
          <div className="space-y-0.5">
            <span className="font-semibold text-ink flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-accent-ink-warm" />
              想要每天抽取 10–20 词系统深度精学？
            </span>
            <p className="text-xs text-ink-ghost">
              推荐使用「今日学词」模块，结合情景对话与随堂小测深度理解！
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-xs gap-1 shrink-0"
            onClick={onGoToStudy}
          >
            前往今日学词 →
          </Button>
        </div>
      )}
      <p className="text-xs font-bold text-ink-ghost">
        零基础单词表 · 按顺序点词展开学透（收进生词本直接纳入 FSRS 科学复习）
      </p>
      {wordlistsLoading && <p className="text-xs text-ink-stone-500">单词表加载中…</p>}
      {wordlistsError && <p role="alert" className="text-xs text-ink-stone-500">
        单词表读取失败。{groups.length > 0 ? '显示上次读取的词表，可能不是最新。' : ''}
        <Button type="button" size="sm" variant="link" onClick={onRetry}>重新读取词表</Button>
      </p>}
      {groups.map((group) => {
        const done = group.words.filter(
          (w) => w.collected || collectedIds.includes(w.entryId)
        ).length;
        return (
          <div key={group.id} className="space-y-1.5">
            <p className="text-xs font-semibold text-ink-mute-deep">
              {group.title}
              <span className="ml-2 font-mono text-xs text-ink-stone-400">
                {done}/{group.words.length} 已收
              </span>
            </p>
            {group.subtitle && <p className="text-xs text-ink-stone-400">{group.subtitle}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {group.words.map((w) => {
                const isCollected = w.collected || collectedIds.includes(w.entryId);
                const expanded = studyId === w.entryId;
                return (
                  <div key={w.entryId} className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={() => {
                        sound.playClick();
                        setStudyId(expanded ? null : w.entryId);
                      }}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                        expanded
                          ? 'border-halo-amber-500o60 bg-wash-amber-500o10'
                          : 'border-ink-stone-200 hover:border-tone-amber-500o50 dark:border-tone-stone-700'
                      }`}
                      title="展开学透卡：发音/释义/例句/收藏一条龙"
                      aria-expanded={expanded}
                    >
                      <span className="min-w-0">
                        <span className="font-serif text-sm font-bold text-ink">
                          {w.headword}
                        </span>
                        {w.reading && (
                          <span className="ml-2 font-mono text-xs text-accent-ink-strong">
                            {w.reading}
                          </span>
                        )}
                        <span className="ml-2 text-xs text-ink-stone-500">
                          {(w.meanings[0] ?? '').slice(0, 12)}
                        </span>
                      </span>
                      {w.studied ? (
                        <Badge variant="emerald" className="text-xs shrink-0">
                          已学透
                        </Badge>
                      ) : isCollected ? (
                        <Badge variant="amber" className="text-xs shrink-0">
                          已收
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-stone-400 shrink-0">学透它 →</span>
                      )}
                    </button>
                    {expanded && (
                      <WordStudyCard
                        entry={{
                          id: w.entryId,
                          headword: w.headword,
                          ...(w.reading ? { reading: w.reading } : {}),
                          ...(w.partOfSpeech ? { partOfSpeech: w.partOfSpeech } : {}),
                          meanings: w.meanings,
                          sourceLabel: w.sourceLabel,
                        }}
                        language={language}
                        collected={isCollected}
                        collectPending={collectPending}
                        studyPending={studyPending}
                        onCollect={collectEntry}
                        onStudyComplete={studyCompleteEntry}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {groups.length === 0 && !wordlistsLoading && !wordlistsError && (
        <p className="text-xs text-ink-stone-500">单词表暂不可用，直接用上方搜索查词即可。</p>
      )}
    </div>
  );
}
