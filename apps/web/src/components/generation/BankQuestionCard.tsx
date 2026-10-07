import { useEffect, useMemo, useState } from 'react';
import type { BankSubmissionRecord } from '@study-studio/protocol';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { BankAudioButton } from './BankAudioButton.js';
import { BankGradeButton } from './BankGradeButton.js';
import { useSubmissionIdentity } from './useSubmissionIdentity.js';
import type { GenerationStudentItem } from '../../queries/generation.js';
import { useSubmitBankObjectiveMutation, useSubmitBankSubjectiveMutation } from '../../queries/generation.js';

interface ObjectiveFeedback { isCorrect: boolean; correctAnswer: string; explanation: string }
interface SubjectiveFeedback { status: string }

/** 把已保存的排序答案切回分块索引（贪心最长匹配；失败回空，由用户重排）。 */
export function restoreOrderIndices(chunks: string[], saved: string): number[] {
  const used = new Array<boolean>(chunks.length).fill(false);
  const out: number[] = [];
  let text = saved;
  while (text.length > 0) {
    let matched = -1;
    for (let index = 0; index < chunks.length; index++) {
      if (used[index]) continue;
      const chunk = chunks[index]!;
      const best = matched < 0 ? '' : chunks[matched]!;
      if (text.startsWith(chunk) && chunk.length > best.length) matched = index;
    }
    if (matched < 0) return [];
    used[matched] = true;
    out.push(matched);
    text = text.slice(chunks[matched]!.length).trimStart();
  }
  return out.length === chunks.length ? out : [];
}

/** 索引序列拼回作答字符串（与后端归一口径一致：空格连接）。 */
export function joinOrderIndices(chunks: string[], order: number[]): string {
  return order.map(index => chunks[index] ?? '').join(' ');
}

/**
 * 单题卡：输入与判分状态以后端保留为准，本地只做受控输入。
 * 作答态隐藏答案作答，复盘态按后端资格展示完整快照。
 */
