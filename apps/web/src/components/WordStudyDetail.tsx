import { useMemo, useState } from 'react';
import type { VocabularyEntry } from '@study-studio/protocol';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { WordAiPanel } from './WordAiPanel.js';

/** 单词学习详情（纯展示，不挂任何教材来源）：读音词性头、意思、用法、例句，AI 追问内嵌。 */
export function WordStudyDetail({ word }: { word: VocabularyEntry }) {
  const [aiOpen, setAiOpen] = useState(false);
  const meanings = useMemo(() => [...new Set([word.meaning, ...word.sources.map(source => source.meaning)].filter(Boolean))], [word]);
  const usages = useMemo(() => [...new Set(word.sources.flatMap(source => [source.contextNote, source.usage].filter((text): text is string => !!text)))], [word]);
  const examples = useMemo(() => {
    const seen = new Set<string>();
    return word.sources.flatMap(source => source.examples).filter(example => {
      const key = `${example.text}‖${example.translation ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }, [word]);
  const pos = word.sources.map(source => source.partOfSpeech).find(Boolean);
  return <div className="mt-3 rounded-xl border border-line bg-paper p-4" aria-label={`单词学习：${word.word}`}>
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <strong className="text-xl">{word.word}</strong>
      {word.reading && <span className="text-sm text-ink-muted">{word.reading}</span>}
      {word.level && <Badge variant="outline">{word.level}</Badge>}
      {pos && <Badge variant="secondary">{pos}</Badge>}
    </div>
    <dl className="mt-3 space-y-3">
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">意思</dt>
        <dd className="mt-1 text-sm leading-relaxed">{meanings.join('；')}</dd>
      </div>
      {usages.length > 0 && <div className="border-t border-line pt-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">用法</dt>
        <dd className="mt-1 space-y-1 text-sm leading-relaxed">{usages.map((usage, index) => <p key={index}>{usage}</p>)}</dd>
      </div>}
      {examples.length > 0 && <div className="border-t border-line pt-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">例句</dt>
        <dd className="mt-1 space-y-2">{examples.map((example, index) => <figure key={index} className="rounded-lg bg-paper-soft px-3 py-2 text-sm">
          <blockquote>{example.text}</blockquote>
          {example.translation && <figcaption className="mt-0.5 text-ink-muted">{example.translation}</figcaption>}
        </figure>)}</dd>
      </div>}
      {word.learning && <div className="border-t border-line pt-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">AI 讲解</dt>
        <dd className="mt-1 space-y-2 text-sm leading-relaxed">
          {word.learning.explanation && <p>{word.learning.explanation}</p>}
          {word.learning.scenarios?.map(scenario => <div key={scenario.title} className="rounded-lg bg-paper-soft px-3 py-2">
            <p className="font-semibold">{scenario.title}</p>
            {scenario.dialogue.map((line, index) => <p key={index} className="mt-1"><span className="text-ink-muted">{line.speaker}：</span>{line.text}{line.translation && <span className="block text-ink-muted">{line.translation}</span>}</p>)}
            {scenario.note && <p className="mt-1 text-ink-muted">{scenario.note}</p>}
          </div>)}
          {!!word.learning.pitfalls?.length && <ul className="list-disc space-y-0.5 pl-5">{word.learning.pitfalls.map((pitfall, index) => <li key={index}>{pitfall}</li>)}</ul>}
          {word.learning.quiz && <div className="rounded-lg border border-line px-3 py-2">
            <p className="font-semibold">小测：{word.learning.quiz.prompt}</p>
            <p className="mt-1">参考：{word.learning.quiz.answer}</p>
            {word.learning.quiz.explanation && <p className="mt-0.5 text-ink-muted">{word.learning.quiz.explanation}</p>}
          </div>}
        </dd>
      </div>}
    </dl>
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <Button size="sm" onClick={() => setAiOpen(open => !open)} aria-expanded={aiOpen}>{aiOpen ? '收起追问' : '问 AI'}</Button>
      <Button size="sm" variant="outline" disabled title="AI 讲解下一阶段上线">AI 讲解</Button>
      {!usages.length && !examples.length && <span className="text-xs text-ink-muted">暂无用法与例句，新导入的教材会自动补充。</span>}
    </div>
    {aiOpen && <WordAiPanel word={word} />}
  </div>;
}
