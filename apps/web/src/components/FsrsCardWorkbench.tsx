import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import type { CardReviewRating } from '@study-studio/protocol';
import { fireSuccessConfetti } from './magicui/index.js';
import { sound, type SupportedLanguage } from '../utils/audio.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import {
  useCardsQuery,
  useUpdateCardMutation,
  useCardFormatsQuery,
  useExportApkgMutation,
  usePracticeCollectionsQuery,
} from '../queries/useLearnerQueries.js';
import { selectVocabularyForCard, useVocabularyQuery } from '../queries/vocabulary.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { trackToSpeechLang } from '../config/speech-language.js';
import { Tabs, TabsContent } from './ui/tabs.js';
import { PracticeQueueToCardsPanel } from './PracticeQueueToCardsPanel.js';
import { DictionaryLookupPanel } from './DictionaryLookupPanel.js';
import { ApkgImportDialog } from './ApkgImportDialog.js';
import { DictionaryEntryDialog } from './DictionaryEntryDialog.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';
import { VocabularyLibraryPanel } from './VocabularyLibraryPanel.js';
import { CardReviewTabContent } from './CardReviewTabContent.js';
import { WorkbenchNavHeader, type WorkbenchTab } from './WorkbenchNavHeader.js';
import { DailyWordStudyHub } from './daily-study/DailyWordStudyHub.js';
import type { StudyCardItem } from '../models/learning.js';
import type { VocabularyEntry } from '@study-studio/protocol';
import { unitsForTrack, selectCourseWords } from '@study-studio/learner-core';
import { useWordlistsQuery } from '../queries/wordlists.js';