export function BankQuestionCard({ userId, taskId, paperId, item, reviewed, reviewQuestion, submissions, onSettled }: {
  userId: string; taskId: string; paperId: string; item: GenerationStudentItem;
  reviewed: boolean; reviewQuestion: Record<string, unknown> | null;
  submissions: BankSubmissionRecord[]; onSettled: () => void;
}) {
  const maskTextEnabled = usePreferencesStore(s => s.maskTextEnabled);
  const submitObjective = useSubmitBankObjectiveMutation(userId);
  const submitSubjective = useSubmitBankSubjectiveMutation(userId);
  const identity = useSubmissionIdentity(paperId, item.id, submissions);
  const stored = submissions.length > 0 ? submissions[submissions.length - 1]! : null;
  const storedAnswer = stored?.userAnswer ?? '';
  const [dirty, setDirty] = useState(false);
  const initialChoice = useMemo(() => {
    if (item.answer.type !== 'MULTIPLE_CHOICE') return null;
    const options = item.answer.options ?? [];
    return options.find(o => o.key === storedAnswer)?.key
      ?? options.find(o => o.text === storedAnswer)?.key ?? null;
  }, [item.answer, storedAnswer]);
  const [choice, setChoice] = useState<string | null>(initialChoice);
  const [text, setText] = useState(item.answer.type === 'REORDER' ? '' : storedAnswer);
  const [order, setOrder] = useState<number[]>(() =>
    item.answer.type === 'REORDER' && storedAnswer ? restoreOrderIndices(item.answer.chunks ?? [], storedAnswer) : []);
  // 后端保留晚于首渲染到达时同步输入；用户一旦编辑则以本地为准，不再覆盖。
  useEffect(() => {
    if (dirty) return;
    if (item.answer.type === 'MULTIPLE_CHOICE') {
      const options = item.answer.options ?? [];
      setChoice(options.find(o => o.key === storedAnswer)?.key
        ?? options.find(o => o.text === storedAnswer)?.key ?? null);
    } else if (item.answer.type === 'REORDER') {
      setOrder(storedAnswer ? restoreOrderIndices(item.answer.chunks ?? [], storedAnswer) : []);
    } else {
      setText(storedAnswer);
    }
  }, [storedAnswer, dirty, item.answer]);
  const [objective, setObjective] = useState<ObjectiveFeedback | null>(null);
  const [subjective, setSubjective] = useState<SubjectiveFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = submitObjective.isPending || submitSubjective.isPending;
  const answerType = item.answer.type;
  const isObjective = answerType === 'MULTIPLE_CHOICE' || answerType === 'FILL_BLANK' || answerType === 'REORDER';
  const chunks = useMemo(() => (item.answer.chunks ?? []).filter(c => c.trim()), [item.answer]);

  const submit = async () => {
    setError(null);
    const userAnswer = answerType === 'MULTIPLE_CHOICE' ? choice ?? '' : answerType === 'REORDER' ? joinOrderIndices(chunks, order) : text;
    if (!userAnswer.trim()) { setError('请先作答再提交。'); return; }
    const id = identity.identify(userAnswer);
    try {
      const base = { taskId, paperId, questionId: item.id, submissionId: id.submissionId, userAnswer, timeSpentMs: id.timeSpentMs };
      if (isObjective) {
        const result = await submitObjective.mutateAsync(base);
        setObjective({ isCorrect: result.isCorrect, correctAnswer: result.correctAnswer, explanation: result.explanation });
      } else {
        const result = await submitSubjective.mutateAsync(base);
        setSubjective({ status: result.status });
      }
      onSettled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败');
    }
  };

  const review = reviewed ? reviewQuestion : null;
  const material = item.material;
  const reviewMaterial = (review?.['material'] ?? null) as { type?: string; turns?: Array<{ speaker: string; text: string }> } | null;
  const transcriptTurns = !maskTextEnabled
    ? (reviewed && reviewMaterial?.type === 'LISTENING' && Array.isArray(reviewMaterial.turns)
      ? reviewMaterial.turns
      : material?.type === 'LISTENING' && material.withTranscript && 'turns' in material ? (material.turns ?? null) : null)
    : null;
  const storedObjectiveSubmission = stored && (item.answer.type === 'MULTIPLE_CHOICE' || item.answer.type === 'FILL_BLANK' || item.answer.type === 'REORDER')
    ? stored : null;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-label={`题目 ${item.prompt.slice(0, 12)}`}>
      <p className="text-sm leading-6 text-ink">{item.prompt}</p>
      {material?.type === 'READING' && (
        <div className="rounded-lg border border-line bg-surface p-3 text-sm leading-6 text-ink">
          <p className="text-xs font-semibold text-ink-muted">{material.title}</p>
          <p>{material.text}</p>
        </div>
      )}
      {material?.type === 'LISTENING' && item.materialId && (
        <BankAudioButton userId={userId} taskId={taskId} materialId={item.materialId} language={item.language} turns={transcriptTurns} />
      )}
      {answerType === 'MULTIPLE_CHOICE' && !reviewed && (
        <div className="flex flex-wrap gap-2">
          {(item.answer.options ?? []).map(option => (
            <Button key={option.key} variant={choice === option.key ? 'default' : 'outline'}
              onClick={() => { setDirty(true); setChoice(option.key); }} disabled={busy} aria-label={`选项 ${option.key}`}>{option.text}</Button>
          ))}
        </div>
      )}
      {answerType === 'FILL_BLANK' && !reviewed && (
        <input aria-label="填空答案" value={text} onChange={event => { setDirty(true); setText(event.target.value); }} disabled={busy}
          className="block w-full rounded-lg border border-line bg-surface p-2 text-ink" />
      )}
      {answerType === 'REORDER' && !reviewed && (
        <div className="space-y-2">
          <div className="flex min-h-10 flex-wrap gap-2 rounded-lg border border-line p-2" aria-label="已选顺序">
            {order.map((chunkIndex, position) => <span key={position} className="rounded-md bg-line px-2 py-1 text-xs text-ink">{chunks[chunkIndex]}</span>)}
          </div>
          <div className="flex flex-wrap gap-2">
            {chunks.map((chunk, chunkIndex) => order.includes(chunkIndex) ? null : (
              <Button key={chunkIndex} variant="outline" onClick={() => { setDirty(true); setOrder(o => [...o, chunkIndex]); }} disabled={busy}>{chunk}</Button>
            ))}
            <Button variant="outline" onClick={() => { setDirty(true); setOrder([]); }} disabled={busy} aria-label="清空顺序">清空</Button>
          </div>
        </div>
      )}
      {(answerType === 'SHORT_ANSWER' || answerType === 'TRANSLATION' || answerType === 'WRITING') && !reviewed && (
        <Textarea aria-label="主观作答" value={text} onChange={event => { setDirty(true); setText(event.target.value); }} disabled={busy} />
      )}
      {!reviewed && (
        <Button onClick={() => void submit()} disabled={busy} aria-label="提交本题答案">提交</Button>
      )}
      {error && <p role="alert" className="text-xs text-ink-rose-600">{error}</p>}
      {objective && (
        <p role="status" className="text-xs leading-5 text-ink">
          {objective.isCorrect ? '回答正确。' : '回答有误。'}标准答案：{objective.correctAnswer}。{objective.explanation}
        </p>
      )}
      {!objective && storedObjectiveSubmission && (
        <p role="status" className="text-xs leading-5 text-ink">
          {storedObjectiveSubmission.isCorrect ? '已作答：回答正确。' : '已作答：回答有误。'}详情请查看复盘。
        </p>
      )}
      {subjective && (
        <p role="status" className="text-xs leading-5 text-ink">
          {subjective.status === 'GRADED' ? '判对，已记入学习记录。' : '已保留为待批改：未精确命中参考答案，不记错、等待 AI 批改。'}
        </p>
      )}
      {!subjective && stored && !isObjective && stored.status === 'SUBMITTED' && (
        <p role="status" className="text-xs leading-5 text-ink">
          已保留为待批改：未精确命中参考答案，不记错、等待 AI 批改。
        </p>
      )}
      {stored && !isObjective && (
        <BankGradeButton userId={userId} taskId={taskId} paperId={paperId} submission={stored} onSettled={onSettled} />
      )}
      {review && <ReviewDetail detail={review} />}
    </div>
  );
}

function ReviewDetail({ detail }: { detail: Record<string, unknown> }) {
  const answer = detail['answer'] as Record<string, unknown> | undefined;
  const material = detail['material'] as Record<string, unknown> | null | undefined;
  return (
    <div className="space-y-1 rounded-lg border border-line p-3 text-xs leading-5 text-ink">
      <p>答案：{JSON.stringify(answer)}</p>
      <p>讲解：{String(detail['explanation'] ?? '')}</p>
      {material && material['type'] === 'READING' && <p>原文：{String(material['text'] ?? '')}</p>}
    </div>
  );
}
