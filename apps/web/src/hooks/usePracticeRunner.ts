import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  useSubmitObjectiveMutation,
  useSubmitSubjectiveMutation,
  useSavePracticeDraftMutation,
  useGradeBatchMutation,
  useGradeSingleMutation,
  useFinalizePracticeRunMutation,
} from '../queries/useLearnerQueries.js';
import type { PracticeItemAttempt, GeneratedQuestion } from '@study-studio/protocol';

export interface PracticeRunnerItem {
  itemId: string;
  blockId: string;
  question: GeneratedQuestion;
  gradingMode: 'AUTO_IMMEDIATE' | 'AI_IMMEDIATE' | 'AI_BATCH';
}

export type ItemStatus = 'PENDING' | 'DRAFT' | 'SUBMITTED' | 'GRADED';
export interface ItemViewState {
  status: ItemStatus;
  userAnswer: string;
  grading?: Record<string, unknown> | undefined;
  isCorrect?: boolean | undefined;
  /** 正在提交中（本地交互态，不代表已批改） */
  submitting?: boolean | undefined;
}

export const isObjectiveQuestion = (q: GeneratedQuestion) =>
  q.type === 'MULTIPLE_CHOICE' || q.type === 'FILL_IN_BLANK' || q.type === 'SENTENCE_REORDER';

function persistedState(a: PracticeItemAttempt): ItemViewState {
  return {
    status: a.status as ItemStatus,
    userAnswer: a.userAnswer ?? '',
    grading: a.gradingResult,
    isCorrect: (a.gradingResult as { isCorrect?: boolean } | undefined)?.isCorrect,
  };
}

/**
 * usePracticeRunner — ViewModel 层。
 * 事实源唯一：已持久化结果以 Query attempts 为准；本地仅保留草稿与
 * 提交中的交互态（pending），成功后以服务端返回/invalidate 为准，
 * 失败回滚 pending 并保留草稿。判题权威在 Gateway，UI 不做权威判定。
 */
