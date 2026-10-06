import { useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pause, Play } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Slider } from '../ui/slider.js';
import { useTextbooksQuery } from '../../queries/useLearnerQueries.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { useListeningPlayback } from '../../hooks/useListeningPlayback.js';
import { trackToSpeechLang } from '../../config/speech-language.js';
import type { TextbookLesson } from '../../models/textbook.js';

export function TextbookListening({ language }: { language: 'en' | 'ja' | 'ko' }) {
  const books = useTextbooksQuery();
  const [selected, setSelected] = useState('');
  const lessons = (books.data ?? []).filter(book => book.language?.toLowerCase() === language)
    .flatMap(book => book.lessons.filter(lesson => lesson.dialogues.length > 0)
      .map(lesson => ({ lesson, title: `${book.shortTitle} · ${lesson.title}` })));
  const active = lessons.find(entry => entry.lesson.id === selected) ?? lessons[0];
  if (books.isLoading) return <p className="py-6 text-sm text-ink-ghost">正在加载教材…</p>;
  if (books.isError) return <Button variant="outline" onClick={() => void books.refetch()}>重新加载教材</Button>;
  if (!active) return <p className="py-6 text-sm text-ink-ghost">当前语言暂无含对话的教材。可以先做听写练习。</p>;
  return <div className="space-y-5">
    <Select value={active.lesson.id} onValueChange={value => value && setSelected(value)}>
      <SelectTrigger aria-label="教材课次" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{lessons.map(entry => <SelectItem key={entry.lesson.id} value={entry.lesson.id}>{entry.title}</SelectItem>)}</SelectContent>
    </Select>
    <LessonAudio key={active.lesson.id} lesson={active.lesson} language={language} />
  </div>;
}

function LessonAudio({ lesson, language }: { lesson: TextbookLesson; language: 'en' | 'ja' | 'ko' }) {
  const [index, setIndex] = useState(0);
  const mask = usePreferencesStore(s => s.maskTextEnabled);
  const setMask = usePreferencesStore(s => s.setMaskTextEnabled);
  const sentence = lesson.dialogues[index]!;
  const audio = useListeningPlayback(sentence.japanese, trackToSpeechLang(language));
  const navigate = (next: number) => { audio.stop(); setIndex(next); };
  return <section className="space-y-5 border-t border-line-soft py-5">
    <div className="flex items-center justify-between gap-3 text-sm text-ink-ghost">
      <span>{sentence.speaker} · {index + 1} / {lesson.dialogues.length}</span>
      <Button variant="ghost" size="icon" title={mask ? '显示原文' : '遮住原文'} aria-pressed={mask} onClick={() => setMask(!mask)}>
        {mask ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
    <div className="min-h-28 space-y-3">
      <p className="whitespace-pre-wrap text-lg leading-relaxed">{mask ? '原文已遮住' : sentence.japanese}</p>
      {!mask && <p className="text-sm text-ink-ghost">{sentence.chinese}</p>}
    </div>
    <div className="flex items-center justify-center gap-3">
      <Button variant="outline" size="icon" title="上一句" disabled={index === 0} onClick={() => navigate(index - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      <Button onClick={() => audio.playing ? audio.stop() : void audio.play()}>{audio.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{audio.playing ? '停止' : '播放'}</Button>
      <Button variant="outline" size="icon" title="下一句" disabled={index === lesson.dialogues.length - 1} onClick={() => navigate(index + 1)}><ChevronRight className="h-4 w-4" /></Button>
    </div>
    <div className="flex items-center gap-4 text-sm"><span className="w-20 shrink-0">语速 {audio.rate}x</span>
      <Slider aria-label="语速" value={[audio.rate]} min={0.5} max={1.5} step={0.1} onValueChange={value => {
        const rate = Array.isArray(value) ? value[0] : value;
        if (rate !== undefined) { audio.stop(); audio.setRate(rate); }
      }} />
    </div>
  </section>;
}
