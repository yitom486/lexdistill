import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { sound } from '../utils/audio.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import type { SubjectiveExercise } from '../models/practice.js';
import {
  useGenerateWritingPromptsMutation,
  type WritingPromptItem,
} from '../queries/useLearnerQueries.js';
import { useSubjectiveGrading } from './subjective/useSubjectiveGrading.js';
import { SubjectivePromptCard } from './subjective/SubjectivePromptCard.js';
import { SubjectiveFeedbackCard } from './subjective/SubjectiveFeedbackCard.js';

interface SubjectiveWritingWorkbenchProps {
  /** 外部注入的题干（写作工作室生成后传入） */
  exercises?: SubjectiveExercise[] | undefined;
  onExercisesChange?: ((exercises: SubjectiveExercise[]) => void) | undefined;
  genre?: string | undefined;
  difficulty?: number | undefined;
}

function toExercise(p: WritingPromptItem): SubjectiveExercise {
  return {
    id: p.id,
    category: p.category,
    chinesePrompt: p.chinesePrompt,
    contextHint: p.contextHint,
    testedSkillId: p.testedSkillId,
    standardAnswer: p.standardAnswer,
    grammarFocus: p.grammarFocus,
  };
}

/**
 * 主观写作工作台：容器只做题干来源与切题编排，
 * 批改交互归 useSubjectiveGrading，展示归 Prompt/Feedback 卡。
 */
export function SubjectiveWritingWorkbench({
  exercises: controlledExercises,
  onExercisesChange,
  genre = 'translation',
  difficulty = 3,
}: SubjectiveWritingWorkbenchProps) {
  // 题干由 Gateway learning.content 生成；空列表显式提示生成，不内置演示题干
  const [localExercises, setLocalExercises] = useState<SubjectiveExercise[]>([]);
  const exercises = controlledExercises ?? localExercises;
  const setExercises = (next: SubjectiveExercise[]) => {
    if (onExercisesChange) onExercisesChange(next);
    else setLocalExercises(next);
  };

  const [exerciseIndex, setExerciseIndex] = useState(0);
  const generateMutation = useGenerateWritingPromptsMutation();
  const generating = useRef(false);
  const generationEpoch = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generationEpoch.current += 1; };
  }, []);
  useEffect(() => { generationEpoch.current += 1; }, [genre, difficulty]);

  const currentExercise = exercises[exerciseIndex] ?? exercises[0];
  const grading = useSubjectiveGrading(currentExercise);

  const handleSwitchExercise = (idx: number) => {
    generationEpoch.current += 1;
    sound.playClick();
    setExerciseIndex(idx);
    grading.resetAnswer();
  };

  const handleGenerate = async () => {
    if (generating.current || generateMutation.isPending) return;
    generating.current = true;
    const epoch = generationEpoch.current;
    sound.playClick();
    try {
      const prompts = await generateMutation.mutateAsync({
        genre,
        difficulty,
        count: 3,
        collect: true,
      });
      if (!mounted.current || epoch !== generationEpoch.current) return;
      const mapped = prompts.map(toExercise);
      setExercises(mapped);
      setExerciseIndex(0);
      grading.resetAnswer();
      toast.success(`已生成 ${mapped.length} 道写作题干并写入练习队列`);
    } catch (e) {
      if (!mounted.current || epoch !== generationEpoch.current) return;
      toast.error(
        e instanceof Error ? e.message : '暂时无法生成写作题干，请稍后重试。'
      );
    } finally {
      generating.current = false;
    }
  };

  if (!currentExercise) {
    return (
      <div className="bg-paper-soft rounded-3xl p-10 border border-line-accent shadow-sm text-center space-y-4">
        <Sparkles className="w-8 h-8 mx-auto text-tone-amber-500" />
        <p className="text-sm text-ink-faint">
          暂无写作题干。选择体裁和难度后，可生成新题干。
        </p>
        <Button
          variant="outline"
          onClick={handleGenerate}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          生成新题干
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-paper-soft rounded-3xl p-6 sm:p-8 border border-line-accent shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-line-soft">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="amber">主观题批改</Badge>
            <span className="text-xs text-ink-ghost">
              网关出题 · AI 批改
            </span>
          </div>
          <h3 className="text-lg font-bold text-ink mt-1 font-serif">
            {currentExercise.category}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            生成新题干
          </Button>
          <Tabs
            value={String(Math.min(exerciseIndex, exercises.length - 1))}
            onValueChange={(val) => {
              if (val == null) return;
              handleSwitchExercise(Number(val));
            }}
          >
            <TabsList className="bg-veil-stone-200o60-stone-900">
              <TabsIndicator />
              {exercises.map((ex, idx) => (
                <TabsTrigger key={ex.id} value={String(idx)} className="px-3 py-1.5 text-xs">
                  题目 {idx + 1}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <SubjectivePromptCard exercise={currentExercise} grading={grading} />

      <AnimatePresence>
        {grading.gradingResult && (
          <SubjectiveFeedbackCard key={currentExercise.id} grading={grading} />
        )}
      </AnimatePresence>
    </div>
  );
}
