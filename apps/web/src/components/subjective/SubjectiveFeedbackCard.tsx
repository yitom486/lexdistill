import { motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Lightbulb, RotateCcw } from 'lucide-react';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import type { SubjectiveGrading } from './useSubjectiveGrading.js';

interface FeedbackCardProps {
  grading: SubjectiveGrading;
}

/** 批改反馈卡（纯展示）：评分、讲解、范例与再练入口。 */
export function SubjectiveFeedbackCard({ grading }: FeedbackCardProps) {
  const result = grading.gradingResult;
  if (!result) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="space-y-3"
    >
      <div
        className={`p-4 rounded-2xl border transition-colors ${ result.isCorrect ? 'bg-wash-emerald-50o80 border-line-emerald-500o30 dark:bg-wash-emerald-950o20' : 'bg-wash-rose-50o80 border-line-rose-500o30 dark:bg-wash-rose-950o20' }`}
      >
        <div className="flex items-center gap-2 mb-2">
          {result.isCorrect ? (
            <CheckCircle2 className="w-4 h-4 text-tone-emerald-600" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-ink-rose-600" />
          )}
          <span className="text-sm font-bold">
            综合评分 {result.score}
          </span>
          <Badge variant="secondary" className="text-xs">
            {result.isCorrect ? '通过' : '需巩固'}
          </Badge>
        </div>
        <p className="text-sm text-ink-mute">
          {result.explanation}
        </p>
        {result.refinementSuggestion && (
          <p className="text-xs mt-2 text-ink-stone-500 flex items-start gap-1.5">
            <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            范例：{result.refinementSuggestion}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={grading.resetAnswer}
      >
        <RotateCcw className="w-3.5 h-3.5" />
        再练一题
      </Button>
    </motion.div>
  );
}
