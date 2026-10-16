import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import {
  useDictionaryHistoryQuery,
  useDictionaryLookupQuery,
  useAnkiStatusQuery,
  useCardsQuery,
  useLevelInfoQuery,
} from '../queries/useLearnerQueries.js';
import { useWordlistsQuery } from '../queries/wordlists.js';
import { QUERY_KEYS } from '../queries/query-keys.js';
import { Badge } from './ui/badge.js';
import { buildPitchGraphSvg } from '@study-studio/learner-core';
import { DictionarySearchForm } from './dictionary/DictionarySearchForm.js';
import { DictionaryWordlist } from './dictionary/DictionaryWordlist.js';
import { DictionaryEntryRow } from './dictionary/DictionaryEntryRow.js';
import { useDictionaryEntryActions } from './dictionary/useDictionaryEntryActions.js';

type DictionaryLookupPanelProps = {
  language: 'en' | 'ja' | 'ko';
  title: string;
  helper: string;
  /** 卡面点词等嵌入场景的预填查询（对话框每次打开带不同词时同步）。 */
  initialQuery?: string;
  onGoToStudy?: () => void;
};

/** pronunciation.pitch 安全抽取（label + positions；结构不对返回 null，不抛）。 */
function pitchInfoOf(pronunciation: unknown): { label: string; positions: number[] } | null {
  if (typeof pronunciation !== 'object' || pronunciation === null) return null;
  const pitch: unknown = (pronunciation as { pitch?: unknown }).pitch;
  if (typeof pitch !== 'object' || pitch === null) return null;
  const rec = pitch as { label?: unknown; positions?: unknown };
  if (typeof rec.label !== 'string' || !rec.label) return null;
  const positions = Array.isArray(rec.positions)
    ? rec.positions.filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0)
    : [];
  return { label: rec.label, positions };
}

/** 声调徽标 + 迷你阶梯图（SVG 为本地生成，读音已转义；无核位置时只显示徽标）。 */
function PitchBadge({ pronunciation, reading }: { pronunciation: unknown; reading?: string }) {
  const info = pitchInfoOf(pronunciation);
  if (!info) return null;
  const graph =
    reading && info.positions.length > 0 ? buildPitchGraphSvg(reading, info.positions, { label: info.label }) : '';
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant="amber" className="font-mono">
        声调 {info.label}
      </Badge>
      {graph && (
        <span
          className="inline-flex items-center rounded-md border border-tone-amber-500o25 bg-tone-white px-1 dark:bg-tone-stone-900 [&_svg]:h-7 [&_svg]:w-auto transition-colors"
          title={`声调阶梯（${reading} ${info.label}）`}
          dangerouslySetInnerHTML={{ __html: graph }}
        />
      )}
    </span>
  );
}

export type LookupEntry = {
  id: string;
  headword: string;
  reading?: string;
  partOfSpeech?: string;
  pronunciation?: Record<string, unknown>;
  frequency?: number;
  frequencies?: Array<{ source: string; value: number }>;
  inflectionNote?: string;
  meanings: string[];
  sourceLabel: string;
};

/** 按来源分组（保序；网关已按优先级/词频排好，组内不再重排）。 */
function groupEntriesBySource(entries: LookupEntry[]): Array<{ source: string; entries: LookupEntry[] }> {
  const groups: Array<{ source: string; entries: LookupEntry[] }> = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.source === entry.sourceLabel) {
      last.entries.push(entry);
    } else {
      groups.push({ source: entry.sourceLabel, entries: [entry] });
    }
  }
  return groups;
}

/**
 * 可嵌入任意学习工作台的词典入口。它只组合 Query 与领域 Mutation，
 * 不拥有词典、FSRS 或每日统计的业务规则。
 */
