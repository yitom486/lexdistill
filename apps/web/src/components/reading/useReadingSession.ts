import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ReadingPassageSet } from '@study-studio/protocol';
import { sound, speechStudio } from '../../utils/audio.js';
import { openLookupPopup } from '../../lib/lookup-popup-bus.js';
import { normalizeSelectionText, type LookupLanguage } from '../../lib/selection-text.js';
import { toPlainReadingText } from '../../utils/plain-text.js';
import { fireSuccessConfetti } from '../magicui/index.js';
import {
  useReadingSetsQuery,
  useGenerateReadingSetMutation,
  useSubmitReadingPracticeMutation,
  useAddAnnotationMutation,
  useAddCardsMutation,
} from '../../queries/useLearnerQueries.js';

export interface SelectionAnchor {
  text: string;
  x: number;
  y: number;
}

interface ReadingSessionInput {
  origin: 'ai' | 'news';
  readingLanguage: 'JA' | 'EN' | 'KO';
  passageRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 阅读会话编排：篇目/题目推进、作答计分、朗读、划词工具、生成与成绩回写。
 * 只做交互编排；篇目来源、批改与持久化归 query/mutation。生成与批改无 abort
 * 通道，迟到回执用 epoch 隔离，不覆盖用户已切换的新上下文。
 */
export function useReadingSession({ origin, readingLanguage, passageRef }: ReadingSessionInput) {
  const setsQuery = useReadingSetsQuery(origin, readingLanguage);
  const generateMutation = useGenerateReadingSetMutation();
  const submitPracticeMutation = useSubmitReadingPracticeMutation();
  const addAnnotationMutation = useAddAnnotationMutation();
  const addCardsMutation = useAddCardsMutation();

  const combinedSets: ReadingPassageSet[] = useMemo(() => setsQuery.data ?? [], [setsQuery.data]);

  const [activeSetId, setActiveSetId] = useState<string>('');
  const [stepIndex, setStepIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const score = Object.values(answers).filter(Boolean).length;
  const answerLocked = useRef(false);
  const completionLocked = useRef(false);
  const [completionPending, setCompletionPending] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const mounted = useRef(false);
  const liveSetKey = useRef('');
  const annotationLocked = useRef(false);
  const cardLocked = useRef(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [selectionRange, setSelectionRange] = useState<SelectionAnchor | null>(null);
  const liveSelection = useRef<string | undefined>(undefined);
  liveSelection.current = selectionRange?.text;
  // 生成 epoch：用户切来源/语种后，迟到回执只刷新列表，不抢当前篇目
  const generateEpoch = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generateEpoch.current += 1;
      speechStudio.stop();
    };
  }, []);
  useEffect(() => {
    generateEpoch.current += 1;
    speechStudio.stop();
    setIsPlayingAudio(false);
    setSelectionRange(null);
  }, [origin, readingLanguage]);

