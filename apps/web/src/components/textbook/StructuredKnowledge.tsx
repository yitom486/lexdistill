import type { LessonContent } from '@study-studio/document-model';
import { ContentSource } from './ContentSource.js';
import { ContentExamples } from './ContentExamples.js';

export function StructuredKnowledge({ points }: { points: LessonContent['knowledgePoints'] }) {
  return <>{points.map(point => <article key={point.id} data-content-id={point.id} className="space-y-3 rounded-xl border border-line bg-surface p-4">
    <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{point.title}</h4><ContentSource source={point.source} /></div>
    {point.connection && <div>{point.fieldSources?.connection && <ContentSource source={point.fieldSources.connection} field="接续" />}<p>{point.connection}</p></div>}
    {point.textbookExplanation && <div data-field="textbookExplanation"><ContentSource source="TEXTBOOK" field="讲解" /><p className="mt-1 whitespace-pre-wrap">{point.textbookExplanation}</p></div>}
    {point.aiExplanation && <div data-field="aiExplanation"><ContentSource source="AI" field="讲解" /><p className="mt-1 whitespace-pre-wrap">{point.aiExplanation}</p></div>}
    <ContentExamples examples={point.examples} />
  </article>)}</>;
}
