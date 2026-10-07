import { useCallback, useMemo, useState } from 'react';
import { Button } from './ui/button.js';
import { useWordTutor } from '../hooks/useWordTutor.js';
import { WordChatConfig } from './WordChatConfig.js';
import { WordChatThread } from './WordChatThread.js';

export interface WordTutorTarget {
  word: string;
  reading: string;
  meaning: string;
  usage: string;
}

interface WordTutorPanelProps {
  target: WordTutorTarget;
  generatePrompt: string;
  showGenerate: boolean;
  ariaLabel: string;
  inputPlaceholder: string;
  presets?: string[];
  onComplete?: () => void;
}

/** 单词 AI 会话容器（全局词/教材行共用）：target 按字段 memo，send 身份稳定；纯展示归 WordChatThread。 */
export function WordTutorPanel({
  target, generatePrompt, showGenerate, ariaLabel, inputPlaceholder, presets = [], onComplete,
}: WordTutorPanelProps) {
  const stableTarget = useMemo(
    () => ({ word: target.word, reading: target.reading, meaning: target.meaning, usage: target.usage }),
    [target.word, target.reading, target.meaning, target.usage],
  );
  const handleComplete = useCallback(() => { onComplete?.(); }, [onComplete]);
  const { messages, isTyping, connected, send, stop } = useWordTutor(stableTarget, { onComplete: handleComplete });
  const [draft, setDraft] = useState('');
  const submit = () => { if (send(draft)) setDraft(''); };
  const generate = () => { send(generatePrompt); };
  return <div className="mt-3 rounded-xl border border-line bg-paper-soft p-3" aria-label={ariaLabel}>
    <WordChatConfig />
    <WordChatThread messages={messages} isTyping={isTyping} connected={connected}
      draft={draft} onDraftChange={setDraft} onSend={submit} onStop={stop}
      inputPlaceholder={inputPlaceholder}
      header={<>
        {showGenerate && messages.length === 0 && <div className="mb-2">
          <Button size="sm" variant="outline" disabled={!connected || isTyping} onClick={generate}>生成讲解</Button>
        </div>}
        {presets.length > 0 && messages.length === 0 && <div className="mb-2 flex flex-wrap gap-1.5" aria-label="预设追问">
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
