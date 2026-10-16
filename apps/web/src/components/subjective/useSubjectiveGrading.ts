import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { sound } from '../../utils/audio.js';
import { fireSuccessConfetti } from '../magicui/index.js';
import type { QuizGradingResult } from '@study-studio/protocol';
import type { SubjectiveExercise } from '../../models/practice.js';
import { useGradeSubjectiveMutation } from '../../queries/useAgentMutations.js';

/**
 * 主观题批改编排：批改期守卫重复提交；迟到回执用题干 id 隔离，
 * 切题/重出后落到的旧回执直接丢弃，不覆盖新上下文；失败保留答案可重试。
 * 批改通道无 abort，切题不取消网络，只隔离回执。
 */
export function useSubjectiveGrading(currentExercise: SubjectiveExercise | undefined) {
  const gradeSubjective = useGradeSubjectiveMutation();
  const [inputSubmission, setInputSubmission] = useState('');
  const [isGrading, setIsGrading] = useState(false);
  const [gradingResult, setGradingResult] = useState<QuizGradingResult | null>(null);
  const submitting = useRef(false);
  const requestEpoch = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestEpoch.current += 1; };
  }, []);
  // 提交时的题干 id：回执到达时仍是同一题才落盘
  const gradingExerciseId = useRef<string | null>(null);
  // 实时题干 id（回执比较用；提交闭包里的 currentExercise 是旧值，不能用于比较）
  const liveExerciseId = useRef<string | undefined>(undefined);
  liveExerciseId.current = currentExercise?.id;

  const resetAnswer = () => {
    requestEpoch.current += 1;
    setInputSubmission('');
    setGradingResult(null);
    gradingExerciseId.current = null;
    gradeSubjective.reset();
  };

  const handleGradeSubmit = async () => {
    if (!inputSubmission.trim() || submitting.current || !currentExercise) return;
    submitting.current = true;
    const epoch = ++requestEpoch.current;
    const exerciseId = currentExercise.id;
    const isCurrent = () => mounted.current && epoch === requestEpoch.current && exerciseId === liveExerciseId.current;

    sound.playClick();
    setIsGrading(true);
    setGradingResult(null);
    gradingExerciseId.current = currentExercise.id;
    const submittedText = inputSubmission.trim();

    try {
      const result = (await gradeSubjective.mutateAsync({
        questionId: currentExercise.id,
        prompt: currentExercise.chinesePrompt,
        standardAnswer: currentExercise.standardAnswer,
        userSubmission: submittedText,
        testedSkillId: currentExercise.testedSkillId,
      })) as QuizGradingResult;

      // 迟到回执隔离：用户已切题或重出题干则丢弃
      if (!isCurrent()) return;
      setGradingResult(result);

      if (result.isCorrect && result.score >= 80) {
        sound.playSuccess();
        fireSuccessConfetti();
        toast.success(`批改完成：综合评分 ${result.score} 分！表达严谨地道！`);
      } else {
        sound.playMistake();
        toast.error(
          `批改完成：发现 ${result.errorDiagnosis?.category ?? '语法'} 偏差，已自动录入错题本！`
        );
      }
    } catch (e) {
      // 失败保留答案：inputSubmission 不动，可直接重试
      if (!isCurrent()) return;
      toast.error(
        e instanceof Error ? e.message : '批改服务暂时不可用，请稍后重试；本次未记录任何结果。'
      );
    } finally {
      submitting.current = false;
      if (mounted.current) setIsGrading(false);
    }
  };

  return {
    inputSubmission,
    setInputSubmission,
    isGrading: isGrading || gradeSubjective.isPending,
    gradingResult,
    gradingExerciseId,
    resetAnswer,
    handleGradeSubmit,
  };
}

export type SubjectiveGrading = ReturnType<typeof useSubjectiveGrading>;
