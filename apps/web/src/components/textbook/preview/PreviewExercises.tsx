import { useState } from 'react';
import type { TextbookLearningContent } from '@study-studio/document-model';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { exerciseNames, PreviewExercise } from './PreviewExercise.js';

export function PreviewExercises({ exercises }: { exercises: TextbookLearningContent['exercises'] }) {
  const [filter, setFilter] = useState('ALL');
  const types = [...new Set(exercises.map(exercise => exercise.type))];
  return <section className="space-y-5" aria-label="本课练习题型">
    <ToggleGroup aria-label="筛选练习题型" value={[filter]} onValueChange={(values: unknown[]) => {
      const next = values[0];
      if (typeof next === 'string') setFilter(next);
    }} className="flex-wrap">
      <ToggleGroupItem value="ALL">全部 {exercises.length}</ToggleGroupItem>
      {types.map(type => <ToggleGroupItem key={type} value={type}>{exerciseNames[type]} {exercises.filter(exercise => exercise.type === type).length}</ToggleGroupItem>)}
    </ToggleGroup>
    {exercises.map((exercise, index) => <div key={exercise.id} hidden={filter !== 'ALL' && filter !== exercise.type}>
      <PreviewExercise exercise={exercise} index={index} />
    </div>)}
  </section>;
}
