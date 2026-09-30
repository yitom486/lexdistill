import type { LessonContent } from '@study-studio/document-model';
import { ContentSource } from './ContentSource.js';
import { ContentExamples } from './ContentExamples.js';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import { Button } from '../ui/button.js';
interface Props {
  content: LessonContent; tab: 'READER' | 'GRAMMAR'; language?: 'JA' | 'EN' | 'KO'; showTranslation?: boolean;
  onAskAiTutor?: (text: string) => void; onCollectSentence?: (text: string, translation: string) => void;
}
export function StructuredLessonPanel({ content, tab, language, showTranslation = true, onAskAiTutor, onCollectSentence }: Props) {
  return <section className="space-y-4 text-ink" aria-label={tab === 'READER' ? '结构化教材正文' : '结构化知识点'}>
    {tab === 'READER' && content.preview && <aside className="space-y-2 rounded-xl border border-line bg-surface p-4"><h4 className="font-semibold">预习导学 <ContentSource source="AI" /></h4><p>{content.preview.canDoGoal}</p><ul className="list-disc pl-5">{content.preview.keyPoints.map((text, index) => <li key={index}>{text}</li>)}</ul>{content.preview.pitfalls.map((text, index) => <p key={index}>留意：{text}</p>)}</aside>}
    {tab === 'READER' ? content.blocks.map(block => (
      <article key={block.id} className="space-y-2 rounded-xl border border-line bg-surface p-4" data-content-kind={block.kind}>
        <div className="flex flex-wrap items-center gap-2"><ContentSource source={block.source} />{block.kind === 'DIALOGUE' && <strong>{block.speaker}</strong>}</div>
        <p className="whitespace-pre-wrap leading-relaxed">{block.text}</p>
        {(language || onAskAiTutor || onCollectSentence) && <div className="flex flex-wrap items-center gap-2">
          {language && <UnifiedTtsPlayer variant="inline" text={block.text} lang={language} />}
          {onAskAiTutor && <Button variant="outline" size="sm" onClick={() => onAskAiTutor(block.text)}>讲透</Button>}
          {onCollectSentence && <Button variant="outline" size="sm" onClick={() => onCollectSentence(block.text, block.translation ?? '')}>收句子</Button>}
        </div>}
        {showTranslation && block.translation && <div className="space-y-1 text-ink-muted">{block.fieldSources?.translation && <ContentSource source={block.fieldSources.translation} field="译文" />}<p>{block.translation}</p></div>}
      </article>
    )) : content.knowledgePoints.map(point => (
      <article key={point.id} className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{point.title}</h4><ContentSource source={point.source} /></div>
        {point.connection && <div>{point.fieldSources?.connection && <ContentSource source={point.fieldSources.connection} field="接续" />}<p>{point.connection}</p></div>}
        {point.textbookExplanation && <div><ContentSource source="TEXTBOOK" field="讲解" /><p className="mt-1 whitespace-pre-wrap">{point.textbookExplanation}</p></div>}
        {point.aiExplanation && <div><ContentSource source="AI" field="讲解" /><p className="mt-1 whitespace-pre-wrap">{point.aiExplanation}</p></div>}
        <ContentExamples examples={point.examples} />
      </article>
    ))}
    {tab === 'READER' && content.summary && <aside className="space-y-2 rounded-xl border border-line bg-surface p-4"><h4 className="font-semibold">课后总结 <ContentSource source="AI" /></h4>{content.summary.goldenSentences.map((text, index) => <p key={index}>{text}</p>)}<ul className="list-disc pl-5">{content.summary.selfCheckQuestions.map((text, index) => <li key={index}>{text}</li>)}</ul></aside>}
  </section>;
}
