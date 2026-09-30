import type { LessonContent } from '@study-studio/document-model';
import { ContentSource } from './ContentSource.js';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import { Button } from '../ui/button.js';

export interface BodyActions {
  language?: 'JA' | 'EN' | 'KO'; showTranslation?: boolean;
  onAskAiTutor?: (text: string) => void; onCollectSentence?: (text: string, translation: string) => void;
}
export function StructuredBody({ blocks, language, showTranslation = true, onAskAiTutor, onCollectSentence }: BodyActions & { blocks: LessonContent['blocks'] }) {
  return <>{(['TEXTBOOK', 'AI'] as const).map(source => {
    const selected = blocks.filter(block => block.source === source);
    return !!selected.length && <div key={source} className="space-y-3"><h4 className="flex items-center gap-2 text-sm font-medium">课文 <ContentSource source={source} /></h4>
      {selected.map(block => <article key={block.id} className="space-y-2 rounded-xl border border-line bg-surface p-4" data-content-kind={block.kind} data-content-id={block.id}>
        {block.kind === 'DIALOGUE' && <strong>{block.speaker}</strong>}
        <p className="whitespace-pre-wrap leading-relaxed">{block.text}</p>
        {(language || onAskAiTutor || onCollectSentence) && <div className="flex flex-wrap items-center gap-2">
          {language && <UnifiedTtsPlayer variant="inline" text={block.text} lang={language} />}
          {onAskAiTutor && <Button variant="outline" size="sm" onClick={() => onAskAiTutor(block.text)}>讲透</Button>}
          {onCollectSentence && <Button variant="outline" size="sm" onClick={() => onCollectSentence(block.text, block.translation ?? '')}>收句子</Button>}
        </div>}
        {showTranslation && block.translation && <div className="space-y-1 text-ink-muted">{block.fieldSources?.translation && <ContentSource source={block.fieldSources.translation} field="译文" />}<p>{block.translation}</p></div>}
      </article>)}
    </div>;
  })}</>;
}
