import type { ReactNode } from 'react';
import { Button } from './ui/button.js';
import { MarkdownText } from './common/MarkdownText.js';
import type { WordTutorMessage } from '../hooks/useWordTutor.js';

interface WordChatThreadProps {
  messages: WordTutorMessage[];
  isTyping: boolean;
  connected: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  inputPlaceholder: string;
  inputAriaLabel?: string;
  header?: ReactNode;
}

/** 单词 AI 会话纯展示线程（消息流＋追问输入）：全局词与教材行共用，逻辑归各面板。 */
export function WordChatThread({
  messages, isTyping, connected, draft, onDraftChange, onSend, onStop,
  inputPlaceholder, inputAriaLabel = '追问输入', header,
}: WordChatThreadProps) {
  return <div>
    {header}
    <div className="space-y-2" aria-live="polite">
      {messages.length === 0 && <p className="text-xs text-ink-muted">在这里直接追问，回答实时显示；AI 调用工具更新内容后，释义自动刷新。</p>}
      {messages.map(message => <div key={message.id} className={message.sender === 'user' ? 'text-right' : ''}>
        <div className="inline-block max-w-full rounded-lg bg-paper px-3 py-2 text-left text-sm">
          {message.sender === 'ai' ? <MarkdownText text={message.text || (message.isStreaming ? '思考中…' : '')} /> : message.text}
        </div>
        {!!message.toolCalls?.length && <p className="mt-0.5 text-xs text-ink-muted">调用工具：{message.toolCalls.map(tool => `${tool.toolName}${tool.done ? '✓' : '… '}`).join('、')}</p>}
      </div>)}
    </div>
    <div className="mt-2 flex gap-2">
      <input aria-label={inputAriaLabel} placeholder={connected ? inputPlaceholder : '网关未连接'} value={draft} disabled={!connected || isTyping}
        onChange={event => onDraftChange(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') onSend(); }}
        className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      {isTyping
        ? <Button size="sm" variant="outline" onClick={onStop}>停止</Button>
        : <Button size="sm" onClick={onSend} disabled={!connected || !draft.trim()}>发送</Button>}
    </div>
    {!connected && <p className="mt-1 text-xs text-ink-muted">网关未连接：先启动网关再追问。</p>}
  </div>;
}
