import { useState } from 'react';
import { Headphones, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { useGenerateDictationMutation } from '../queries/useLearnerQueries.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';
import { TextbookListening } from './listening/TextbookListening.js';
import { DictationQuestion } from './listening/DictationQuestion.js';
import type { DictationItem } from '../models/practice.js';
import type { AiTutorContext } from './AiTutorDrawer.js';

interface Props {
  onOpenTutor?: ((context: AiTutorContext) => void) | undefined;
  onAddMistake?: (mistake: { categoryTag: string; prompt: string; sentence: string; userWrongAnswer: string;
    correctAnswer: string; testedSkillId: string; reviewNote: string }) => void;
}

export function ListeningShadowingWorkbench({ onOpenTutor }: Props) {
  const language = normalizeTrackLanguage(useUserProfileStore(s => s.profile.targetLanguage));
  return <ListeningTrack key={language} language={language} onOpenTutor={onOpenTutor} />;
}

function ListeningTrack({ language, onOpenTutor }: { language: 'en' | 'ja' | 'ko'; onOpenTutor?: ((context: AiTutorContext) => void) | undefined }) {
  const [mode, setMode] = useState('DICTATION');
  const [pool, setPool] = useState<DictationItem[]>([]);
  const [index, setIndex] = useState(0);
  const userId = useUserProfileStore(s => s.profile.userId);
  const generate = useGenerateDictationMutation(userId);
  const load = async () => {
    try { const items = await generate.mutateAsync(); setPool(items); setIndex(0); }
    catch (error) { toast.error(error instanceof Error ? error.message : '听写题加载失败'); }
  };
  const item = pool[index];
  return <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
    <h1 className="flex items-center gap-3 text-2xl font-semibold"><Headphones className="h-6 w-6" />精听与听写</h1>
    <Tabs value={mode} onValueChange={setMode}><TabsList>
      <TabsTrigger value="DICTATION">听写练习</TabsTrigger><TabsTrigger value="TEXTBOOK">教材精听</TabsTrigger><TabsIndicator />
    </TabsList></Tabs>
    {mode === 'TEXTBOOK' ? <TextbookListening language={language} /> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-ink-ghost">{item ? `第 ${index + 1} / ${pool.length} 题` : pool.length ? '本轮已完成' : '暂无本轮题目'}</span>
        <Button variant="outline" disabled={generate.isPending} onClick={() => void load()}><Plus className="h-4 w-4" />{generate.isPending ? '正在组题…' : '新一轮听写'}</Button>
      </div>
      {item && <DictationQuestion key={`${item.id}:${index}`} item={item} language={language} last={index === pool.length - 1}
        onNext={() => setIndex(index + 1)} onOpenTutor={onOpenTutor} />}
    </>}
  </div>;
}