export function usePracticeRunner(opts: {
  userId: string;
  runId: string;
  items: PracticeRunnerItem[];
  attempts: PracticeItemAttempt[];
  language: 'en' | 'ja' | 'ko';
}) {
  const { userId, runId, items, attempts, language } = opts;
  const submitObjective = useSubmitObjectiveMutation(userId);
  const submitSubjective = useSubmitSubjectiveMutation(userId);
  const saveDraft = useSavePracticeDraftMutation(userId);
  const gradeBatch = useGradeBatchMutation();
  const gradeSingle = useGradeSingleMutation();
  const finalizeRun = useFinalizePracticeRunMutation(userId);

  const persisted = useMemo(() => {
    const map = new Map<string, ItemViewState>();
    for (const a of attempts) map.set(a.itemId, persistedState(a));
    return map;
  }, [attempts]);

  // 草稿与提交中状态按 userId+runId 作用域隔离：切换时清空
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, string>>({});
  const [scopeKey, setScopeKey] = useState(`${userId}:${runId}`);
  useEffect(() => {
    const key = `${userId}:${runId}`;
    if (key !== scopeKey) {
      setScopeKey(key);
      setDrafts({});
      setPending({});
    }
  }, [userId, runId, scopeKey]);

  const viewStates: Record<string, ItemViewState> = useMemo(() => {
    const next: Record<string, ItemViewState> = {};
    for (const it of items) {
      const p = persisted.get(it.itemId);
      if (p && (p.status === 'GRADED' || p.status === 'SUBMITTED')) {
        next[it.itemId] = p;
        continue;
      }
      const pend = pending[it.itemId];
      if (pend !== undefined) {
        next[it.itemId] = { status: 'SUBMITTED', userAnswer: pend, submitting: true };
        continue;
      }
      const d = drafts[it.itemId];
      if (d !== undefined) {
        next[it.itemId] = { status: 'DRAFT', userAnswer: d };
        continue;
      }
      next[it.itemId] = p ?? { status: 'PENDING', userAnswer: '' };
    }
    return next;
  }, [items, persisted, drafts, pending]);

  const setDraft = (itemId: string, userAnswer: string) =>
    setDrafts((p) => ({ ...p, [itemId]: userAnswer }));
  const clearDraft = (itemId: string) =>
    setDrafts((p) => {
      const n = { ...p };
      delete n[itemId];
      return n;
    });

  const doneCount = items.filter((it) => {
    const s = viewStates[it.itemId];
    return s?.status === 'GRADED';
  }).length;
  const progress = items.length > 0 ? (doneCount / items.length) * 100 : 0;
  const isSubmitting =
    Object.keys(pending).length > 0 ||
    submitObjective.isPending || submitSubjective.isPending ||
    gradeSingle.isPending || gradeBatch.isPending || finalizeRun.isPending;
  const allDone = items.length > 0 && doneCount === items.length;
  const canFinish = allDone && !isSubmitting;
  const hasBatchSubjects = items.some((it) => !isObjectiveQuestion(it.question) && it.gradingMode === 'AI_BATCH');
  const itemBusy = (itemId: string) => pending[itemId] !== undefined;

  // 客观题：只提交答案，判题由 Gateway 服务端完成；成功后以服务端结果为准
  const handleObjective = async (it: PracticeRunnerItem, answer: string) => {
    const q = it.question;
    setPending((p) => ({ ...p, [it.itemId]: answer }));
    try {
      const attempt = await submitObjective.mutateAsync({
        runId, itemId: it.itemId, userAnswer: answer, testedSkillId: q.testedSkillId,
      });
      clearDraft(it.itemId);
      const ok = (attempt.gradingResult as { isCorrect?: boolean } | undefined)?.isCorrect ?? false;
      toast[ok ? 'success' : 'error'](ok ? '回答正确' : '答案不对，已记入错题信号');
    } catch (e) {
      toast.error((e as Error).message);
      setDraft(it.itemId, answer);
    } finally {
      setPending((p) => {
        const n = { ...p };
        delete n[it.itemId];
        return n;
      });
    }
  };

  const handleDraft = async (it: PracticeRunnerItem, answer: string) => {
    setDraft(it.itemId, answer);
    try {
      await saveDraft.mutateAsync({ runId, itemId: it.itemId, userAnswer: answer });
    } catch {
      /* 草稿失败静默，本地保留 */
    }
  };

  // AI_IMMEDIATE：先评测再落库；落库失败回滚为草稿保留，不显示 GRADED
  const handleImmediate = async (it: PracticeRunnerItem, answer: string) => {
    const q = it.question;
    setPending((p) => ({ ...p, [it.itemId]: answer }));
    try {
      const grading = await gradeSingle.mutateAsync({
        prompt: q.prompt, standardAnswer: q.correctAnswer, userSubmission: answer,
        testedSkillId: q.testedSkillId, language,
      });
      await submitSubjective.mutateAsync({
        runId, itemId: it.itemId, userAnswer: answer,
        gradingResult: grading as unknown as Record<string, unknown>,
      });
      clearDraft(it.itemId);
      toast[grading.isCorrect ? 'success' : 'error'](grading.isCorrect ? '即时批改通过' : '即时批改完成，已记入错题信号');
    } catch (e) {
      toast.error('即时批改失败，已保留草稿：' + (e as Error).message);
      setDraft(it.itemId, answer);
    } finally {
      setPending((p) => {
        const n = { ...p };
        delete n[it.itemId];
        return n;
      });
    }
  };

  const handleBatch = async () => {
    const ready = items
      .filter((it) => !isObjectiveQuestion(it.question) && it.gradingMode === 'AI_BATCH')
      .filter((it) => {
        const s = viewStates[it.itemId];
        return s && (s.status === 'DRAFT' || s.status === 'PENDING') && s.userAnswer.trim().length > 0 && !s.submitting;
      });
    if (ready.length === 0) {
      toast.info('没有可批量提交的主观题草稿');
      return;
    }
    const snapshot = new Map(ready.map((it) => [it.itemId, viewStates[it.itemId]!.userAnswer]));
    setPending((p) => {
      const n = { ...p };
      for (const it of ready) n[it.itemId] = snapshot.get(it.itemId)!;
      return n;
    });
    let batch;
    try {
      batch = await gradeBatch.mutateAsync(
        ready.map((it) => ({
          itemId: it.itemId, prompt: it.question.prompt, standardAnswer: it.question.correctAnswer,
          userSubmission: snapshot.get(it.itemId)!,
          testedSkillId: it.question.testedSkillId, language,
        })),
      );
    } catch (e) {
      toast.error('批量评测失败：' + (e as Error).message);
      setPending((p) => {
        const n = { ...p };
        for (const it of ready) delete n[it.itemId];
        return n;
      });
      return;
    }
    const failed: string[] = [];
    await Promise.all(
      batch.results.map(async (r: { itemId: string; grading: Record<string, unknown> }) => {
        try {
          await submitSubjective.mutateAsync({
            runId, itemId: r.itemId, userAnswer: snapshot.get(r.itemId)!, gradingResult: r.grading,
          });
          clearDraft(r.itemId);
        } catch {
          failed.push(r.itemId);
          setDraft(r.itemId, snapshot.get(r.itemId)!);
        } finally {
          setPending((p) => {
            const n = { ...p };
            delete n[r.itemId];
            return n;
          });
        }
      }),
    );
    if (failed.length > 0) toast.error(`批量提交部分失败（${failed.length} 题已保留草稿，可重试）`);
    else toast.success(`已批量提交 ${batch.results.length} 题，正确 ${batch.summary.correct} 题`);
  };

  const handleFinalize = async (onCompleted?: () => void) => {
    try {
      await finalizeRun.mutateAsync(runId);
      toast.success('练习已完成，学习进度已更新');
      onCompleted?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return {
    viewStates, doneCount, progress, allDone, canFinish, isSubmitting, hasBatchSubjects,
    isBatchSubmitting: gradeBatch.isPending || submitSubjective.isPending,
    itemBusy,
    setDraft, handleObjective, handleDraft, handleImmediate, handleBatch, handleFinalize,
    mutations: { submitObjective, saveDraft, gradeBatch, gradeSingle, submitSubjective, finalizeRun },
  };
}