  // 默认选中第一个可用篇目；切语种后不得残留他语篇目
  useEffect(() => {
    if (combinedSets.length > 0) {
      if (!activeSetId || !combinedSets.some((s) => s.id === activeSetId)) {
        setActiveSetId(combinedSets[0]!.id);
        setStepIndex(0);
        setSelected(null);
        setSubmitted(false);
        setAnswers({});
        answerLocked.current = false;
      }
    } else {
      setActiveSetId('');
      setStepIndex(0);
      setSelected(null);
      setSubmitted(false);
      setAnswers({});
      answerLocked.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedSets]);

  const activeSet: ReadingPassageSet | undefined =
    combinedSets.find((s) => s.id === activeSetId) ?? combinedSets[0];
  liveSetKey.current = `${origin}:${readingLanguage}:${activeSet?.id ?? ''}`;

  const plainBody = useMemo(
    () => (activeSet ? toPlainReadingText(activeSet.body) : ''),
    [activeSet]
  );

  const question = activeSet?.questions[stepIndex] ?? activeSet?.questions[0];
  const totalQuestions = activeSet?.questions?.length ?? 0;
  const progressPct = totalQuestions ? ((stepIndex + (submitted ? 1 : 0)) / totalQuestions) * 100 : 0;

  const resetAnswer = () => {
    setStepIndex(0);
    setSelected(null);
    setSubmitted(false);
    setAnswers({});
    answerLocked.current = false;
    setCompletionError(null);
  };

  // 朗读文章
  const handleTogglePlayAudio = () => {
    if (!activeSet) return;
    sound.playClick();
    if (isPlayingAudio) {
      speechStudio.stop();
      setIsPlayingAudio(false);
    } else {
      setIsPlayingAudio(true);
      speechStudio.speak(plainBody || activeSet.body, {
        lang: activeSet.language,
        onEnd: () => setIsPlayingAudio(false),
        onError: () => setIsPlayingAudio(false),
      });
    }
  };

  const stopAudio = () => {
    speechStudio.stop();
    setIsPlayingAudio(false);
  };

  // 监听划词选择
  const handleMouseUpPassage = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelectionRange(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length > 1) {
      const range = sel.getRangeAt(0);
      if (!passageRef.current?.contains(range.startContainer) || !passageRef.current.contains(range.endContainer)) {
        setSelectionRange(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const parentRect = passageRef.current?.getBoundingClientRect();
      if (parentRect) {
        setSelectionRange({
          text,
          x: Math.max(10, rect.left - parentRect.left + rect.width / 2 - 100),
          y: Math.max(10, rect.top - parentRect.top - 44),
        });
      }
    }
  };

  const clearSelection = () => {
    setSelectionRange(null);
    window.getSelection()?.removeAllRanges();
  };

  // 划词标记重点：以服务端回执为准，不预告成功
  const handleMarkKeyPoint = () => {
    if (!activeSet || !selectionRange?.text || annotationLocked.current) return;
    annotationLocked.current = true;
    const key = liveSetKey.current;
    sound.playClick();
    const quote = selectionRange.text;
    addAnnotationMutation.mutate(
      {
        documentId: activeSet.id,
        quote,
        kind: 'KEY_POINT',
        startOffset: 0,
        endOffset: quote.length,
      },
      {
        onSuccess: () => {
          if (!mounted.current || key !== liveSetKey.current) return;
          toast.success(`重点批注已保存：“${quote.slice(0, 15)}...”`);
          if (liveSelection.current === quote) clearSelection();
        },
        onError: (e) => { if (mounted.current && key === liveSetKey.current) toast.error(e instanceof Error ? e.message : '批注保存失败，请重试。'); },
        onSettled: () => { annotationLocked.current = false; },
      }
    );
    // 保存失败保留选区，允许原地重试。
  };

  // 划词查词典：经总线复用全局查词浮层
  const handleLookupSelection = () => {
    if (!activeSet || !selectionRange?.text) return;
    const language: LookupLanguage =
      activeSet.language === 'EN' ? 'en' : activeSet.language === 'KO' ? 'ko' : 'ja';
    const text = normalizeSelectionText(selectionRange.text);
    if (!text) return;
    sound.playClick();
    const parentRect = passageRef.current?.getBoundingClientRect();
    const x = parentRect ? parentRect.left + selectionRange.x : window.innerWidth / 2 - 130;
    const y = parentRect ? parentRect.top + selectionRange.y + 44 : 120;
    openLookupPopup({ text, language, x, y });
  };

  // 划词转记忆卡：以服务端回执为准
  const handleConvertToFlashcard = () => {
    if (!activeSet || !selectionRange?.text || cardLocked.current) return;
    cardLocked.current = true;
    const key = liveSetKey.current;
    sound.playClick();
    const quote = selectionRange.text;
    const title = activeSet.title;
    const excerpt = plainBody.slice(0, 80) || activeSet.body.slice(0, 80);
    addCardsMutation.mutate(
      [
        {
          id: `card_${Date.now()}`,
          type: 'VOCAB',
          frontWord: quote,
          reading: '',
          tag: '阅读精读',
          pos: '重点词句',
          backMeaning: `来自阅读篇目《${title}》的重点摘录与研读。`,
          exampleJp: excerpt,
          exampleHighlight: quote,
          exampleZh: '',
          stability: 1.0,
          reps: 0,
        },
      ],
      {
        onSuccess: () => {
          if (!mounted.current || key !== liveSetKey.current) return;
          toast.success('记忆卡已保存，可在复习页面查看。');
          if (liveSelection.current === quote) clearSelection();
        },
        onError: (e) => { if (mounted.current && key === liveSetKey.current) toast.error(e instanceof Error ? e.message : '转闪卡失败，请重试。'); },
        onSettled: () => { cardLocked.current = false; },
      }
    );
    // 保存失败保留选区，允许原地重试。
  };

  // 提交单题作答（本地判定即时反馈；成绩回写只在完成整篇时做）
  const handleSubmitAnswer = () => {
    if (!selected || answerLocked.current || submitted || !question) return;
    answerLocked.current = true;
    sound.playClick();
    const ok = selected === question.correctAnswer;
    setSubmitted(true);
    setAnswers((previous) => ({ ...previous, [stepIndex]: ok }));
    if (ok) {
      sound.playCorrect();
      toast.success('回答正确！+1');
    } else {
      sound.playMistake();
      toast.error(`回答有误，正确答案为: ${question.correctAnswer}`);
    }
  };

  // 进入下一题或完成整篇
  const handleNextQuestion = () => {
    if (!activeSet || !submitted || completionLocked.current) return;
    sound.playClick();
    if (stepIndex < totalQuestions - 1) {
      setStepIndex((i) => i + 1);
      setSelected(null);
      setSubmitted(false);
      answerLocked.current = false;
    } else {
      // 本题已在提交时计分，finalScore 即当前 score；成绩回写失败必须可见
      const finalScore = score;
      completionLocked.current = true;
      setCompletionPending(true);
      setCompletionError(null);
      const key = liveSetKey.current;
      const epoch = generateEpoch.current;
      const isCurrent = () => mounted.current && key === liveSetKey.current && epoch === generateEpoch.current;
      submitPracticeMutation.mutate(
        {
          setId: activeSet.id,
          score: finalScore,
          totalQuestions,
          language: activeSet.language,
        },
        {
          onSuccess: () => {
            if (!isCurrent()) return;
            if (finalScore >= Math.ceil(totalQuestions * 0.8)) {
              fireSuccessConfetti();
              sound.playSuccess();
            }
            toast.success(`本篇成绩已保存：${finalScore}/${totalQuestions} 题正确。`);
            resetAnswer();
          },
          onError: (e) => {
            if (!isCurrent()) return;
            const message = e instanceof Error ? e.message : '成绩保存失败，请重试。';
            setCompletionError(message);
            toast.error(message);
          },
          onSettled: () => {
            completionLocked.current = false;
            if (mounted.current) setCompletionPending(false);
          },
        }
      );
    }
  };

  const handlePrevQuestion = () => {
    if (completionLocked.current || stepIndex === 0) return;
    sound.playClick();
    setStepIndex((i) => Math.max(0, i - 1));
    setSelected(null);
    setSubmitted(false);
    answerLocked.current = false;
  };

  const switchToSet = (id: string) => {
    generateEpoch.current += 1;
    sound.playClick();
    stopAudio();
    setActiveSetId(id);
    resetAnswer();
    clearSelection();
  };

  /** 采用新生成的篇目（调用方负责 epoch 隔离）。 */
  const applyGeneratedSet = (id: string) => {
    stopAudio();
    clearSelection();
    setActiveSetId(id);
    resetAnswer();
  };

  return {
    setsQuery,
    combinedSets,
    activeSet,
    plainBody,
    question,
    totalQuestions,
    progressPct,
    stepIndex,
    selected,
    setSelected,
    submitted,
    score,
    completionPending,
    completionError,
    isPlayingAudio,
    selectionRange,
    annotationPending: addAnnotationMutation.isPending,
    cardPending: addCardsMutation.isPending,
    generateMutation,
    generateEpoch,
    isMounted: () => mounted.current,
    resetAnswer,
    handleTogglePlayAudio,
    stopAudio,
    handleMouseUpPassage,
    handleMarkKeyPoint,
    handleLookupSelection,
    handleConvertToFlashcard,
    handleSubmitAnswer,
    handleNextQuestion,
    handlePrevQuestion,
    switchToSet,
    applyGeneratedSet,
  };
}

export type ReadingSession = ReturnType<typeof useReadingSession>;
