import { Pause, Play } from 'lucide-react';
import { Button } from '../ui/button.js';
import { useListeningPlayback } from '../../hooks/useListeningPlayback.js';
import { trackToSpeechLang } from '../../config/speech-language.js';
import type { GeneratedQuestion } from '@study-studio/protocol';

interface Props {
  question: GeneratedQuestion;
  language: 'en' | 'ja' | 'ko';
  answer: string;
  gradingMode: 'AUTO_IMMEDIATE' | 'AI_IMMEDIATE' | 'AI_BATCH';
  disabled: boolean;
  busy: boolean;
  onChange: (answer: string) => void;
  onSubmitObjective: (answer: string) => void;
  onSubmitSubjective?: ((answer: string) => void) | undefined;
  onSaveDraft: (answer: string) => void;
}

export function DictationAnswer({ question, language, answer, gradingMode, disabled, busy, onChange,
  onSubmitObjective, onSubmitSubjective, onSaveDraft }: Props) {
  const text = question.dictation?.fullJapanese ?? '';
  const audio = useListeningPlayback(text, trackToSpeechLang(language));
  const submit = gradingMode === 'AUTO_IMMEDIATE' ? onSubmitObjective : gradingMode === 'AI_IMMEDIATE' ? onSubmitSubjective : undefined;
  return <div className="space-y-3">
    {text ? <Button variant="outline" size="sm" onClick={() => audio.playing ? audio.stop() : void audio.play()}>
      {audio.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{audio.playing ? '停止' : '播放音频'}
    </Button> : <p role="alert" className="text-sm text-ink-ghost">本题缺少听力语料，请重新组题。</p>}
    {question.content && question.content !== text && <p className="whitespace-pre-wrap text-sm">{question.content}</p>}
    <label className="flex flex-col gap-2 text-sm">你的答案
      <textarea rows={3} value={answer} disabled={disabled || busy || !text} onChange={event => onChange(event.target.value)}
        onBlur={() => gradingMode !== 'AUTO_IMMEDIATE' && answer.trim() && onSaveDraft(answer)}
        className="rounded-md border border-line-soft bg-paper-soft px-3 py-2" />
    </label>
    {submit && <Button size="sm" disabled={!answer.trim() || disabled || busy || !text} onClick={() => submit(answer)}>
      {busy ? '正在提交…' : '提交答案'}</Button>}
  </div>;
}
