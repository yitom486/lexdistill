import { useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { UnifiedTtsPlayer } from '../../UnifiedTtsPlayer.js';
import { trackToSpeechLang } from '../../../config/speech-language.js';
import { useTtsStore } from '../../../stores/useTtsStore.js';
import type { ChapterStudy, StudyContentProps, StudySegment } from './study-view.js';
import { parseArticleDialogueSegments } from './dialogue-parser.js';

function ReadingTurn({ segment, index, showTranslation, practice, language, explain }: { segment: StudySegment; index: number; showTranslation: boolean; practice: boolean } & Pick<StudyContentProps, 'language' | 'explain'>) {
  const [translationOpen, setTranslationOpen] = useState(false), [revealed, setRevealed] = useState(false);
  const playing = useTtsStore(state => state.isSpeaking && state.currentText === segment.text);
  const visible = !practice || revealed;
  return <div className={`rounded-xl border p-4 ${playing ? 'border-line-accent bg-wash-amber-500o10' : 'border-line-soft'}`} data-testid="reading-turn">
    <div className="mb-3 flex items-center gap-2">
      <span className="text-xs tabular-nums text-ink-muted">{String(index + 1).padStart(2, '0')}</span>
      {segment.speaker && (
        <Badge variant="outline" className="gap-1">
          <span>{segment.speaker}</span>
          {segment.gender === 'male' && <span className="text-[10px] opacity-75 font-normal">男声</span>}
          {segment.gender === 'female' && <span className="text-[10px] opacity-75 font-normal">女声</span>}
        </Badge>
      )}
      {practice && <Badge variant="amber">你的台词</Badge>}
    </div>
    {visible ? <p className="select-text whitespace-pre-wrap text-xl leading-9">{segment.text}</p> : <Button variant="outline" className="h-auto w-full whitespace-normal py-4" onClick={() => setRevealed(true)}>先自己说，再揭示这句台词</Button>}
    {visible && <><div className="mt-3 flex flex-wrap gap-2"><UnifiedTtsPlayer text={segment.text} lang={trackToSpeechLang(language)} speaker={segment.speaker} gender={segment.gender} label="听这一句" />{segment.translation && <Button size="sm" variant="ghost" aria-expanded={showTranslation || translationOpen} onClick={() => setTranslationOpen(value => !value)} disabled={showTranslation}><Languages className="h-4 w-4" />{showTranslation || translationOpen ? '收起译文' : '看译文'}</Button>}{explain({ title: segment.speaker ? `${segment.speaker} · 台词讲解` : '句段讲解', text: segment.text, ...(segment.translation ? { translation: segment.translation } : {}), ...(segment.note ? { explanation: segment.note } : {}), ...(segment.knowledgeTitles ? { knowledgeTitles: segment.knowledgeTitles } : {}) }, '注意点与讲解')}</div>
      {(showTranslation || translationOpen) && segment.translation && <p className="mt-3 border-l-2 border-line-accent pl-4 text-sm leading-7 text-ink-muted" data-testid="inline-translation">{segment.translation}</p>}</>}
  </div>;
}

export function InteractiveReading({ content, showTranslation, language, explain, study }: StudyContentProps & { study?: ChapterStudy | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const [practiceRole, setPracticeRole] = useState(''), [selectedText, setSelectedText] = useState('');
  const captureSelection = () => {
    const selection = window.getSelection();
    setSelectedText(selection?.anchorNode && selection.focusNode && root.current?.contains(selection.anchorNode) && root.current.contains(selection.focusNode) ? selection.toString().trim() : '');
  };
  return <div ref={root} onMouseUp={captureSelection} onKeyUp={captureSelection} className="space-y-5">{content.articles.map(article => {
    const segments = study?.articles[article.id] ?? parseArticleDialogueSegments(article);
    const speakers = [...new Set(segments?.map(segment => segment.speaker).filter((name): name is string => !!name) ?? [])];
    const spokenText = segments ? segments.filter(segment => !practiceRole || segment.speaker !== practiceRole).map(segment => segment.text).join('\n') : article.text;
    const remainingSpeakers = speakers.filter(s => !practiceRole || s !== practiceRole);
    const mainSpeaker = practiceRole && remainingSpeakers.length === 1 ? remainingSpeakers[0] : undefined;
    return <article key={article.id} className="rounded-2xl border border-line-soft bg-paper-soft p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3"><h3 className="flex-1 text-lg font-semibold">{article.title ?? '阅读正文'}</h3><Badge variant="outline">{article.source === 'AI' ? 'AI 补充' : '教材内容'}</Badge></div>
      <div className="mb-5 flex flex-wrap items-center gap-3"><UnifiedTtsPlayer text={spokenText} lang={trackToSpeechLang(language)} speaker={mainSpeaker} label={practiceRole ? '听对方的台词' : '整段朗读'} />{speakers.length > 1 && <Select value={practiceRole || 'ALL'} onValueChange={value => setPracticeRole(value === 'ALL' || !value ? '' : value)}><SelectTrigger className="w-52" aria-label="选择对话练习角色"><SelectValue>{practiceRole ? `我来扮演：${practiceRole}` : '完整对话 / 角色练习'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="ALL">完整对话</SelectItem>{speakers.map(name => <SelectItem key={name} value={name}>我来扮演：{name}</SelectItem>)}</SelectContent></Select>}
        {explain({ title: '选中文字讲解', text: selectedText }, selectedText ? '讲解选中文字' : '先选中正文中的文字', !selectedText)}
      </div>
      {practiceRole && <p className="mb-4 text-xs leading-6 text-ink-muted">你的台词先遮住；可以听对方的内容，自己回应，再揭示原句核对。</p>}
      {segments ? <div className="space-y-3">{segments.map((segment, index) => <ReadingTurn key={`${index}-${practiceRole}`} segment={segment} index={index} showTranslation={showTranslation} practice={segment.speaker === practiceRole} language={language} explain={explain} />)}</div> : <ReadingTurn key={article.id} segment={{ text: article.text, ...(article.translation ? { translation: article.translation } : {}) }} index={0} showTranslation={showTranslation} practice={false} language={language} explain={explain} />}
      <div className="mt-4">{explain({ title: article.title ?? '整篇讲解', text: article.text, ...(article.translation ? { translation: article.translation } : {}), ...(segments ? { knowledgeTitles: [...new Set(segments.flatMap(segment => segment.knowledgeTitles ?? []))] } : {}) }, '理解整段内容')}</div>
    </article>;
  })}</div>;
}