export function FsrsCardWorkbench() {
  const planIntent = useStudySessionStore((s) => s.planIntent);
  const workbenchTab = useStudySessionStore((s) => s.workbenchTab);
  const setWorkbenchTab = useStudySessionStore((s) => s.setWorkbenchTab);
  const [dictQuery, setDictQuery] = useState<string | null>(null);
  const [deepStudyOpen, setDeepStudyOpen] = useState(false);
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

  const { data: practiceCollections = [] } = usePracticeCollectionsQuery();
  const openTutor = useStudySessionStore((s) => s.openTutor);

  const shell = useLearningShell();
  const cardSpeechLang: SupportedLanguage = trackToSpeechLang(shell.track);
  const vocabularyQuery = useVocabularyQuery(shell.track);
  const wordlists = useWordlistsQuery(undefined, shell.track);
  const courseUnit = unitsForTrack(shell.track).find(u => u.id === planIntent?.courseUnitId);
  const unitWordIds = courseUnit?.evidence.type === 'words-studied' ? new Set(selectCourseWords(courseUnit, wordlists.data ?? []).map(w => w.entryId)) : undefined;

  const dictionaryCopy =
    shell.track === 'en'
      ? { title: '英语生词本', helper: '查询离线英语词典；加入后由 FSRS 计算复习。' }
      : shell.track === 'ja'
        ? { title: '日语生词本', helper: '优先查询本地词典；加入后由 FSRS 安排复习。' }
        : { title: '韩语生词本', helper: '查询本地词典；加入后由 FSRS 计算每日复习。' };

  const cardFilter = useStudySessionStore((s) => s.cardFilter);
  const setCardFilter = useStudySessionStore((s) => s.setCardFilter);
  const currentCardIndex = useStudySessionStore((s) => s.reviewCardIndex);
  const setCurrentCardIndex = useStudySessionStore((s) => s.setReviewCardIndex);
  const cardFlipped = useStudySessionStore((s) => s.reviewCardFlipped);
  const setCardFlipped = useStudySessionStore((s) => s.setReviewCardFlipped);

  const filteredCards = cards.filter((c) => (cardFilter === 'ALL' || c.type === cardFilter)
    && (!unitWordIds || !!c.sourceEntryId && unitWordIds.has(c.sourceEntryId))
    && (planIntent?.kind !== 'CARDS' || !!c.dueAt && Date.parse(c.dueAt) <= Date.now()));
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

  // 同步当前卡片至后端的真实 VocabularyEntry 事实源（查找归选择器，兜底合成保留调用方 collected 语义）
  const matchingVocab: VocabularyEntry | undefined = useMemo(() => {
    if (!activeCard) return undefined;
    const list = vocabularyQuery.data ?? [];
    const found = selectVocabularyForCard(list, {
      ...(activeCard.vocabularyId ? { vocabularyId: activeCard.vocabularyId } : {}),
      surface: activeCard.frontWord,
    });
    if (found) return found;
    return {
      id: activeCard.vocabularyId || activeCard.id,
      word: activeCard.frontWord,
      reading: activeCard.reading,
      language: (shell.track === 'en' || shell.track === 'ko' ? shell.track : 'ja') as 'ja' | 'en' | 'ko',
      meaning: activeCard.backMeaning,
      level: null,
      collected: true,
      cardId: activeCard.id,
      sources: [{
        documentId: 'custom',
        chapterId: 'custom',
        bookTitle: '生词本',
        chapterTitle: activeCard.tag || '复习卡片',
        meaning: activeCard.backMeaning,
        partOfSpeech: activeCard.pos,
        examples: activeCard.exampleJp ? [{ text: activeCard.exampleJp, translation: activeCard.exampleZh || undefined }] : [],
        usage: activeCard.note,
        contextNote: activeCard.exampleHighlight,
        source: 'AI' as const,
      }],
    };
  }, [activeCard, vocabularyQuery.data, shell.track]);

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

  const handleAskAi = () => {
    if (!activeCard) return;
    sound.playClick();
    openTutor({
      questionText: `请讲透「${activeCard.frontWord}」（${activeCard.reading ? `读音：${activeCard.reading}，` : ''}词性：${activeCard.pos}）：中文释义是「${activeCard.backMeaning}」。\n请从以下几个维度深度解析：\n1. 【真实用法】：该词在生活中到底该怎么用？有何接续规则（如サ変动词、名词修饰等）？\n2. 【常用搭配】：列出最地道的高频固定搭配（如动宾搭配、常见短语）；\n3. 【场景例句】：给出 2 个生活或考试高频实用例句（日汉对照）；\n4. 【易混辨析】：是否有相近词或容易用错的混淆点？`,
      correctAnswer: `${activeCard.frontWord}：${activeCard.backMeaning}`,
      skillTag: `${activeCard.pos || '词汇'} · 深度讲透`,
      explanation: activeCard.exampleJp ? `例句：${activeCard.exampleJp}（${activeCard.exampleZh}）` : activeCard.backMeaning,
    });
    toast.success(`已为「${activeCard.frontWord}」开启专属 AI 助教精讲`);
  };

  const handleCardReview = (rating: CardReviewRating) => {
    sound.playClick();
    if (!activeCard) return;

    updateCard.mutate(
      { id: activeCard.id, rating },
      {
        onSuccess: (data) => {
          setCardFlipped(false);
          setDeepStudyOpen(false);
          const nextDays = data.nextReviewDays ?? Math.round(data.nextFsrs.stability);
          if (rating === 'GOOD' || rating === 'EASY') {
            sound.playSuccess();
            fireSuccessConfetti();
            toast.success(`评级成功：下次复习将在 ${nextDays} 天后`);
          } else {
            sound.playMistake();
            toast('已加入今日重练队列，稍后将再次强化。');
          }
          if (planIntent?.kind !== 'CARDS' && currentCardIndex < filteredCards.length - 1) {
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
    <div className="flex max-w-3xl flex-col gap-4">
      <PlanIntentBanner />

      <Tabs
        value={workbenchTab}
        onValueChange={(val) => {
          if (val) {
            sound.playClick();
            setWorkbenchTab(val as WorkbenchTab);
          }
        }}
      >
        <WorkbenchNavHeader
          workbenchTab={workbenchTab}
          cardsCount={filteredCards.length}
          practiceCollectionsCount={practiceCollections.length}
          formats={cardFormats.data?.formats}
          reviewFormatId={reviewFormat?.id ?? 'study-basic'}
          onFormatChange={setReviewCardFormatId}
          onOpenApkg={() => setApkgOpen(true)}
          onExportApkg={handleExportApkg}
          isExporting={exportApkg.isPending}
        />

        <TabsContent value="study" className="mt-3">
          <DailyWordStudyHub
            key={shell.track}
            language={shell.track}
            courseUnitId={planIntent?.courseUnitId}
            onGoToReview={() => {
              sound.playClick();
              setWorkbenchTab('review');
            }}
          />
        </TabsContent>

        <TabsContent value="review" keepMounted className="mt-3">
          <CardReviewTabContent
            practiceCollectionsCount={practiceCollections.length}
            onGoToQueue={() => {
              sound.playClick();
              setWorkbenchTab('queue');
            }}
            filteredCards={filteredCards}
            currentCardIndex={currentCardIndex}
            cardFilter={cardFilter}
            onFilterChange={(val) => {
              setCardFilter(val as typeof cardFilter);
              setCurrentCardIndex(0);
              setCardFlipped(false);
            }}
            cardFlipped={cardFlipped}
            onFlip={() => {
              sound.playClick();
              setCardFlipped(!cardFlipped);
            }}
            onReview={handleCardReview}
            onAskAi={handleAskAi}
            onOpenDict={(w) => setDictQuery(w)}
            cardSpeechLang={cardSpeechLang}
            reviewFormat={reviewFormat}
            deepStudyOpen={deepStudyOpen}
            onToggleDeepStudy={() => setDeepStudyOpen((v) => !v)}
            matchingVocab={matchingVocab}
            totalCards={cards.length}
            onResetFilter={() => {
              sound.playClick();
              setCardFilter('ALL');
              setCurrentCardIndex(0);
            }}
            onGoToStudy={() => {
              sound.playClick();
              setWorkbenchTab('study');
            }}
            onGoToLibrary={() => {
              sound.playClick();
              setWorkbenchTab('library');
            }}
            onGoToDictionary={() => {
              sound.playClick();
              setWorkbenchTab('dictionary');
            }}
            onOpenAnkiImport={() => {
              sound.playClick();
              setApkgOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="library" className="mt-3">
          <VocabularyLibraryPanel key={shell.track} language={shell.track} />
        </TabsContent>

        <TabsContent value="dictionary" className="mt-3">
          <DictionaryLookupPanel
            language={shell.track}
            title={dictionaryCopy.title}
            helper={dictionaryCopy.helper}
            onGoToStudy={() => {
              sound.playClick();
              setWorkbenchTab('study');
            }}
          />
        </TabsContent>

        <TabsContent value="queue" className="mt-3">
          <PracticeQueueToCardsPanel />
        </TabsContent>
      </Tabs>

      <DictionaryEntryDialog
        open={Boolean(dictQuery)}
        onClose={() => setDictQuery(null)}
        language={shell.track}
        query={dictQuery ?? ''}
      />

      <ApkgImportDialog open={apkgOpen} onOpenChange={setApkgOpen} />
    </div>
  );
}
