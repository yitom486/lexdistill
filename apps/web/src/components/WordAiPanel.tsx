import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { VocabularyEntry } from '@study-studio/protocol';
import { Button } from './ui/button.js';
import { useWordTutor } from '../hooks/useWordTutor.js';
import { WordChatConfig } from './WordChatConfig.js';
import { WordChatThread } from './WordChatThread.js';
import { QUERY_KEYS } from '../queries/query-keys.js';

/** 生成讲解固定指令：关键词确保本轮可见 context＋submit；任务绑定由后端强制。 */
function buildGeneratePrompt(word: VocabularyEntry): string {
  return `请为「${word.word}」（${word.reading || '无读音'}）生成AI讲解并保存讲解：先调用 vocabulary.learning.context 读取词汇依据与任务，再按要求生成讲解内容并调用 vocabulary.learning.submit 提交保存。`;
}

/** 单词内嵌 AI 面板：对话直接长在详情里；模型工具写入后由调用方刷新查询即时呈现。 */
export function WordAiPanel({ word }: { word: VocabularyEntry }) {
  const client = useQueryClient();
  const usage = [...new Set(word.sources.flatMap(source => [source.contextNote, source.usage].filter((text): text is string => !!text)))].join('；');
  const { messages, isTyping, connected, send, stop } = useWordTutor(
    { word: word.word, reading: word.reading, meaning: word.meaning, usage },
    { onComplete: () => { void client.invalidateQueries({ queryKey: QUERY_KEYS.VOCABULARY }); } },
  );
  const [draft, setDraft] = useState('');
  const submit = () => { if (send(draft)) setDraft(''); };
  const generate = () => { send(buildGeneratePrompt(word)); };
  const presets = [`「${word.word}」在日常生活中到底该怎么用？`, `这个词有哪些最常用的搭配？`, `它和相近词有什么区别？`];
  return <div className="mt-3 rounded-xl border border-line bg-paper-soft p-3" aria-label={`AI 追问：${word.word}`}>
    <WordChatConfig />
    <WordChatThread messages={messages} isTyping={isTyping} connected={connected}
      draft={draft} onDraftChange={setDraft} onSend={submit} onStop={stop}
      inputPlaceholder="继续追问这个词…"
      header={<>
        {!word.learning && messages.length === 0 && <div className="mb-2">
          <Button size="sm" variant="outline" disabled={!connected || isTyping} onClick={generate}>生成讲解</Button>
        </div>}
        {messages.length === 0 && <div className="mb-2 flex flex-wrap gap-1.5" aria-label="预设追问">
          {presets.map(preset => (
            <button key={preset} type="button" disabled={!connected || isTyping} onClick={() => send(preset)}
              className="rounded-xl border border-line bg-paper px-2.5 py-1.5 text-left text-xs text-ink hover:border-tone-amber-500o40 transition-colors disabled:opacity-50">
              {preset}
            </button>
          ))}
        </div>}
      </>} />
  </div>;
}
