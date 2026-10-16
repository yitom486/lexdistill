import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PenLine, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { sound } from '../utils/audio.js';
import { SubjectiveWritingWorkbench } from './SubjectiveWritingWorkbench.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { useGenerateWritingPromptsMutation } from '../queries/useLearnerQueries.js';
import type { SubjectiveExercise } from '../models/practice.js';

/** 体裁值（传网关的参数）→ 用户可读名称。值与参数不变，只换显示。 */
export const WRITING_GENRE_LABELS: Record<string, string> = {
  translation: '翻译',
  email: '邮件',
  essay: '短议论文',
  diary: '日记',
  news_response: '读后续写',
};

export function WritingStudioWorkbench() {
  const [genre, setGenre] = useState('translation');
  const [difficulty, setDifficulty] = useState('3');
  const [exercises, setExercises] = useState<SubjectiveExercise[] | undefined>(undefined);
  const generateMutation = useGenerateWritingPromptsMutation();
  const generating = useRef(false);
  const mounted = useRef(false);
  const context = useRef('');
  context.current = `${genre}:${difficulty}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const handleGenerate = async () => {
    if (generating.current) return;
    generating.current = true;
    const requestContext = context.current;
    sound.playClick();
    try {
      const prompts = await generateMutation.mutateAsync({
        genre,
        difficulty: Number(difficulty) || 3,
        count: 3,
        collect: true,
      });
      if (!mounted.current || context.current !== requestContext) return;
      setExercises(
        prompts.map((p) => ({
          id: p.id,
          category: p.category,
          chinesePrompt: p.chinesePrompt,
          contextHint: p.contextHint,
          testedSkillId: p.testedSkillId,
          standardAnswer: p.standardAnswer,
          grammarFocus: p.grammarFocus,
        }))
      );
      toast.success('题干已生成并写入练习队列');
    } catch (error) {
      if (!mounted.current || context.current !== requestContext) return;
      toast.error(error instanceof Error ? error.message : '生成失败，请重试。');
    } finally {
      generating.current = false;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4 max-w-3xl w-full"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-line-accent bg-paper-soft shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-wash-amber-500o15 border border-line-amber-500o30 text-ink-amber-900-amber-300 flex items-center justify-center">
            <PenLine className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold font-serif text-ink">
                写作与翻译工作室
              </h2>
              <Badge variant="amber" className="text-xs">
                写作练习
              </Badge>
            </div>
            <p className="text-xs text-ink-ghost mt-0.5">
              体裁与难度驱动出题 · 提交后 AI 批改
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={genre} onValueChange={(v) => v && setGenre(v)}>
            <SelectTrigger className="w-[8.5rem]" aria-label="体裁">
              <SelectValue>{WRITING_GENRE_LABELS[genre] ?? genre}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(WRITING_GENRE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={difficulty} onValueChange={(v) => v && setDifficulty(v)}>
            <SelectTrigger className="w-[7rem]" aria-label="难度">
              <SelectValue>{`难度 Lv.${difficulty}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  难度 {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            生成题干
          </Button>
        </div>
      </div>

      <SubjectiveWritingWorkbench
        key={exercises?.map(exercise => exercise.id).join(':') ?? 'initial'}
        exercises={exercises}
        onExercisesChange={setExercises}
        genre={genre}
        difficulty={Number(difficulty) || 3}
      />
    </motion.div>
  );
}