export function DictionaryLookupPanel({ language, title, helper, initialQuery = '', onGoToStudy }: DictionaryLookupPanelProps) {
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  // 嵌入弹窗带词打开：initialQuery 变化即同步为新查询（面板常驻场景传空串，不干扰）。
  useEffect(() => {
    if (initialQuery) {
      setInput(initialQuery);
      setQuery(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);
  const lookup = useDictionaryLookupQuery(language, query);
  // 未讲透新卡计数（M2 学习门提示；与隔壁复习流同源查询，只读不写）。
  const { data: myCards = [] } = useCardsQuery(undefined, language);
  const unstudiedNewCount = myCards.filter((c) => c.state === 'NEW' && !c.studiedAt).length;
  const queryClient = useQueryClient();
  const history = useDictionaryHistoryQuery(language);
  // 讲透卡展开态：新查询自动展开首条（学透再练）；手动切换后不再抢。
  const [studyId, setStudyId] = useState<string | null>(null);
  const autoStudyFor = useRef('');
  useEffect(() => {
    if (autoStudyFor.current === query) return;
    autoStudyFor.current = query;
    setStudyId(lookup.data?.entries[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lookup.data]);
  const ankiStatus = useAnkiStatusQuery(true);
  // 零基础单词表：入门/初级（或档位未知）才展示；中高级保持纯搜索面板。
  const { data: levelInfo } = useLevelInfoQuery(undefined, language);
  const showWordlist =
    !levelInfo || levelInfo.level === 'NOVICE' || levelInfo.level === 'BEGINNER';
  const wordlists = useWordlistsQuery(undefined, language);
  const ankiPushable = (ankiStatus.data?.enabled && ankiStatus.data.connected) === true;
  // 查到结果后刷新最近查词与相遇词热力（画像信号已由网关记录）
  useEffect(() => {
    if (lookup.data) {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'history', language] });
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'encountered', language] });
    }
  }, [lookup.data, lookup.dataUpdatedAt, queryClient, language]);

  const {
    collectEntry,
    studyCompleteEntry,
    pushEntryToAnki,
    collectedIds,
    collectPending,
    studyPending,
    pushPending,
  } = useDictionaryEntryActions();

  const submitQuery = (q: string) => {
    setInput(q);
    setQuery(q);
  };

  return (
    <section className="rounded-2xl border border-line-amber-900o10 bg-veil-paper-70 p-4 shadow-sm dark:border-wash-amber-500o15 transition-colors">
      <DictionarySearchForm
        language={language}
        title={title}
        helper={helper}
        input={input}
        setInput={setInput}
        onSubmit={submitQuery}
        lookupFetching={lookup.isFetching}
        history={history.data ?? []}
      />
      {!query && showWordlist && (
        <DictionaryWordlist
          language={language}
          groups={wordlists.data ?? []}
          wordlistsLoading={wordlists.isLoading}
          wordlistsError={wordlists.isError}
          onRetry={() => void wordlists.refetch()}
          collectedIds={collectedIds}
          studyId={studyId}
          setStudyId={setStudyId}
          collectEntry={collectEntry}
          studyCompleteEntry={studyCompleteEntry}
          collectPending={collectPending}
          studyPending={studyPending}
          {...(onGoToStudy ? { onGoToStudy } : {})}
        />
      )}

      {query && (
        <div className="mt-3 border-t border-ink-stone-200 pt-3 dark:border-tone-stone-800 transition-colors">
          {lookup.isFetching ? (
            <p className="text-xs text-ink-stone-500">正在查询本地词典…</p>
          ) : lookup.isError ? (
            <p className="text-xs text-ink-stone-500">
              暂时无法查询本地词典，请检查网关连接后重试。
              <button type="button" className="ml-2 underline focus-visible:ring-2 focus-visible:ring-focus-ring" onClick={() => void lookup.refetch()}>重新查询</button>
            </p>
          ) : lookup.data?.entries.length ? (
            <div className="space-y-3">
              {groupEntriesBySource(lookup.data.entries).map((group) => (
                <div key={group.source} className="space-y-2">
                  <p className="text-xs font-bold text-ink-ghost">
                    {group.source} · {group.entries.length} 条
                  </p>
                  {group.entries.map((entry) => (
                    <DictionaryEntryRow
                      key={entry.id}
                      entry={entry}
                      language={language}
                      studyId={studyId}
                      setStudyId={setStudyId}
                      collectedIds={collectedIds}
                      collectEntry={collectEntry}
                      studyCompleteEntry={studyCompleteEntry}
                      pushEntryToAnki={pushEntryToAnki}
                      ankiPushable={ankiPushable}
                      collectPending={collectPending}
                      studyPending={studyPending}
                      pushPending={pushPending}
                      pronunciation={
                        <PitchBadge
                          pronunciation={entry.pronunciation}
                          {...(entry.reading ? { reading: entry.reading } : {})}
                        />
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : lookup.data?.externalLookup ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              <span>本地词典暂未收录「{query}」。</span>
              <a
                href={lookup.data.externalLookup.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-tone-amber-700 hover:underline dark:text-ink-amber-300 transition-colors"
              >
                前往 OJAD 查询 <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : (
            <p className="text-xs text-ink-stone-500">
              本地词典暂未收录「{query}」。{language === 'en' ? '请先确认英语离线词典包已经安装。' : ''}
              也可以直接用中文含义反查（比如查“水”找 water）。
            </p>
          )}
        </div>
      )}
      {unstudiedNewCount > 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-tone-amber-500o40 bg-wash-amber-500o5 px-3 py-2 text-xs text-ink-faint">
          生词本里有 {unstudiedNewCount} 张新卡还没讲透：展开上面词条点“学透了，入库开练”，否则它们进不了练习池（复习不受影响）。
        </p>
      )}
    </section>
  );
}
