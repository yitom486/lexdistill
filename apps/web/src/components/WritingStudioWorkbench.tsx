import React, { useState } from 'react';
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

export function WritingStudioWorkbench() {
  const [genre, setGenre] = useState('translation');
  const [difficulty, setDifficulty] = useState('3');
  const [exercises, setExercises] = useState<SubjectiveExercise[] | undefined>(undefined);
  const generateMutation = useGenerateWritingPromptsMutation();

  const handleGenerate = async () => {
    sound.playClick();
    try {
      const prompts = await generateMutation.mutateAsync({
        genre,
        difficulty: Number(difficulty) || 3,
        count: 3,
        collect: true,
      });
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
      toast.success('题干已由 learning.content 生成');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成失败，请重试。');
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
              <Badge variant="amber" className="text-[10px]">
                learning.content
              </Badge>
            </div>
            <p className="text-xs text-ink-ghost mt-0.5">
              体裁与难度驱动出题 · 提交走 Gateway 批改
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={genre} onValueChange={(v) => v && setGenre(v)}>
            <SelectTrigger className="w-[8.5rem]">
              <SelectValue placeholder="体裁" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="translation">中译日/英</SelectItem>
              <SelectItem value="email">邮件</SelectItem>
              <SelectItem value="essay">短议论文</SelectItem>
              <SelectItem value="diary">日记</SelectItem>
              <SelectItem value="news_response">读后续写</SelectItem>
            </SelectContent>
          </Select>
          <Select value={difficulty} onValueChange={(v) => v && setDifficulty(v)}>
            <SelectTrigger className="w-[7rem]">
              <SelectValue placeholder="难度" />
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
        exercises={exercises}
        onExercisesChange={setExercises}
        genre={genre}
        difficulty={Number(difficulty) || 3}
      />
    </motion.div>
  );
}
