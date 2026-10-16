import type { LessonContent } from '@lexdistill/document-model';
import { ContentSource } from './ContentSource.js';
export function ContentExamples({ examples }: { examples: LessonContent['knowledgePoints'][number]['examples'] }) {
  return <div className="space-y-2">{examples.map(example => <div key={example.id} className="space-y-1 border-l border-line pl-3">
    <ContentSource source={example.source} field="例句" /><p>{example.text}</p>
    {example.translation && <div className="text-ink-muted">{example.fieldSources?.translation && <ContentSource source={example.fieldSources.translation} field="译文" />}<p>{example.translation}</p></div>}
  </div>)}</div>;
}
