import { useState } from 'react';
import type { VocabularyEntry } from '@study-studio/protocol';
import { Button } from './ui/button.js';
import { MarkdownText } from './common/MarkdownText.js';
import { useWordTutor } from '../hooks/useWordTutor.js';

/** 单词内嵌 AI 面板：对话直接长在详情里；模型工具写入后由调用方刷新查询即时呈现。 */
export function WordAiPanel({ word }: { word: VocabularyEntry }) {
  const usage = [...new Set(word.sources.flatMap(source => [source.contextNote, source.usage].filter((text): text is string => !!text)))].join('；');
  const { messages, isTyping, connected, send, stop } = useWordTutor({ word: word.word, reading: word.reading, meaning: word.meaning, usage });
  const [draft, setDraft] = useState('');
  const submit = () => { if (send(draft)) setDraft(''); };
  return <div className="mt-3 rounded-xl border border-line bg-paper-soft p-3" aria-label={`AI 追问：${word.word}`}>
    <div className="space-y-2" aria-live="polite">
      {messages.length === 0 && <p className="text-xs text-ink-muted">在这里直接追问，回答实时显示；AI 调用工具更新内容后，下方释义自动刷新。</p>}
      {messages.map(message => <div key={message.id} className={message.sender === 'user' ? 'text-right' : ''}>
        <div className={`inline-block max-w-full rounded-lg px-3 py-2 text-left text-sm ${message.sender === 'user' ? 'bg-paper' : 'bg-paper'}`}>
          {message.sender === 'ai' ? <MarkdownText text={message.text || (message.isStreaming ? '思考中…' : '')} /> : message.text}
        </div>
        {!!message.toolCalls?.length && <p className="mt-0.5 text-xs text-ink-muted">调用工具：{message.toolCalls.map(tool => `${tool.toolName}${tool.done ? '✓' : '… '}`).join('、')}</p>}
      </div>)}
    </div>
    <div className="mt-2 flex gap-2">
      <input aria-label="追问输入" placeholder={connected ? '继续追问这个词…' : '网关未连接'} value={draft} disabled={!connected || isTyping}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') submit(); }}
        className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      {isTyping
        ? <Button size="sm" variant="outline" onClick={stop}>停止</Button>
        : <Button size="sm" onClick={submit} disabled={!connected || !draft.trim()}>发送</Button>}
    </div>
    {!connected && <p className="mt-1 text-xs text-ink-muted">网关未连接：先启动网关再追问。</p>}
  </div>;
}
