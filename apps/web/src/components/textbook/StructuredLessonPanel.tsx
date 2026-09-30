import type { LessonContent, ContentDirectoryNode } from '@study-studio/document-model';
import { ContentSource } from './ContentSource.js';
import { DirectoryGroups } from './DirectoryGroups.js';
import { StructuredBody, type BodyActions } from './StructuredBody.js';
import { StructuredKnowledge } from './StructuredKnowledge.js';
interface Props extends BodyActions { content: LessonContent; tab: 'READER' | 'GRAMMAR'; directory?: readonly ContentDirectoryNode[] }
export function StructuredLessonPanel({ content, tab, directory, ...actions }: Props) {
  return <section className="space-y-4 text-ink" aria-label={tab === 'READER' ? '结构化教材正文' : '结构化知识点'}>
    {tab === 'READER' && content.preview && <aside className="space-y-2 rounded-xl border border-line bg-surface p-4"><h4 className="font-semibold">预习导学 <ContentSource source="AI" /></h4><p>{content.preview.canDoGoal}</p><ul className="list-disc pl-5">{content.preview.keyPoints.map((text, index) => <li key={index}>{text}</li>)}</ul>{content.preview.pitfalls.map((text, index) => <p key={index}>留意：{text}</p>)}</aside>}
    {tab === 'READER' ? <DirectoryGroups {...(directory ? { directory } : {})} items={content.blocks} render={blocks => <StructuredBody blocks={blocks} {...actions} />} /> :
      <DirectoryGroups {...(directory ? { directory } : {})} items={content.knowledgePoints} render={points => <StructuredKnowledge points={points} />} />}
    {tab === 'READER' && content.summary && <aside className="space-y-2 rounded-xl border border-line bg-surface p-4"><h4 className="font-semibold">课后总结 <ContentSource source="AI" /></h4>{content.summary.goldenSentences.map((text, index) => <p key={index}>{text}</p>)}<ul className="list-disc pl-5">{content.summary.selfCheckQuestions.map((text, index) => <li key={index}>{text}</li>)}</ul></aside>}
  </section>;
}
