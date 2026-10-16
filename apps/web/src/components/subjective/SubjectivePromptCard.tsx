import { PenTool, Send, Loader2, Lightbulb } from 'lucide-react';
import { ShimmerButton } from '../magicui/index.js';
import type { SubjectiveExercise } from '../../models/practice.js';
import type { SubjectiveGrading } from './useSubjectiveGrading.js';

interface PromptCardProps {
  exercise: SubjectiveExercise;
  grading: SubjectiveGrading;
}

/** 题干作答卡（纯展示）：中文题干、作答输入、提交批改（批改期禁用）。 */
export function SubjectivePromptCard({ exercise, grading }: PromptCardProps) {
  return (
    <div className="space-y-3">
      <div className="p-4 rounded-2xl bg-wash-amber-50o60-stone-900o60 border border-line-accent space-y-2">
        <span className="text-xs font-bold text-ink-amber-900-amber-300 uppercase tracking-wider">
          中文题干 (请翻译为地道日文)：
        </span>
        <p className="text-xl font-bold font-serif text-ink">
          {exercise.chinesePrompt}
        </p>
        <p className="text-xs text-ink-ghost flex items-start gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>考点提示：{exercise.contextHint}</span>
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-ink-faint-soft flex items-center gap-1.5" htmlFor="subjective-answer">
          <PenTool className="w-3.5 h-3.5 text-accent-ink" />
          在此键入你的日文长句作答：
        </label>
        <textarea
          id="subjective-answer"
          rows={3}
          value={grading.inputSubmission}
          onChange={(e) => grading.setInputSubmission(e.target.value)}
          disabled={grading.isGrading}
          placeholder="例如：昨日、友達とカフェで日本語の本を読みました。"
          className="w-full p-4 rounded-2xl bg-surface text-ink border border-line-stone-300-stone-700 outline-none focus-visible:border-tone-amber-500 focus-visible:ring-2 focus-visible:ring-focus-ring text-base leading-relaxed resize-none transition-all shadow-xs"
        />
      </div>

      <div className="flex justify-end pt-1">
        <ShimmerButton
          onClick={grading.handleGradeSubmit}
          disabled={!grading.inputSubmission.trim() || grading.isGrading}
          className="px-6 py-2.5 text-xs font-bold flex items-center gap-2 shadow-md"
        >
          {grading.isGrading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              批改中…
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              提交批改
            </>
          )}
        </ShimmerButton>
      </div>
    </div>
  );
}
