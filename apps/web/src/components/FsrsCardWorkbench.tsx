import React, { useState, useEffect, useMemo } from 'react';
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
import { useReviewActions } from './review/useReviewActions.js';
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
  const cardsQuery = useCardsQuery();
  const cards = cardsQuery.data ?? [];
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

  const { handleExportApkg, handleAskAi, handleCardReview } = useReviewActions({
    track: shell.track,
    activeCard,
    filteredCards,
    currentCardIndex,
    setCurrentCardIndex,
    setCardFlipped,
    setDeepStudyOpen,
    planIsCards: planIntent?.kind === 'CARDS',
    updateCard,
    exportApkg,
  });

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
            active={workbenchTab === 'review'}
            reviewPending={updateCard.isPending}
            practiceCollectionsCount={practiceCollections.length}
            onGoToQueue={() => {
              sound.playClick();
              setWorkbenchTab('queue');
            }}
            filteredCards={filteredCards}
            cardsLoading={cardsQuery.isPending}
            cardsError={cardsQuery.isError}
            onRetryCards={() => void cardsQuery.refetch()}
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
