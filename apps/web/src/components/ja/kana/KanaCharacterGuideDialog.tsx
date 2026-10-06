import React, { useState } from 'react';
import { Bot, Eye, GitCompareArrows, Lightbulb, Mic2, Volume2 } from 'lucide-react';
import type { KanaExampleWord, KanaItem } from '@study-studio/protocol';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../ui/dialog.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs.js';
import type { KanaGuideScriptMode } from './KanaRowGuideDialog.js';

type Script = 'HIRAGANA' | 'KATAKANA';
interface KanaCharacterGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kana: KanaItem;
  scriptMode: KanaGuideScriptMode;
  onPlayAudio: (kana: KanaItem) => void;
  onPlayExample: (example: KanaExampleWord) => void;
  onAskTutor: (kana: KanaItem, script: Script) => void;
}

export function KanaCharacterGuideDialog(props: KanaCharacterGuideDialogProps) {
  const [script, setScript] = useState<Script>(props.scriptMode === 'KATAKANA' ? 'KATAKANA' : 'HIRAGANA');
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-2">
            <Badge variant="amber">假名讲义</Badge>
            <span className="text-xs text-ink-ghost">{props.kana.row} · {props.kana.col}</span>
          </div>
          <DialogTitle>{props.kana.hiragana} · {props.kana.katakana} 怎么读、怎么记？</DialogTitle>
          <DialogDescription>先看关键笔画，再用联想记形，最后遮住提示自己回忆。两种字形分别学，声音相同。</DialogDescription>
        </DialogHeader>
        <Tabs value={script} onValueChange={(value) => setScript(value as Script)}>
          <TabsList aria-label="讲义字形">
            <TabsTrigger value="HIRAGANA">平假名 {props.kana.hiragana}</TabsTrigger>
            <TabsTrigger value="KATAKANA">片假名 {props.kana.katakana}</TabsTrigger>
          </TabsList>
          {(['HIRAGANA', 'KATAKANA'] as const).map((tab) => (
            <TabsContent key={tab} value={tab}>
              {script === tab && <CharacterGuideBody key={`${props.kana.id}-${script}`} {...props} script={script} />}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function GuideSection({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line-accent bg-paper-soft p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-deep">{icon}{title}</h3>
      <div className="text-sm leading-relaxed text-ink-faint">{children}</div>
    </section>
  );
}

function CharacterGuideBody({ kana, script, onPlayAudio, onPlayExample, onAskTutor }: KanaCharacterGuideDialogProps & { script: Script }) {
  const [recalling, setRecalling] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const face = script === 'KATAKANA' ? kana.katakana : kana.hiragana;
  const guide = kana.learningGuide;
  const scriptGuide = guide?.scripts?.[script === 'KATAKANA' ? 'katakana' : 'hiragana'];
  const examples = scriptGuide?.exampleWords ?? guide?.exampleWords ?? [];

  if (recalling && scriptGuide) {
    return (
      <section aria-label="遮住提示回忆" className="space-y-4 rounded-2xl border border-line-accent bg-paper-soft p-6">
        <p className="text-xs text-ink-ghost">先说读音，再描述关键笔画；答错就回讲义看对应的区别。</p>
        <p className="text-center font-serif text-7xl text-ink" lang="ja">{face}</p>
        <p className="text-sm leading-relaxed text-ink-deep">{scriptGuide.recallQuestion}</p>
        {revealed && <p role="status" className="text-sm leading-relaxed text-ink-deep">{scriptGuide.recallAnswer}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setRevealed(!revealed)} variant="secondary"><Eye className="size-4" />{revealed ? '再次遮住答案' : '揭晓答案'}</Button>
          <Button onClick={() => setRecalling(false)} variant="outline">回到讲义</Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line-accent bg-paper-soft p-4">
        <div className="min-w-24 text-center">
          <p className="font-serif text-5xl text-ink" lang="ja">{face}</p>
          <p className="mt-1 font-mono text-sm text-accent-ink-strong">{kana.romaji}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-ink-ghost">一眼辨认口令</p>
          <p className="mt-1 text-base font-semibold text-ink-deep">{scriptGuide?.recognitionCue ?? '先听示范，再观察字形。'}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => onPlayAudio(kana)}><Volume2 className="size-4" />朗读发音</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <GuideSection title="字形看哪里" icon={<Eye className="size-4 text-accent-ink" />}>
          {scriptGuide ? <ul className="list-disc space-y-2 pl-5">{scriptGuide.shapeFeatures.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            : <p>这份旧讲义尚未包含当前字形的笔画观察，请更新内置课程。</p>}
        </GuideSection>
        <GuideSection title="给字形一个画面" icon={<Lightbulb className="size-4 text-accent-ink" />}>
          <p>{scriptGuide?.memoryTip ?? (script === 'HIRAGANA' ? guide?.memoryTip : '先用右侧对照和发音示范辨认片假名。')}</p>
          <p className="mt-2 text-xs text-ink-ghost">这是助记联想，不是字源；中文谐音只当线索，实际读音听示范。</p>
        </GuideSection>
      </div>

      {scriptGuide && <GuideSection title="放在一起，差别在哪" icon={<GitCompareArrows className="size-4 text-accent-ink" />}>
        <div className="space-y-3">{scriptGuide.contrasts.map((contrast) => (
          <div key={contrast.kana} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex shrink-0 items-center gap-3 font-serif text-3xl text-ink" lang="ja">
              <span>{face}<small className="block font-mono text-xs text-ink-ghost">{kana.romaji}</small></span>
              <span className="font-sans text-sm text-ink-ghost">／</span>
              <span>{contrast.kana}<small className="block font-mono text-xs text-ink-ghost">{contrast.romaji}</small></span>
            </div>
            <p>{contrast.difference}</p>
          </div>
        ))}</div>
      </GuideSection>}

      <GuideSection title="发音与口形" icon={<Mic2 className="size-4 text-accent-ink" />}>
        <p>{guide?.soundDescription ?? `读 ${kana.romaji}，先跟示范读。`}</p>
        <p className="mt-2">{guide?.pronunciationTip ?? '短而清楚，不加中文声调。'}</p>
      </GuideSection>

      {examples.length > 0 && <GuideSection title="放进词里记">
        <div className="flex flex-wrap gap-2">{examples.map((word) => (
          <Button key={word.word} variant="outline" className="h-auto whitespace-normal py-2 text-left" onClick={() => onPlayExample(word)} aria-label={`播放例词 ${word.word} 的发音`}>
            <span lang="ja">{word.word}（{word.reading}）</span><span>· {word.meaning}</span><Volume2 className="size-4 shrink-0" />
          </Button>
        ))}</div>
        <p className="mt-2 text-xs text-ink-ghost">例词保留日语通常写法，不把所有词强行改成片假名。单个假名表示声音，词义来自完整词语。</p>
      </GuideSection>}

      <div className="flex flex-wrap gap-2">
        {scriptGuide && <Button variant="secondary" onClick={() => { setRevealed(false); setRecalling(true); }}><Eye className="size-4" />遮住提示，试着回忆</Button>}
        <Button variant="outline" onClick={() => onAskTutor(kana, script)}><Bot className="size-4" />AI 假名点拨</Button>
      </div>
      <p className="text-xs text-ink-ghost">学完后隔一会再认一次，也试着不看范字写出来；能自己想起来，比反复看讲义更能检查是否记住。</p>
    </div>
  );
}
