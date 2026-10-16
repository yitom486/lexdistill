import { useState } from 'react';
import type { ExerciseAnswer, TextbookExerciseAttempt, TextbookGrowth } from '@lexdistill/protocol';
import { haveSameGradingBasis } from '@lexdistill/learner-core';
import { ChevronDown, History } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { useTextbookGrowth } from '../../../queries/textbook-practice.js';
import { exerciseNames } from './PreviewExercise.js';

const answerText = (answer: ExerciseAnswer) => typeof answer === 'string' ? answer : answer.map(value => typeof value === 'string' ? value : `${value.left} → ${value.right}`).join('；');
function GrowthGroups({ summary }: { summary: TextbookGrowth }) {
  return <div className="space-y-3">
    <p className="text-sm">独立练习 {summary.independentAttempts} 次 · 修改后作答 {summary.revisionAttempts} 次 · 未评分 {summary.ungradedAttempts} 次</p>
    <p className="text-xs leading-6 text-ink-muted">按相同题型、难度、模型和评分版本分别统计。修改后的提高不能直接说明新题也已掌握；没有分数的作答不参与均分。满分率不代表合格率。</p>
    {summary.groups.map((group, i) => <div key={i} className="rounded-xl border border-line-soft p-3 text-sm">
      <p>{exerciseNames[group.type]} · {group.difficultyTier === null ? '难度未知' : `难度 ${group.difficultyTier}/5`} · {group.submissionKind === 'REVISION' ? '修改后作答' : '独立练习'} · {group.model ?? '自动判题'}</p>
      <p className="mt-1 text-ink-muted">有效样本 {group.samples} · 均分 {group.averageScore.toFixed(1)}/100 · 满分率 {(group.fullMarkRate * 100).toFixed(0)}%{group.averageTimeSpentMs !== null ? ` · 平均作答交互耗时 ${(group.averageTimeSpentMs / 1000).toFixed(1)} 秒` : ' · 耗时未记录'}</p>
      <details className="mt-2"><summary className="cursor-pointer text-xs text-accent-ink">按日期查看</summary>
        <ul className="mt-2 space-y-1 text-xs text-ink-muted">{group.timeline.map(day => <li key={day.date}>{day.date} · {day.samples} 次 · 均分 {day.averageScore.toFixed(1)}/100</li>)}</ul>
        <p className="mt-2 text-xs text-ink-muted">评分版本：{group.rubricVersion}</p>
      </details>
    </div>)}
  </div>;
}
function AttemptCard({ attempt, previous }: { attempt: TextbookExerciseAttempt; previous?: TextbookExerciseAttempt | undefined }) {
  const comparable = previous && haveSameGradingBasis(previous, attempt);
  return <details className="rounded-xl border border-line-soft p-4">
    <summary className="cursor-pointer text-sm"><Badge variant="outline">{attempt.submissionKind === 'REVISION' ? '修改' : '独立'}</Badge> 第 {attempt.attemptNo} 次 · {exerciseNames[attempt.snapshot.exercise.type]} · {attempt.grading ? `${attempt.grading.score}/100` : '未评分'} · {new Date(attempt.submittedAt).toLocaleString()}</summary>
    <div className="mt-3 space-y-3 text-sm leading-7">
      <p className="whitespace-pre-wrap font-medium">{attempt.snapshot.exercise.prompt}</p>
      <p className="whitespace-pre-wrap">你的作答：{answerText(attempt.answer)}</p>
      {previous && <div className="rounded-lg border border-line-soft p-3">
        <p>上一次作答：{answerText(previous.answer)}</p>
        <p>{previous.grading && attempt.grading ? `${previous.grading.score} → ${attempt.grading.score} 分${comparable ? '（相同评分基准）' : '（评分基准不同，分别参考）'}` : '上一份或本份作答未评分'}</p>
        {previous.grading && <p className="text-ink-muted">上次反馈：{previous.grading.feedback}</p>}
      </div>}
      {attempt.grading ? <>
        <p>本次反馈：{attempt.grading.feedback}</p>
        {!!attempt.grading.suggestions.length && <ul className="list-disc pl-5">{attempt.grading.suggestions.map((suggestion, i) => <li key={i}>{suggestion}</li>)}</ul>}
        {attempt.grading.revisedAnswer && <p className="whitespace-pre-wrap">参考改写：{attempt.grading.revisedAnswer}</p>}
      </> : <p className="text-ink-muted">答案保留，尚无有效评分，不计为零分。</p>}
      <p className="text-xs text-ink-muted">{attempt.model ?? '未使用模型'} · {attempt.rubricVersion} · {attempt.snapshot.exercise.difficultyReason ?? '难度依据未记录'}</p>
    </div>
  </details>;
}
export function ExerciseHistory({ documentId, chapterId }: { documentId: string; chapterId: string }) {
  const [open, setOpen] = useState(false);
  const query = useTextbookGrowth(documentId, chapterId, open);
  const previous = new Map(query.data?.history.map(attempt => [attempt.id, attempt]));
  return <Collapsible open={open} onOpenChange={setOpen} className="rounded-2xl border border-line-soft bg-paper-soft p-4">
    <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium"><History className="h-4 w-4" />作答历史与成长<ChevronDown className="ml-auto h-4 w-4" /></CollapsibleTrigger>
    <CollapsibleContent className="mt-4 space-y-4">
      {query.isPending && <p role="status" className="text-sm text-ink-muted">正在读取已保存的作答…</p>}
      {query.isError && <div role="alert" className="space-y-2 text-sm text-ink-muted"><p>作答历史读取失败，请重试。</p><Button variant="outline" onClick={() => void query.refetch()}>重新读取</Button></div>}
      {query.data && <>
        <GrowthGroups summary={query.data.summary} />
        {!query.data.history.length && <p className="text-sm text-ink-muted">本章尚无正式提交记录。</p>}
        {query.data.history.map(attempt => <AttemptCard key={attempt.id} attempt={attempt} previous={attempt.previousAttemptId ? previous.get(attempt.previousAttemptId) : undefined} />)}
      </>}
    </CollapsibleContent>
  </Collapsible>;
}
