import { useState } from 'react';
import type { StructuredExercise, ContentDirectoryNode } from '@study-studio/document-model';
import { DirectoryGroups } from './DirectoryGroups.js';
import { Button } from '../ui/button.js';
import { ContentSource } from './ContentSource.js';
const typeLabels = { CHOICE: '单选', MULTI_CHOICE: '多选', FILL_BLANK: '填空', TRANSLATION: '翻译', ORDERING: '排序', MATCHING: '匹配', SHORT_ANSWER: '简答' };
function referenceAnswer(exercise: StructuredExercise): string {
  if (exercise.answer.text) return exercise.answer.text;
  if (exercise.answer.optionIds) return exercise.answer.optionIds.map(id => exercise.options?.find(option => option.id === id)?.text ?? '').join(exercise.type === 'ORDERING' ? ' → ' : '、');
  return (exercise.answer.pairs ?? []).map(pair => `${exercise.left?.find(item => item.id === pair.leftId)?.text ?? ''} ↔ ${exercise.right?.find(item => item.id === pair.rightId)?.text ?? ''}`).join('\n');
}
function ExerciseCard({ exercise }: { exercise: StructuredExercise }) {
  const [visible, setVisible] = useState(false);
  return <article className="space-y-3 rounded-xl border border-line bg-surface p-4 text-ink" aria-label={`${typeLabels[exercise.type]}练习`}>
    <div className="flex flex-wrap gap-2"><strong>{typeLabels[exercise.type]}</strong><ContentSource source={exercise.source} field="题干" /></div>
    <p className="whitespace-pre-wrap">{exercise.prompt}</p>
    {exercise.options && <ol className="list-decimal space-y-1 pl-5">{exercise.options.map(option => <li key={option.id}>{option.text}</li>)}</ol>}
    {exercise.type === 'MATCHING' && <div className="grid grid-cols-2 gap-4"><ul aria-label="匹配左侧">{exercise.left?.map(item => <li key={item.id}>{item.text}</li>)}</ul><ul aria-label="匹配右侧">{exercise.right?.map(item => <li key={item.id}>{item.text}</li>)}</ul></div>}
    <Button variant="outline" onClick={() => setVisible(!visible)} aria-expanded={visible}>{visible ? '收起参考答案' : '查看参考答案'}</Button>
    {visible && <div className="space-y-2 border-t border-line pt-3">
      {exercise.fieldSources?.answer && <ContentSource source={exercise.fieldSources.answer} field="答案" />}<p className="whitespace-pre-wrap">{referenceAnswer(exercise)}</p>
      {exercise.explanation && <div>{exercise.fieldSources?.explanation && <ContentSource source={exercise.fieldSources.explanation} field="解析" />}<p className="mt-1 whitespace-pre-wrap">{exercise.explanation}</p></div>}
    </div>}
  </article>;
}
export function StructuredExerciseList({ exercises, directory }: { exercises: StructuredExercise[]; directory?: readonly ContentDirectoryNode[] }) {
  return <section className="space-y-4" aria-label="教材练习">{exercises.length ? <DirectoryGroups {...(directory ? { directory } : {})} items={exercises} render={items => <div className="space-y-3">{items.map(exercise => <ExerciseCard key={exercise.id} exercise={exercise} />)}</div>} /> : <p className="text-ink-muted">当前部分没有已保存的练习。</p>}</section>;
}
