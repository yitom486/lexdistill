import React, { useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Loader2 } from 'lucide-react';
import { inferLanguageFromSkillId } from '@study-studio/shared';
import { GeneratedQuestionSchema } from '@study-studio/protocol';
import { Button } from './ui/button.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { SubjectiveWritingWorkbench } from './SubjectiveWritingWorkbench.js';
import { QuizRound } from './practice/QuizRound.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { useQuestionsQuery } from '../queries/useLearnerQueries.js';
import { useGenerateAdaptiveQuizMutation } from '../queries/useAgentMutations.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { toQuizQuestionItem } from '../lib/quiz-question.js';

export function AdaptiveQuizWorkbench({ onOpenTutor }: { onOpenTutor: (context: AiTutorContext) => void }) {
  const shell = useLearningShell();
  const userId = useUserProfileStore(s => s.profile.userId);
  const query = useQuestionsQuery(userId, shell.track);
  const generate = useGenerateAdaptiveQuizMutation();
  const presented = useStudySessionStore(s => s.presentedQuiz);
  const planIntent = useStudySessionStore(s => s.planIntent);
  const [mode, setMode] = useState('OBJECTIVE');
  const [round, setRound] = useState(0);
  const objective = (presented?.questions ?? []).filter(q =>
    ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'SENTENCE_REORDER'].includes(q.type) && inferLanguageFromSkillId(q.testedSkillId) === shell.track);
  const questions = objective.length ? objective.map(toQuizQuestionItem) : query.data ?? [];

  const generateQuestions = async () => {
    try {
      const reply = await generate.mutateAsync({ count: 5, ...(planIntent?.skillId ? { weaknessSkillId: planIntent.skillId } : {}) });
      const parsed = GeneratedQuestionSchema.array().parse((reply as { questions?: unknown }).questions);
      if (!parsed.length) throw new Error('当前考点暂无可用题目，请先完成对应讲义或调整考点。');
      useStudySessionStore.getState().presentQuiz({ surface: 'quiz', questions: parsed, stepIndex: 0 });
      setRound(value => value + 1);
      toast.success('已准备 ' + parsed.length + ' 道练习题');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '准备题目失败，请重试。');
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PlanIntentBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={mode} onValueChange={value => value && setMode(value)}>
          <TabsList><TabsIndicator /><TabsTrigger value="OBJECTIVE">语法与词汇练习</TabsTrigger><TabsTrigger value="SUBJECTIVE">写作与翻译</TabsTrigger></TabsList>
        </Tabs>
        <Button variant="outline" onClick={() => void generateQuestions()} disabled={generate.isPending}>
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          针对弱项练习
        </Button>
      </div>
      {mode === 'SUBJECTIVE' ? <SubjectiveWritingWorkbench /> : questions.length ? (
        <QuizRound key={`${shell.track}:${round}:${questions.map(question => question.id).join(',')}`} questions={questions} language={shell.track} onOpenTutor={onOpenTutor} />
      ) : (
        <div className="space-y-3 py-8 text-center">
          <p className="text-sm text-ink-ghost">{query.isLoading ? '正在读取题库…' : query.isError ? '题库读取失败，请重试。' : shell.copy.quizEmptyHint}</p>
          {query.isError && <Button variant="outline" onClick={() => void query.refetch()}>重试</Button>}
        </div>
      )}
    </div>
  );
}
