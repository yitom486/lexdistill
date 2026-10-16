import type { LessonContent } from '@lexdistill/document-model';
import { ContentExamples } from './ContentExamples.js';
import { ContentSource } from './ContentSource.js';

export function VocabularyExplanation({ word }: { word: LessonContent['vocabularies'][number] }) {
  return <div className="space-y-2">
    {word.aiExplanation && <aside className="space-y-1 rounded-lg border border-line bg-surface p-3"><ContentSource source="AI" field="生词讲解" /><p className="whitespace-pre-wrap">{word.aiExplanation}</p></aside>}
    <ContentExamples examples={word.examples} />
  </div>;
}
