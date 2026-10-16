import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { MistakeNotebookItem } from '../../models/learning.js';
import { sound } from '../../utils/audio.js';
import { useUpdateMistakeMutation } from '../../queries/useLearnerQueries.js';

export interface SprintFeedback {
  submitted: boolean;
  isCorrect: boolean;
  saved: boolean;
}

/**
 * 错题冲刺编排：开始时快照待攻克队列，迟到回执与列表刷新不置换当前题；
 * 提交期（mutation pending）禁用输入与重复提交；答案以服务端回执为准。
 */
export function useMistakeSprint(unresolvedMistakes: MistakeNotebookItem[]) {
  const updateMistake = useUpdateMistakeMutation();
  // 同步提交锁：与 disabled + isPending 三重保护同 tick 连击
  const submittingRef = useRef(false);
  const epoch = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current += 1; };
  }, []);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 本轮冲刺队列：开始时快照，轮内不受外部列表变化影响
  const [sprintQueue, setSprintQueue] = useState<MistakeNotebookItem[]>([]);
  const [isSprintActive, setIsSprintActive] = useState(false);
  const [sprintIndex, setSprintIndex] = useState(0);
  const [sprintAnswer, setSprintAnswer] = useState('');
  const [sprintFeedback, setSprintFeedback] = useState<SprintFeedback | null>(null);

  // 当前冲刺中的题目（快照内取值，不随实时列表漂移）
  const activeSprintItem = sprintQueue[sprintIndex];

  // 启动错题冲刺
  const handleStartSprint = () => {
    epoch.current += 1;
    setSaveError(null);
    if (unresolvedMistakes.length === 0) {
      toast.success('当前没有任何未攻克的错题！');
      return;
    }
    sound.playClick();
    setSprintQueue([...unresolvedMistakes]);
    setIsSprintActive(true);
    setSprintIndex(0);
    setSprintAnswer('');
    setSprintFeedback(null);
  };

  // 退出冲刺
  const handleExitSprint = () => {
    epoch.current += 1;
    sound.playClick();
    setIsSprintActive(false);
    setSprintFeedback(null);
  };

  // 提交冲刺作答：提交期守卫，迟到回执只作用于提交时的题目
  const handleSubmitSprintAnswer = () => {
    const target = activeSprintItem;
    if (!sprintAnswer.trim() || !target || submittingRef.current || updateMistake.isPending) return;
    submittingRef.current = true;
    const requestEpoch = epoch.current;
    const isCurrent = () => mounted.current && requestEpoch === epoch.current;
    setSaveError(null);

    const trimmed = sprintAnswer.trim();
    const isCorrect =
      trimmed.toLowerCase() === target.correctAnswer.toLowerCase();

    setSprintFeedback({ submitted: true, isCorrect, saved: false });
    updateMistake.mutate(
      { mistakeId: target.id, isCorrect },
      {
        onSuccess: (result) => {
          if (!isCurrent()) return;
          setSprintFeedback({ submitted: true, isCorrect, saved: true });
          if (isCorrect) {
            sound.playSuccess();
            toast.success(
              result.isResolved
                ? '连续 2 次正确！该题已彻底攻克出库！'
                : `回答正确！连对进度 ${result.consecutiveCorrect}/2`
            );
          } else {
            sound.playError();
            toast.error(`回答有误：正确应为「${target.correctAnswer}」`);
          }
        },
        onError: (error) => {
          if (!isCurrent()) return;
          const message = error instanceof Error ? error.message : '更新错题订正状态失败，请稍后重试。';
          setSprintFeedback(null);
          setSaveError(message);
          toast.error(message);
        },
        onSettled: () => {
          submittingRef.current = false;
        },
      }
    );
  };

  const handleNextSprintItem = () => {
    if (submittingRef.current || !sprintFeedback?.saved) return;
    sound.playClick();
    setSprintAnswer('');
    setSprintFeedback(null);
    if (sprintIndex < sprintQueue.length - 1) {
      setSprintIndex((prev) => prev + 1);
    } else {
      setIsSprintActive(false);
      toast.success('错题冲刺轮练已全部完成！');
    }
  };

  return {
    isSprintActive,
    sprintQueue,
    sprintIndex,
    sprintAnswer,
    setSprintAnswer,
    sprintFeedback,
    activeSprintItem,
    submitPending: updateMistake.isPending,
    saveError,
    handleStartSprint,
    handleExitSprint,
    handleSubmitSprintAnswer,
    handleNextSprintItem,
  };
}

export type MistakeSprint = ReturnType<typeof useMistakeSprint>;
