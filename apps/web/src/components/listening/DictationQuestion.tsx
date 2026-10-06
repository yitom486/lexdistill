import { CheckCircle2, Pause, Play } from 'lucide-react';
import { Button } from '../ui/button.js';
import { useObjectiveAnswer } from '../../hooks/useObjectiveAnswer.js';
import { useListeningPlayback } from '../../hooks/useListeningPlayback.js';
import { trackToSpeechLang } from '../../config/speech-language.js';
import type { DictationItem } from '../../models/practice.js';
import type { AiTutorContext } from '../AiTutorDrawer.js';

interface Props {
  item: DictationItem;
  language: 'en' | 'ja' | 'ko';
  onNext: () => void;
  last: boolean;
  onOpenTutor?: ((context: AiTutorContext) => void) | undefined;
}

export function DictationQuestion({ item, language, onNext, last, onOpenTutor }: Props) {
  const answer = useObjectiveAnswer(item.id, language);
  const audio = useListeningPlayback(item.fullJapanese, trackToSpeechLang(language));
  return <section className="space-y-5 border-t border-line-soft py-5">
    <p className="text-sm text-ink-ghost">{item.blankPrompt}</p>
    <p className="whitespace-pre-wrap text-lg leading-relaxed">{item.clozeDisplay}</p>
    <Button variant="outline" disabled={!item.fullJapanese} onClick={() => audio.playing ? audio.stop() : void audio.play()}>
      {audio.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{audio.playing ? '停止' : '播放音频'}
    </Button>
    <label className="flex flex-col gap-2 text-sm">你的答案
      <input value={answer.answer} disabled={answer.isPending || Boolean(answer.result)}
        onChange={event => answer.setAnswer(event.target.value)}
        onKeyDown={event => event.key === 'Enter' && void answer.submit()}
        className="rounded-md border border-line-soft bg-paper-soft px-3 py-2" />
    </label>
    {answer.result ? <>
      <div role="status" className="space-y-2 border-l-2 border-line-soft pl-4">
        <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" />
          {answer.result.isCorrect ? '回答正确' : `标准答案：${answer.result.correctAnswer}`}</p>
        <p>{item.fullJapanese}</p><p className="text-sm text-ink-ghost">{item.chinese}</p>
        <p className="text-sm leading-relaxed">{answer.result.explanation}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { audio.stop(); onNext(); }}>{last ? '完成本轮' : '下一题'}</Button>
        {onOpenTutor && <Button variant="outline" onClick={() => onOpenTutor({ questionText: item.clozeDisplay,
          userAnswer: answer.answer, correctAnswer: answer.result!.correctAnswer,
          explanation: answer.result!.explanation, skillTag: item.categoryTag })}>询问导师</Button>}
      </div>
    </> : <Button disabled={!answer.answer.trim() || answer.isPending} onClick={() => void answer.submit()}>
      {answer.isPending ? '正在保存…' : '提交答案'}</Button>}
  </section>;
}
