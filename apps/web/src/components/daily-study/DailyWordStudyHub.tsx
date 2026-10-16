import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import type { VocabularyEntry } from '@study-studio/protocol';
import { unitsForTrack, selectCourseWords } from '@study-studio/learner-core';
import { useUserProfileStore } from '../../stores/useUserProfileStore.js';
import { useWordlistsQuery, type WordlistWord } from '../../queries/wordlists.js';
import { useVocabularyQuery, useDailyPickMutation, BankLockedError } from '../../queries/vocabulary.js';
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
  courseUnitId?: string | undefined;
}

export function DailyWordStudyHub({ language, onGoToReview, courseUnitId }: DailyWordStudyHubProps) {
  const unit = unitsForTrack(language as 'ja' | 'en' | 'ko').find(u => u.id === courseUnitId);
  const wordRule = unit?.evidence.type === 'words-studied' ? unit.evidence : undefined;
  const [mode, setMode] = useState<'setup' | 'studying' | 'complete'>('setup');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(wordRule?.group ?? 'ja-n5-core');
  const [batchSize, setBatchSize] = useState<10 | 20>(10);
  const [isRandom, setIsRandom] = useState(true);
  const [sessionWords, setSessionWords] = useState<WordlistWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);

  const userId = useUserProfileStore(s => s.profile.userId) || DEFAULT_USER_ID;
  const wordlistsQuery = useWordlistsQuery(userId, language);
  const vocabularyQuery = useVocabularyQuery(language);
  const cardsQuery = useCardsQuery();
  const collectMutation = useCollectDictionaryEntryMutation();
  const markStudiedMutation = useMarkCardStudiedMutation();
  const dailyPickMutation = useDailyPickMutation(userId);

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
  const unitWords = unit ? selectCourseWords(unit, groups) : [];
  const unitSources = unit ? [{ id: activeSourceId, title: unit.title,
    subtitle: '学习本单元指定词汇；复习后按真实证据更新掌握进度。',
    total: unitWords.length, studied: unitWords.filter(w => w.studied).length,
    collected: unitWords.filter(w => w.collected).length }] : sources;

  // 抽取词汇并启动学习会话
  const handleStart = async () => {
    const group = groups.find((g) => g.id === activeSourceId);
    if (!group) {
      toast.error('当前词库不存在');
      return;
    }

    setLockMessage(null);

    try {
      const trackLang = (language === 'en' || language === 'ko' ? language : 'ja') as 'ja' | 'en' | 'ko';
      const result = await dailyPickMutation.mutateAsync({
        lang: trackLang,
        count: wordRule?.entryIds?.length ?? batchSize,
        order: courseUnitId ? 'sequential' : isRandom ? 'random' : 'sequential',
        bankId: activeSourceId,
        ...(courseUnitId ? { courseUnitId } : {}),
      });

      if (!result.words || result.words.length === 0) {
        toast.error('当前词库暂无可学习词汇');
        return;
      }

      setSessionWords(result.words);
      setCurrentIndex(0);
      setMode('studying');
    } catch (err: unknown) {
      if (err instanceof BankLockedError || (err as { code?: string })?.code === 'E_BANK_LOCKED') {
        const msg = (err as { userMessage?: string }).userMessage || (err instanceof Error ? err.message : '该词库已锁定');
        setLockMessage(msg);
        return;
      }
      toast.error(err instanceof Error ? err.message : '抽取词汇失败，请重试');
    }
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
      level: currentWord.jlpt ?? null,
      collected: currentWord.collected,
      sources: [],
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
        const card = cardsQuery.data?.find((c) => c.sourceEntryId === currentWord.entryId);
        cardId = card?.id;
      }

      // 标记为已学透
      if (!cardId) throw new Error('未找到对应生词卡，请重新加载后重试。');
      await markStudiedMutation.mutateAsync(cardId);

      sound.playCorrect();
      toast.success(`「${currentWord.headword}」已记录学习，请继续复习巩固`);

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

  const activeSourceMeta = unitSources.find((s) => s.id === activeSourceId);

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
        sourceTitle={activeSourceMeta?.title ?? '词库'}
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
      sources={unitSources}
      unitWordCount={unit ? Math.min(wordRule?.entryIds?.length ?? batchSize, unitWords.length) : undefined}
      selectedSourceId={activeSourceId}
      onSelectSource={(id) => {
        setSelectedSourceId(id);
        setLockMessage(null);
      }}
      batchSize={batchSize}
      onSelectBatchSize={setBatchSize}
      isRandom={isRandom}
      onToggleRandom={() => setIsRandom((v) => !v)}
      onStart={handleStart}
      isLoading={wordlistsQuery.isLoading || dailyPickMutation.isPending}
      lockMessage={lockMessage}
      sourcesError={wordlistsQuery.isError}
      onRetrySources={() => void wordlistsQuery.refetch()}
    />
  );
}
