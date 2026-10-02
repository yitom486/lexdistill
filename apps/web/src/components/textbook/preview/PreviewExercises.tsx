import { useState } from 'react';
import type { TextbookLearningContent } from '@study-studio/document-model';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { exerciseNames, PreviewExercise } from './PreviewExercise.js';
import { ExerciseModelSettings } from './ExerciseModelSettings.js';
import type { ExerciseSnapshot } from '@study-studio/protocol';
import { ExerciseHistory } from './ExerciseHistory.js';

export function PreviewExercises({ exercises, scope, temporary = true }: { exercises: TextbookLearningContent['exercises']; scope?: Omit<ExerciseSnapshot, 'exercise'> | undefined; temporary?: boolean }) {
  const [filter, setFilter] = useState('ALL');
  const types = [...new Set(exercises.map(exercise => exercise.type))];
  return <section className="space-y-5" aria-label="本课练习题型">
    {scope && exercises.some(item => ['TRANSLATION','SHORT_ANSWER','WRITING'].includes(item.type)) && <ExerciseModelSettings />}
    {scope && !temporary && <ExerciseHistory documentId={scope.documentId} chapterId={scope.chapterId} />}
    <ToggleGroup aria-label="筛选练习题型" value={[filter]} onValueChange={(values: unknown[]) => {
      const next = values[0];
      if (typeof next === 'string') setFilter(next);
    }} className="flex-wrap">
      <ToggleGroupItem value="ALL">全部 {exercises.length}</ToggleGroupItem>
      {types.map(type => <ToggleGroupItem key={type} value={type}>{exerciseNames[type]} {exercises.filter(exercise => exercise.type === type).length}</ToggleGroupItem>)}
    </ToggleGroup>
    {exercises.map((exercise, index) => <div key={exercise.id} hidden={filter !== 'ALL' && filter !== exercise.type}>
      <PreviewExercise exercise={exercise} index={index} scope={scope} temporary={temporary} />
    </div>)}
  </section>;
}
