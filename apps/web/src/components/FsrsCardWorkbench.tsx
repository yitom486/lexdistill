import React, { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import type { CardReviewRating } from '@study-studio/protocol';
import { buildCardContext, renderCard } from '@study-studio/learner-core';
import { fireSuccessConfetti } from './magicui/index.js';
import { sound, type SupportedLanguage } from '../utils/audio.js';
import { UnifiedTtsPlayer } from './UnifiedTtsPlayer.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useCardsQuery, useUpdateCardMutation } from '../queries/useLearnerQueries.js';
import { useCardFormatsQuery } from '../queries/useLearnerQueries.js';
import { studyCardToSourceEntry, buildReviewCardDoc } from '../lib/review-card.js';
import { useExportApkgMutation } from '../queries/useLearnerQueries.js';
import { cn } from '../lib/utils.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { trackToSpeechLang } from '../config/speech-language.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { PracticeQueueToCardsPanel } from './PracticeQueueToCardsPanel.js';
import { DictionaryLookupPanel } from './DictionaryLookupPanel.js';
import { ApkgImportDialog } from './ApkgImportDialog.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';
import type { StudyCardItem } from '../models/learning.js';

export function FsrsCardWorkbench() {
  const { data: cards = [] } = useCardsQuery();
  const updateCard = useUpdateCardMutation();
  const [apkgOpen, setApkgOpen] = useState(false);
  const exportApkg = useExportApkgMutation();
  const cardFormats = useCardFormatsQuery(true);
  const reviewFormatId = usePreferencesStore((s) => s.reviewCardFormatId);
  const setReviewCardFormatId = usePreferencesStore((s) => s.setReviewCardFormatId);
  const reviewFormat =
    cardFormats.data?.formats.find((f) => f.id === reviewFormatId) ??
    cardFormats.data?.formats[0];

  const handleExportApkg = () => {
    sound.playClick();
    exportApkg.mutate(
      { language: shell.track },
      {
        onSuccess: ({ blob, filename }) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.rel = 'noopener';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          toast.success(`已导出 ${filename}，传到手机导入 Anki 即可同步。`);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : '.apkg 导出失败。'),
      }
    );
  };
  const shell = useLearningShell();
  const cardSpeechLang: SupportedLanguage = trackToSpeechLang(shell.track);
  const dictionaryCopy =
    shell.track === 'en'
      ? {
          title: '英语生词本',
          helper: '查询已安装的离线英语词典；加入后由 FSRS 计算每日复习安排。',
        }
      : shell.track === 'ja'
        ? {
            title: '日语生词本',
            helper: '优先查询本地词典；未收录时可跳转 OJAD 自行确认，加入后由 FSRS 安排复习。',
          }
        : {
            title: '韩语生词本',
            helper: '查询本地词典；加入后由 FSRS 计算每日复习安排。',
          };

  const cardFilter = useStudySessionStore((s) => s.cardFilter);
  const setCardFilter = useStudySessionStore((s) => s.setCardFilter);
  const currentCardIndex = useStudySessionStore((s) => s.reviewCardIndex);
  const setCurrentCardIndex = useStudySessionStore((s) => s.setReviewCardIndex);
  const cardFlipped = useStudySessionStore((s) => s.reviewCardFlipped);
  const setCardFlipped = useStudySessionStore((s) => s.setReviewCardFlipped);

  const filteredCards = cards.filter((c) => cardFilter === 'ALL' || c.type === cardFilter);
  const activeCard: StudyCardItem | undefined = filteredCards[currentCardIndex] || filteredCards[0];

  useEffect(() => {
    if (filteredCards.length === 0) {
      if (currentCardIndex !== 0) setCurrentCardIndex(0);
      if (cardFlipped) setCardFlipped(false);
      return;
    }
    if (currentCardIndex >= filteredCards.length) {
      setCurrentCardIndex(0);
      setCardFlipped(false);
    }
  }, [cardFlipped, currentCardIndex, filteredCards.length, setCardFlipped, setCurrentCardIndex]);

  // 复习内容区经模板渲染（与工作台预览/导出同链路）；外层徽标/TTS/评分 chrome 不动。
  const renderedReview = useMemo(() => {
    if (!activeCard || !reviewFormat) return null;
    const ctx = buildCardContext(studyCardToSourceEntry(activeCard));
    const rendered = renderCard(reviewFormat, ctx);
    return {
      frontDoc: buildReviewCardDoc(reviewFormat.css, rendered.frontHtml),
      backDoc: buildReviewCardDoc(reviewFormat.css, rendered.backHtml),
    };
  }, [activeCard, reviewFormat]);


  const handleCardReview = (rating: CardReviewRating) => {
    sound.playClick();
    if (!activeCard) return;

    updateCard.mutate(
      {
        id: activeCard.id,
        rating,
      },
      {
        onSuccess: (data) => {
          setCardFlipped(false);

          const nextDays = data.nextReviewDays ?? Math.round(data.nextFsrs.stability);
          if (rating === 'GOOD' || rating === 'EASY') {
            sound.playSuccess();
            fireSuccessConfetti();
            toast.success(`评级成功：下次复习将在 ${nextDays} 天后`);
          } else {
            sound.playMistake();
            toast('已加入今日重练队列，稍后将再次强化。');
          }

          if (currentCardIndex < filteredCards.length - 1) {
            setCurrentCardIndex(currentCardIndex + 1);
          } else {
            setCurrentCardIndex(0);
          }
        },
        onError: (e) => {
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '保存复习状态失败，请稍后重试。');
        },
      }
    );
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <PlanIntentBanner />
      <PracticeQueueToCardsPanel />

      <DictionaryLookupPanel
        language={shell.track}
        title={dictionaryCopy.title}
        helper={dictionaryCopy.helper}
      />

      <div className="flex items-center justify-between text-xs text-ink-ghost gap-3">
        <span>
          当前卡片: {filteredCards.length ? currentCardIndex + 1 : 0} / {filteredCards.length}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              sound.playClick();
              setApkgOpen(true);
            }}
          >
            从 Anki 搬家
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={exportApkg.isPending}
            title="导出当前语种生词本为 .apkg（传到手机导入 Anki）"
            onClick={handleExportApkg}
          >
            {exportApkg.isPending ? '导出中…' : '导出 .apkg'}
          </Button>
          {cardFormats.data && cardFormats.data.formats.length > 0 && (
            <Select
              value={reviewFormat?.id ?? 'study-basic'}
              onValueChange={(v) => {
                if (typeof v === 'string') {
                  sound.playClick();
                  setReviewCardFormatId(v);
                }
              }}
            >
              <SelectTrigger className="h-7 w-32 text-[11px]" title="复习卡片模板">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cardFormats.data.formats.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        <Tabs
          value={cardFilter}
          onValueChange={(val) => {
            if (!val) return;
            sound.playClick();
            setCardFilter(val as typeof cardFilter);
            setCurrentCardIndex(0);
            setCardFlipped(false);
          }}
        >
          <TabsList className="bg-veil-stone-200o60-stone-900">
            <TabsIndicator />
            {(
              [
                ['ALL', '全部'],
                ['VOCAB', '生词'],
                ['GRAMMAR', '文法'],
                ['CONFUSION', '混淆'],
              ] as const
            ).map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="px-2.5 py-1 text-xs">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        </div>
      </div>

      <ApkgImportDialog open={apkgOpen} onOpenChange={setApkgOpen} />

      {activeCard && (
        <div
          onClick={() => {
            sound.playClick();
            setCardFlipped(!cardFlipped);
          }}
          className="fsrs-card-stage h-115 cursor-pointer"
        >
          <div className="fsrs-card-viewport relative h-full w-full overflow-hidden rounded-3xl border border-line-amber-900o10 bg-paper-soft shadow-sm dark:border-wash-amber-500o15 transition-colors">
            <div
              className="fsrs-card-rotor relative h-full w-full transform-style-3d"
              style={{
                transform: `rotateY(${cardFlipped ? 180 : 0}deg)`,
                transition: 'transform var(--motion-card-flip-duration) ease-out',
                transformOrigin: 'center center',
                willChange: 'transform',
              }}
            >
              <div
                aria-hidden={cardFlipped}
                className={cn(
                  'fsrs-card-face absolute inset-0 overflow-hidden rounded-3xl p-8',
                  cardFlipped ? 'pointer-events-none' : 'pointer-events-auto'
                )}
              >
              <div className="flex h-full flex-col justify-between space-y-6">
                <div className="flex items-center justify-between">
                  <Badge variant="amber">
                    {activeCard.tag} · {activeCard.pos}
                  </Badge>
                  <span className="text-xs text-ink-stone-400 font-mono">
                    FSRS 稳定性: {activeCard.stability}d · 复习 {activeCard.reps} 次
                  </span>
                </div>
                <div className="text-center py-8 flex flex-col items-center">
                  {renderedReview ? (
                    <iframe
                      key={`front-${activeCard.id}`}
                      title="卡片正面"
                      sandbox=""
                      srcDoc={renderedReview.frontDoc}
                      className="block h-55 w-full shrink-0 rounded-2xl border-0 bg-surface-abyss"
                    />
                  ) : (
                    <>
                      <h2 className="text-4xl sm:text-5xl font-bold font-serif text-ink tracking-wide">
                        {activeCard.frontWord}
                      </h2>
                      {activeCard.reading && (
                        <p className="text-sm text-accent-ink-warm font-mono mt-2">
                          {activeCard.reading}
                        </p>
                      )}
                    </>
                  )}
                  <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                    <UnifiedTtsPlayer
                      variant="button"
                      text={activeCard.frontWord}
                      lang={cardSpeechLang}
                      label="听发音"
                    />
                  </div>
                </div>
                <div className="text-center text-xs text-ink-stone-400">
                  点击卡片或按{' '}
                  <kbd className="font-mono bg-line-soft px-1.5 py-0.5 rounded">
                    Space
                  </kbd>{' '}
                  翻转查看释义
                </div>
              </div>
            </div>
              <div
                aria-hidden={!cardFlipped}
                className={cn(
                  'fsrs-card-face fsrs-card-back absolute inset-0 overflow-y-auto rounded-3xl p-8',
                  cardFlipped ? 'pointer-events-auto' : 'pointer-events-none'
                )}
              >
              <div className="flex min-h-full flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <span className="text-xs font-bold text-accent-ink-warm uppercase tracking-wider">
                    中文释义与核心考点
                  </span>
                  {renderedReview ? (
                    <iframe
                      key={`back-${activeCard.id}`}
                      title="卡片背面"
                      sandbox=""
                      srcDoc={renderedReview.backDoc}
                      className="block h-55 w-full shrink-0 rounded-2xl border-0 bg-surface-abyss"
                    />
                  ) : (
                    <>
                      <h3 className="text-xl sm:text-2xl font-bold font-serif text-ink">
                        {activeCard.backMeaning}
                      </h3>
                      <div className="p-3.5 rounded-xl bg-wash-amber-500o10-stone-900o60 border border-line-amber-900o5 text-xs space-y-1">
                        <div className="font-medium text-ink flex items-center justify-between">
                          <span>{activeCard.exampleJp}</span>
                          <span onClick={(e) => e.stopPropagation()}>
                            <UnifiedTtsPlayer
                              variant="inline"
                              text={activeCard.exampleJp}
                              lang={cardSpeechLang}
                            />
                          </span>
                        </div>
                        <p className="text-ink-ghost font-serif">
                          {activeCard.exampleZh}
                        </p>
                      </div>
                    </>
                  )}
                  {activeCard.exampleZh && (
                    <p className="text-xs text-ink-ghost font-serif">
                      {activeCard.exampleZh}
                    </p>
                  )}
                  {activeCard.note && (
                    <p className="text-xs text-ink-amber-800-amber-300">💡 {activeCard.note}</p>
                  )}
                </div>

                <div
                  className="grid grid-cols-4 gap-2 pt-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    className="h-auto py-2.5 hover:bg-tone-rose-500 hover:text-tone-white"
                    onClick={() => handleCardReview('AGAIN')}
                  >
                    重来 (1)
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-auto py-2.5 hover:bg-tone-amber-500 hover:text-tone-stone-950"
                    onClick={() => handleCardReview('HARD')}
                  >
                    困难 (2)
                  </Button>
                  <Button className="h-auto py-2.5" onClick={() => handleCardReview('GOOD')}>
                    良好 (3)
                  </Button>
                  <Button
                    className="h-auto py-2.5 bg-tone-emerald-600 hover:bg-tone-emerald-700 text-tone-white"
                    onClick={() => handleCardReview('EASY')}
                  >
                    简单 (4)
                  </Button>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
