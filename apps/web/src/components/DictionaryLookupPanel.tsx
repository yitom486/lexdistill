import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, BookPlus, Check, ExternalLink, Search, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  useCollectDictionaryEntryMutation,
  useDictionaryHistoryQuery,
  useDictionaryLookupQuery,
  useAnkiStatusQuery,
  usePushToAnkiMutation,
  useMarkCardStudiedMutation,
  useCardsQuery,
  useLevelInfoQuery,
  type AnkiPushTts,
} from '../queries/useLearnerQueries.js';
import { useWordlistsQuery } from '../queries/wordlists.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import { sound } from '../utils/audio.js';
import { buildPitchGraphSvg } from '@study-studio/learner-core';
import { QUERY_KEYS } from '../queries/query-keys.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { WordStudyCard } from './WordStudyCard.js';

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
  const collect = useCollectDictionaryEntryMutation();
  const markStudied = useMarkCardStudiedMutation();
  // 未讲透新卡计数（M2 学习门提示；与隔壁复习流同源查询，只读不写）。
  const { data: myCards = [] } = useCardsQuery(undefined, language);
  const unstudiedNewCount = myCards.filter((c) => c.state === 'NEW' && !c.studiedAt).length;
  const queryClient = useQueryClient();
  const history = useDictionaryHistoryQuery(language);
  // 讲透卡展开态：新查询自动展开首条（学透再练）；手动切换后不再抢。
  const [studyId, setStudyId] = useState<string | null>(null);
  const [collectedIds, setCollectedIds] = useState<string[]>([]);
  const autoStudyFor = useRef('');
  useEffect(() => {
    if (autoStudyFor.current === query) return;
    autoStudyFor.current = query;
    setStudyId(lookup.data?.entries[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lookup.data]);
  const ankiStatus = useAnkiStatusQuery(true);
  const pushToAnki = usePushToAnkiMutation();
  // 零基础单词表：入门/初级（或档位未知）才展示；中高级保持纯搜索面板。
  const { data: levelInfo } = useLevelInfoQuery(undefined, language);
  const showWordlist =
    !levelInfo || levelInfo.level === 'NOVICE' || levelInfo.level === 'BEGINNER';
  const wordlists = useWordlistsQuery(undefined, language);
  // TTS 凭证只存浏览器本地：推送时随请求携带、网关不落盘；未配置则音频留空。
  const preferredService = useTtsStore((s) => s.preferredService);
  const providerApiKeys = useTtsStore((s) => s.providerApiKeys);
  const azureRegion = useTtsStore((s) => s.azureRegion);
  const localBaseUrl = useTtsStore((s) => s.localBaseUrl);
  const voiceId = useTtsStore((s) => s.voiceId);
  const ankiPushable = (ankiStatus.data?.enabled && ankiStatus.data.connected) === true;
  // 查到结果后刷新最近查词与相遇词热力（画像信号已由网关记录）
  useEffect(() => {
    if (lookup.data) {
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'history', language] });
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DICTIONARY, 'encountered', language] });
    }
  }, [lookup.data, lookup.dataUpdatedAt, queryClient, language]);

  const collectEntry = (entryId: string) => {
    collect.mutate(entryId, {
      onSuccess: (result) => {
        setCollectedIds((prev) => (prev.includes(entryId) ? prev : [...prev, entryId]));
        toast.success(
          result.created
            ? '已加入生词本，今天即可在 FSRS 闪卡中复习（回“我的学情”，相遇词会变绿）。'
            : '该词已经在你的生词本中。'
        );
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : '暂时无法加入生词本，请稍后重试。');
      },
    });
  };

  // 学透了，入库开练（M2 学习门）：先收（已收则直接返回旧卡），再标讲透；
  // 讲透的卡才进练习池 NEW 块，裸收的不进。
  const studyCompleteEntry = (entryId: string) => {
    if (collect.isPending || markStudied.isPending) return;
    sound.playClick();
    collect.mutate(entryId, {
      onSuccess: (result) => {
        setCollectedIds((prev) => (prev.includes(entryId) ? prev : [...prev, entryId]));
        markStudied.mutate(result.card.id, {
          onSuccess: () => {
            sound.playCorrect();
            toast.success('已学透入库：这张卡可以进练习池了，去复习或开练吧');
          },
          onError: (e) => {
            sound.playMistake();
            toast.error(e instanceof Error ? e.message : '标记讲透失败');
          },
        });
      },
      onError: (error) => {
        sound.playMistake();
        toast.error(error instanceof Error ? error.message : '暂时无法加入生词本，请稍后重试。');
      },
    });
  };

  /** 推送到本机 Anki：先入库生词本（去重），再按卡片模板渲染推送。 */
  const pushEntryToAnki = (entryId: string) => {
    const tts: AnkiPushTts = {
      provider: preferredService,
      ...(providerApiKeys[preferredService] ? { apiKey: providerApiKeys[preferredService] } : {}),
      ...(azureRegion ? { region: azureRegion } : {}),
      ...(localBaseUrl ? { localBaseUrl } : {}),
      ...(providerApiKeys.local ? { localApiKey: providerApiKeys.local } : {}),
      ...(voiceId ? { voice: voiceId } : {}),
    };
    collect.mutate(entryId, {
      onSuccess: (result) => {
        pushToAnki.mutate(
          { cardId: result.card.id, tts },
          {
            onSuccess: (r) => {
              toast.success(
                `已推送到 Anki「${r.deckName}」${r.audioStored ? '（含发音）' : '（无音频）'}`
              );
              if (r.ttsWarning) toast.warning(r.ttsWarning);
              if (r.audioSkippedReason) toast.warning(r.audioSkippedReason);
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : '推送到 Anki 失败。');
            },
          }
        );
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : '暂时无法加入生词本，请稍后重试。');
      },
    });
  };

  return (
    <section className="rounded-2xl border border-line-amber-900o10 bg-veil-paper-70 p-4 shadow-sm dark:border-wash-amber-500o15 transition-colors">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(input.trim());
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
        <Button type="submit" size="sm" disabled={!input.trim() || lookup.isFetching} className="gap-1.5">
          <Search className="h-3.5 w-3.5" />查询
        </Button>
      </form>

      {(history.data?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {history.data?.slice(0, 8).map((h) => (
            <button
              key={`${h.query}-${h.createdAt}`}
              type="button"
              onClick={() => {
                setInput(h.query);
                setQuery(h.query);
              }}
              className="rounded-full border border-ink-stone-200 px-2.5 py-1 text-[11px] text-ink-stone-500 hover:border-tone-amber-500o50 hover:text-tone-amber-700 dark:border-tone-stone-700 dark:text-ink-stone-400 dark:hover:text-ink-amber-300 transition-colors"
              title={`最近查过（${h.hitCount} 条结果）`}
            >
              {h.query}
            </button>
          ))}
        </div>
      )}
      {!query && showWordlist && (
        <div className="mt-3 border-t border-ink-stone-200 pt-3 dark:border-tone-stone-800 space-y-3 transition-colors">          {onGoToStudy && (
            <div className="flex items-center justify-between rounded-2xl border border-line-amber-900o10 bg-wash-amber-500o5 p-3 text-xs">
              <div className="space-y-0.5">
                <span className="font-semibold text-ink flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent-ink-warm" />
                  想要每天从 N5 抽取 10–20 词系统学习？
                </span>
                <p className="text-[11px] text-ink-ghost">
                  推荐使用「今日学词」模块，享受多角色情景短剧、避坑指南与互动随堂小测！
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
          <p className="text-[11px] font-bold text-ink-ghost">
            零基础单词表 · 按顺序点词展开学透（收进生词本即计入带路第 3 天）
          </p>
          {wordlists.isLoading && <p className="text-xs text-ink-stone-500">单词表加载中…</p>}
          {(wordlists.data ?? []).map((group) => {
            const done = group.words.filter(
              (w) => w.collected || collectedIds.includes(w.entryId)
            ).length;
            return (
              <div key={group.id} className="space-y-1.5">
                <p className="text-xs font-semibold text-ink-mute-deep">
                  {group.title}
                  <span className="ml-2 font-mono text-[10px] text-ink-stone-400">
                    {done}/{group.words.length} 已收
                  </span>
                </p>
                <p className="text-[11px] text-ink-stone-400">{group.subtitle}</p>
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
                        >
                          <span className="min-w-0">
                            <span className="font-serif text-sm font-bold text-ink">
                              {w.headword}
                            </span>
                            {w.reading && (
                              <span className="ml-2 font-mono text-[11px] text-accent-ink-strong">
                                {w.reading}
                              </span>
                            )}
                            <span className="ml-2 text-[11px] text-ink-stone-500">
                              {(w.meanings[0] ?? '').slice(0, 12)}
                            </span>
                          </span>
                          {w.studied ? (
                            <Badge variant="emerald" className="text-[10px] shrink-0">
                              已学透
                            </Badge>
                          ) : isCollected ? (
                            <Badge variant="amber" className="text-[10px] shrink-0">
                              已收
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-ink-stone-400 shrink-0">学透它 →</span>
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
                            collectPending={collect.isPending}
                            studyPending={collect.isPending || markStudied.isPending}
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
          {(wordlists.data ?? []).length === 0 && !wordlists.isLoading && (
            <p className="text-xs text-ink-stone-500">单词表暂不可用，直接用上方搜索查词即可。</p>
          )}
        </div>
      )}

      {query && (
        <div className="mt-3 border-t border-ink-stone-200 pt-3 dark:border-tone-stone-800 transition-colors">
          {lookup.isFetching ? (
            <p className="text-xs text-ink-stone-500">正在查询本地词典…</p>
          ) : lookup.isError ? (
            <p className="text-xs text-ink-stone-500">
              暂时无法查询本地词典，请检查 Gateway 连接后重试。
            </p>
          ) : lookup.data?.entries.length ? (
            <div className="space-y-3">
              {groupEntriesBySource(lookup.data.entries).map((group) => (
                <div key={group.source} className="space-y-2">
                  <p className="text-[11px] font-bold text-ink-ghost">
                    {group.source} · {group.entries.length} 条
                  </p>
                  {group.entries.map((entry) => (
                <div key={entry.id}>
                <div
                  className="flex flex-col gap-2 rounded-xl bg-wash-amber-50o70 p-3 dark:bg-wash-amber-500o10 sm:flex-row sm:items-center sm:justify-between transition-colors"
                >
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
                      <PitchBadge
                        pronunciation={entry.pronunciation}
                        {...(entry.reading ? { reading: entry.reading } : {})}
                      />
                      {typeof entry.frequency === 'number' && (
                        <Badge variant="secondary" className="font-mono" title="词频（数字越小越常用）">
                          #{entry.frequency}
                        </Badge>
                      )}
                      {entry.frequencies && entry.frequencies.length > 0 && (
                        <span
                          className="font-mono text-[10px] text-ink-hint"
                          title="各来源词频（数字越小越常用）"
                        >
                          {entry.frequencies.map((f) => `${f.source} ${f.value}`).join(' · ')}
                        </span>
                      )}
                    </div>
                    {entry.inflectionNote && (
                      <p className="mt-1 text-[11px] font-semibold text-ink-sky-700-sky-300">
                        {entry.inflectionNote}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-ink-faint">
                      {entry.meanings.join('；')}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-stone-400">来源：{entry.sourceLabel}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={studyId === entry.id ? 'secondary' : 'ghost'}
                    className="gap-1.5 text-[11px]"
                    onClick={() => {
                      sound.playClick();
                      setStudyId(studyId === entry.id ? null : entry.id);
                    }}
                    title="展开讲透卡：先学透发音释义，再决定收不收"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    {studyId === entry.id ? '收起' : '学透它'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={collect.isPending}
                    onClick={() => collectEntry(entry.id)}
                  >
                    {collect.isPending ? (
                      <Check className="h-3.5 w-3.5 animate-pulse" />
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
                      className="gap-1.5 text-[11px]"
                      disabled={collect.isPending || pushToAnki.isPending}
                      title="先加入生词本，再按卡片模板推送到本机 Anki"
                      onClick={() => pushEntryToAnki(entry.id)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      推送 Anki
                    </Button>
                  )}
                  </div>
                </div>
                {studyId === entry.id && (
                  <WordStudyCard
                    entry={entry}
                    language={language}
                    collected={collectedIds.includes(entry.id)}
                    collectPending={collect.isPending}
                    studyPending={collect.isPending || markStudied.isPending}
                    onCollect={collectEntry}
                    onStudyComplete={studyCompleteEntry}
                  />
                )}
                </div>
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
              也可以直接用中文含义反查（比如查"水"找 water）。
            </p>
          )}
        </div>
      )}
      {unstudiedNewCount > 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-tone-amber-500o40 bg-wash-amber-500o5 px-3 py-2 text-[11px] text-ink-faint">
          生词本里有 {unstudiedNewCount} 张新卡还没讲透：展开上面词条点"学透了，入库开练"，否则它们进不了练习池（复习不受影响）。
        </p>
      )}
    </section>
  );
}
