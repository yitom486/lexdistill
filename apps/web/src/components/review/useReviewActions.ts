import { toast } from 'sonner';
import { useRef, useEffect } from 'react';
import type { CardReviewRating } from '@lexdistill/protocol';
import { fireSuccessConfetti } from '../magicui/index.js';
import { sound } from '../../utils/audio.js';
import { useStudySessionStore } from '../../stores/useStudySessionStore.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';
import type { StudyCardItem } from '../../models/learning.js';
import type {
  useUpdateCardMutation,
  useExportApkgMutation,
} from '../../queries/useLearnerQueries.js';

interface ReviewActionsInput {
  track: TrackLanguage;
  activeCard: StudyCardItem | undefined;
  filteredCards: StudyCardItem[];
  currentCardIndex: number;
  setCurrentCardIndex: (i: number) => void;
  setCardFlipped: (v: boolean) => void;
  setDeepStudyOpen: (v: boolean) => void;
  planIsCards: boolean;
  updateCard: ReturnType<typeof useUpdateCardMutation>;
  exportApkg: ReturnType<typeof useExportApkgMutation>;
}

/**
 * 复习编排：导出 apkg、AI 讲透、FSRS 评级结算与下一张推进。
 * 只做交互编排；评级算法、间隔与持久化归 mutation/后端。
 */
export function useReviewActions(input: ReviewActionsInput) {
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latestCard = useRef('');
  latestCard.current = `${input.track}:${input.activeCard?.id ?? ''}`;
  const openTutor = useStudySessionStore((s) => s.openTutor);
  const {
    track,
    activeCard,
    filteredCards,
    currentCardIndex,
    setCurrentCardIndex,
    setCardFlipped,
    setDeepStudyOpen,
    planIsCards,
    updateCard,
    exportApkg,
  } = input;

  const handleExportApkg = () => {
    sound.playClick();
    exportApkg.mutate(
      { language: track },
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
    if (!activeCard || submitting.current || updateCard.isPending) return;
    submitting.current = true;

    updateCard.mutate(
      { id: activeCard.id, rating },
      {
        onSuccess: (data) => {
          if (!mounted.current || latestCard.current !== `${track}:${activeCard.id}`) return;
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
          if (!planIsCards && currentCardIndex < filteredCards.length - 1) {
            setCurrentCardIndex(currentCardIndex + 1);
          } else {
            setCurrentCardIndex(0);
          }
        },
        onError: (e) => {
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '保存复习状态失败，请稍后重试。');
        },
        onSettled: () => { submitting.current = false; },
      }
    );
  };

  return { handleExportApkg, handleAskAi, handleCardReview };
}
