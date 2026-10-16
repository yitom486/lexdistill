import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { sound } from '../../utils/audio.js';
import {
  useTextbookLessonQuizMutation,
  usePrependQuestionMutation,
  useEnrichLessonMutation,
} from '../../queries/useLearnerQueries.js';
import { useCollectVocabularyMutation } from '../../queries/vocabulary.js';
import { useStudySessionStore } from '../../stores/useStudySessionStore.js';
import { toUiQuizType } from '@lexdistill/protocol';
import type { QuizQuestionItem } from '../../models/learning.js';
import type {
  FuriganaWord,
  TextbookBook,
  TextbookLesson,
  TextbookVocabulary,
} from '../../models/textbook.js';
import type { VocabularyEntry } from '@lexdistill/protocol';

interface LessonActionsInput {
  currentBook: TextbookBook | undefined;
  currentLesson: TextbookLesson | undefined;
  vocabularyEntries: VocabularyEntry[];
  onStartLessonQuiz: (lessonId: string, lessonTitle: string) => void;
}

function toQuizItem(raw: Record<string, unknown>, category: string): QuizQuestionItem {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const rawOptions = Array.isArray(raw.options)
    ? raw.options.map((text: unknown, i: number) => ({
        key: String.fromCharCode(65 + i),
        text: str(text),
      }))
    : undefined;
  return {
    id: str(raw.id),
    type: toUiQuizType(str(raw.type) || 'MULTIPLE_CHOICE'),
    category,
    prompt: str(raw.prompt),
    content: str(raw.content),
    ...(rawOptions ? { options: rawOptions } : {}),
    correctAnswer: str(raw.correctAnswer),
    explanation: str(raw.explanation),
    testedSkill: str(raw.testedSkillId),
  };
}

/**
 * 课次动作编排：本课出题、AI 抽生词、教材词加卡。
 * 只做交互编排；出题/抽取/收集与持久化归 mutation。生成与提交用同步
 * ref 锁防同 tick 重复；失败保留上下文可重试。
 */
export function useStoredLessonActions(input: LessonActionsInput) {
  const { currentBook, currentLesson, vocabularyEntries, onStartLessonQuiz } = input;
  const lessonQuiz = useTextbookLessonQuizMutation();
  const prependQuestion = usePrependQuestionMutation();
  const enrichLesson = useEnrichLessonMutation();
  const collectVocabulary = useCollectVocabularyMutation();
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const setQuestionIndex = useStudySessionStore((s) => s.setQuestionIndex);
  const [quizzing, setQuizzing] = useState(false);
  // 同步出题/抽取锁：与 disabled 双重保护同 tick 连击
  const quizzingRef = useRef(false);
  const enrichingRef = useRef(false);
  const collectingRef = useRef(false);
  const mounted = useRef(false);
  const liveKey = useRef('');
  liveKey.current = `${currentBook?.id}:${currentLesson?.id}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // 本课真出题（mutation + 题库前插 + 切 QUIZ；无 documentId 时走旧跳转回退）。
  const startRealLessonQuiz = async (
    documentId: string | undefined,
    lessonId: string,
    lessonTitle: string
  ) => {
    if (!documentId) {
      onStartLessonQuiz(lessonId, lessonTitle);
      return;
    }
    if (quizzingRef.current || lessonQuiz.isPending) return;
    quizzingRef.current = true;
    const requestKey = liveKey.current;
    sound.playClick();
    setQuizzing(true);
    try {
      const r = await lessonQuiz.mutateAsync({ documentId, lessonId, count: 5 });
      if (!mounted.current || requestKey !== liveKey.current) return;
      if (r.questions.length === 0) {
        toast.error('本课暂无可用语料出题');
        return;
      }
      const category = `教材专属 · 《${r.bookTitle}》${r.lessonTitle}`;
      // 逐题前插：倒序插回后正序（首题即第 0 题）。
      for (let i = r.questions.length - 1; i >= 0; i--) {
        await prependQuestion.mutateAsync(toQuizItem(r.questions[i] ?? {}, category));
      }
      if (!mounted.current || requestKey !== liveKey.current) return;
      setQuestionIndex(0);
      setActiveTab('QUIZ');
      sound.playSuccess();
      toast.success(`已按本课出 ${r.questions.length} 道题（已同步收进练习队列）`);
    } catch (e) {
      if (!mounted.current || requestKey !== liveKey.current) return;
      sound.playMistake();
      toast.error(e instanceof Error ? e.message : '本课出题失败');
    } finally {
      if (mounted.current) setQuizzing(false);
      quizzingRef.current = false;
    }
  };

  const enrichCurrentLesson = () => {
    if (!currentBook?.documentId || !currentLesson) return;
    if (enrichingRef.current || enrichLesson.isPending) return;
    enrichingRef.current = true;
    sound.playClick();
    enrichLesson.mutate(
      { documentId: currentBook.documentId as string, lessonId: currentLesson.id },
      {
        onSuccess: (r) => {
          sound.playCorrect();
          toast.success(
            `AI 抽取完成：生词 ${r.vocabularies} · 文法 ${r.grammarPoints}` +
              (r.dropped > 0 ? `（丢弃可疑 ${r.dropped} 条）` : '') +
              (r.draftsProposed > 0
                ? ` · ${r.draftsProposed} 条已进生词草稿箱待确认`
                : '')
          );
        },
        onError: (e) => {
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '抽生词失败');
        },
        onSettled: () => {
          enrichingRef.current = false;
        },
      }
    );
  };

  const handleAddCard = (word: FuriganaWord | TextbookVocabulary) => {
    if (!currentBook || !currentLesson || collectingRef.current) return;
    const isVocab = 'kanji' in word;
    const candidates = vocabularyEntries.filter(entry => entry.word === (isVocab ? word.kanji : word.surface)
      && entry.reading === (isVocab ? word.kana : word.reading ?? '')
      && entry.sources.some(source => source.documentId === currentBook.documentId && source.chapterId === currentLesson.id));
    if (candidates.length !== 1 || !currentBook.documentId) { toast.error('未找到对应的教材词条，请重新加载教材'); return; }
    collectingRef.current = true;
    collectVocabulary.mutate({ vocabularyId: candidates[0]!.id, documentId: currentBook.documentId, chapterId: currentLesson.id }, {
      onSuccess: result => toast.success(result.created ? '已加入复习' : '已在复习中，进度已保留'),
      onError: error => toast.error(error.message),
      onSettled: () => { collectingRef.current = false; },
    });
  };

  const addedCardsMap: Record<string, boolean> = Object.fromEntries(
    (currentLesson?.vocabularies ?? []).map(word => [word.id,
      vocabularyEntries.some(entry => entry.word === word.kanji && entry.reading === word.kana && entry.collected
        && entry.sources.some(source => source.documentId === currentBook?.documentId && source.chapterId === currentLesson?.id))])
  );

  return {
    quizzing,
    enriching: enrichLesson.isPending,
    startRealLessonQuiz,
    enrichCurrentLesson,
    handleAddCard,
    addedCardsMap,
    collecting: collectVocabulary.isPending,
  };
}

export type StoredLessonActions = ReturnType<typeof useStoredLessonActions>;
