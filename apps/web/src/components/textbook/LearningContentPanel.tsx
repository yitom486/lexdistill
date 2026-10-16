import type { TextbookLearningContent } from '@lexdistill/document-model';
import { ContentSource } from './ContentSource.js';

export function LearningContentPanel({ content, section = 'ALL', showTranslation = true }: {
  content: TextbookLearningContent; section?: 'ALL' | 'GRAMMAR' | 'VOCABULARY'; showTranslation?: boolean;
}) {
  const examples = (items: { text: string; translation?: string | undefined }[]) => <ul className="space-y-2">{items.map((item, i) => <li key={i}><p>{item.text}</p>{showTranslation && item.translation && <p className="text-ink-muted">{item.translation}</p>}</li>)}</ul>;
  return <div className="space-y-6" data-testid="learning-content">
    {section !== 'GRAMMAR' && !!content.vocabulary.length && <section aria-label="词汇"><h3 className="mb-3 font-semibold">词汇</h3><ul className="space-y-3">{content.vocabulary.map(word => <li key={word.id} className="rounded-xl border border-line p-4">
      <strong>{word.word}</strong>{word.reading && <span className="ml-2">{word.reading}</span>}{word.level && <span className="ml-2 text-ink-muted">{word.level} · 模型估计</span>}
      <p>{word.meaning}</p>{word.explanation && <p>{word.explanation}</p>}{examples(word.examples)}
    </li>)}</ul></section>}
    {section !== 'VOCABULARY' && !!content.grammar.length && <section aria-label="知识点"><h3 className="mb-3 font-semibold">知识点</h3><ul className="space-y-3">{content.grammar.map(point => <li key={point.id} className="rounded-xl border border-line p-4">
      <strong>{point.title}</strong><ContentSource source={point.source} />{point.connection && <p>{point.connection}</p>}
      <p className="whitespace-pre-wrap">{point.explanation}</p>{point.aiExplanation && <div className="mt-2"><span className="text-ink-muted">AI 补充讲解</span><p>{point.aiExplanation}</p></div>}{examples(point.examples)}
    </li>)}</ul></section>}
    {section === 'ALL' && !!content.articles.length && <section aria-label="文章"><h3 className="mb-3 font-semibold">文章</h3>{content.articles.map(article => <article key={article.id} className="mb-3 rounded-xl border border-line p-4">
      {article.title && <h4>{article.title}</h4>}<p className="whitespace-pre-wrap">{article.text}</p>{showTranslation && article.translation && <p className="mt-2 whitespace-pre-wrap text-ink-muted">{article.translation}</p>}
    </article>)}</section>}
    {section === 'ALL' && !!content.sentences.length && <section aria-label="句子"><h3 className="mb-3 font-semibold">句子</h3><ul className="space-y-3">{content.sentences.map(sentence => <li key={sentence.id} className="rounded-xl border border-line p-4">
      {sentence.speaker && <strong>{sentence.speaker}：</strong>}<span>{sentence.text}</span>{showTranslation && sentence.translation && <p className="text-ink-muted">{sentence.translation}</p>}{sentence.explanation && <p>{sentence.explanation}</p>}
    </li>)}</ul></section>}
    {section === 'ALL' && !!content.exercises.length && <section aria-label="练习"><h3 className="mb-3 font-semibold">练习</h3>{content.exercises.map(exercise => <article key={exercise.id} className="mb-3 rounded-xl border border-line p-4">
      <p>{exercise.prompt}</p>{exercise.options && <ol className="list-decimal pl-5">{exercise.options.map((option, i) => <li key={i}>{option}</li>)}</ol>}
      <details className="mt-3"><summary className="cursor-pointer">查看参考答案与解析</summary><p>{typeof exercise.answer === 'string' ? exercise.answer : exercise.answer?.map(item => typeof item === 'string' ? item : `${item.left} ↔ ${item.right}`).join(exercise.type === 'ORDERING' ? ' → ' : '；')}</p>{exercise.explanation && <p>{exercise.explanation}</p>}</details>
    </article>)}</section>}
  </div>;
}
