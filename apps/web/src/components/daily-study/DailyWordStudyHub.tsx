import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import type { VocabularyEntry } from '@study-studio/protocol';
import { useWordlistsQuery, type WordlistWord } from '../../queries/wordlists.js';
import { useVocabularyQuery } from '../../queries/vocabulary.js';
import {
  useCollectDictionaryEntryMutation,
  useMarkCardStudiedMutation,
  useCardsQuery,
} from '../../queries/useLearnerQueries.js';
import { DEFAULT_USER_ID } from '../../queries/query-keys.js';
import { sound } from '../../utils/audio.js';
import { DailyStudySetup, type StudySourceOption } from './DailyStudySetup.js';
import { DailyStudyStage } from './DailyStudyStage.js';
import { DailyStudyComplete } from './DailyStudyComplete.js';

interface DailyWordStudyHubProps {
  language: string;
  onGoToReview: () => void;
}

export function DailyWordStudyHub({ language, onGoToReview }: DailyWordStudyHubProps) {
  const [mode, setMode] = useState<'setup' | 'studying' | 'complete'>('setup');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('ja-n5-core');
  const [batchSize, setBatchSize] = useState<10 | 20>(10);
  const [isRandom, setIsRandom] = useState(true);
  const [sessionWords, setSessionWords] = useState<WordlistWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const wordlistsQuery = useWordlistsQuery(DEFAULT_USER_ID, language);
  const vocabularyQuery = useVocabularyQuery(language);
  const cardsQuery = useCardsQuery();
  const collectMutation = useCollectDictionaryEntryMutation();
  const markStudiedMutation = useMarkCardStudiedMutation();

  const groups = wordlistsQuery.data ?? [];

  // 格式化各词包选项
  const sources: StudySourceOption[] = useMemo(() => {
    return groups.map((g) => ({
      id: g.id,
      title: g.title,
      subtitle: g.subtitle,
      total: g.words.length,
      studied: g.words.filter((w) => w.studied).length,
      collected: g.words.filter((w) => w.collected).length,
    }));
  }, [groups]);

  // 如果默认选中的源不存在（如非日语轨道），自动对齐第一个
  const activeSourceId = useMemo(() => {
    if (sources.some((s) => s.id === selectedSourceId)) return selectedSourceId;
    return sources[0]?.id ?? '';
  }, [sources, selectedSourceId]);

  // 抽取词汇并启动学习会话
  const handleStart = () => {
    const group = groups.find((g) => g.id === activeSourceId);
    if (!group || group.words.length === 0) {
      toast.error('当前词库暂无可学习词汇');
      return;
    }

    // 优先抽取尚未学透的生词；若全部已学透，则循环抽取
    const unstudied = group.words.filter((w) => !w.studied);
    const pool = unstudied.length > 0 ? unstudied : group.words;

    let chosen: WordlistWord[];
    if (isRandom) {
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      chosen = shuffled.slice(0, batchSize);
    } else {
      chosen = pool.slice(0, batchSize);
    }

    setSessionWords(chosen);
    setCurrentIndex(0);
    setMode('studying');
  };

  // 当前激活词汇
  const currentWord: WordlistWord | undefined = sessionWords[currentIndex];

  // 将 WordlistWord 映射对齐到统一的 VocabularyEntry 事实源
  const activeVocab: VocabularyEntry | undefined = useMemo(() => {
    if (!currentWord) return undefined;
    const vocabList = vocabularyQuery.data ?? [];
    const found = vocabList.find(
      (v) => v.id === currentWord.entryId || v.word === currentWord.headword
    );
    if (found) return found;

    return {
      id: currentWord.entryId,
      word: currentWord.headword,
      reading: currentWord.reading ?? '',
      language: (language === 'en' || language === 'ko' ? language : 'ja') as 'ja' | 'en' | 'ko',
      meaning: currentWord.meanings.join('；'),
      level: 'N5',
      collected: currentWord.collected,
      sources: [
        {
          documentId: 'n5-lexicon',
          chapterId: 'n5-core',
          bookTitle: 'JLPT N5 核心词库',
          chapterTitle: currentWord.partOfSpeech ?? '核心词汇',
          meaning: currentWord.meanings.join('；'),
          partOfSpeech: currentWord.partOfSpeech,
          examples: [],
          source: 'AI' as const,
        },
      ],
    };
  }, [currentWord, vocabularyQuery.data, language]);

  // 推进学习：入库、标记学透并进入下一词
  const handleCollectAndNext = async () => {
    if (!currentWord) return;
    setIsProcessing(true);

    try {
      let cardId: string | undefined = undefined;

      // 若尚未收录入库，执行入库
      if (!currentWord.collected) {
        const result = await collectMutation.mutateAsync(currentWord.entryId);
        cardId = result.card?.id;
      } else {
        // 若已收录，从卡片列表反查 cardId
        const card = cardsQuery.data?.find(
          (c) => c.frontWord === currentWord.headword || c.vocabularyId === currentWord.entryId
        );
        cardId = card?.id;
      }

      // 标记为已学透
      if (cardId) {
        await markStudiedMutation.mutateAsync(cardId);
      }

      sound.playCorrect();
      toast.success(`「${currentWord.headword}」已学透并纳入 FSRS 科学复习`);

      if (currentIndex < sessionWords.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        setMode('complete');
      }
    } catch (e) {
      sound.playMistake();
      toast.error(e instanceof Error ? e.message : '入库保存失败，请重试');
    } finally {
      setIsProcessing(false);
    }
  };

  const activeSourceMeta = sources.find((s) => s.id === activeSourceId);

  if (mode === 'complete') {
    return (
      <DailyStudyComplete
        count={sessionWords.length}
        sourceTitle={activeSourceMeta?.title ?? '词库'}
        onGoToReview={onGoToReview}
        onStudyMore={() => {
          setMode('setup');
        }}
      />
    );
  }

  if (mode === 'studying' && currentWord && activeVocab) {
    return (
      <DailyStudyStage
        totalCount={sessionWords.length}
        currentIndex={currentIndex}
        activeVocab={activeVocab}
        sourceTitle={activeSourceMeta?.title ?? 'N5 核心词库'}
        isCollected={currentWord.collected}
        isStudied={currentWord.studied}
        isProcessing={isProcessing}
        onPrev={() => setCurrentIndex((i) => Math.max(0, i - 1))}
        onNext={() => {
          if (currentIndex < sessionWords.length - 1) {
            setCurrentIndex((i) => i + 1);
          } else {
            setMode('complete');
          }
        }}
        onCollectAndNext={handleCollectAndNext}
        onQuit={() => setMode('setup')}
      />
    );
  }

  return (
    <DailyStudySetup
      sources={sources}
      selectedSourceId={activeSourceId}
      onSelectSource={setSelectedSourceId}
      batchSize={batchSize}
      onSelectBatchSize={setBatchSize}
      isRandom={isRandom}
      onToggleRandom={() => setIsRandom((v) => !v)}
      onStart={handleStart}
      isLoading={wordlistsQuery.isLoading}
    />
  );
}
