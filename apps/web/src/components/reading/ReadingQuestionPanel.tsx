import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Bot, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Progress } from '../ui/progress.js';
import { sound } from '../../utils/audio.js';
import type { AiTutorContext } from '../AiTutorDrawer.js';
import type { ReadingSession } from './useReadingSession.js';

interface QuestionPanelProps {
  session: ReadingSession;
  onOpenTutor?: ((ctx: AiTutorContext) => void) | undefined;
}

/** 右侧题目自测区（纯展示）：进度、选项、解析、导航与导师追问。 */
export function ReadingQuestionPanel({ session, onOpenTutor }: QuestionPanelProps) {
  const { activeSet, question, totalQuestions, progressPct, stepIndex, selected, submitted, score, plainBody } = session;
  if (!activeSet || !question) {
    return (
      <div className="h-full rounded-2xl border border-dashed border-line-amber-900o20-amber-500o20 bg-paper-soft flex flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-ink-stone-500">暂无配题 · 生成篇目后将在此作答</p>
      </div>
    );
  }
  return (
    <div className="h-full rounded-2xl border border-line-accent bg-paper-soft shadow-xs flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line-accent space-y-2">
        <div className="flex items-center justify-between text-xs text-ink-stone-500">
          <span className="font-mono">
            第 {stepIndex + 1} / {totalQuestions} 题
          </span>
          <span className="text-accent-ink-warm font-medium">
            本篇已答对 {score} 题
          </span>
        </div>
        <Progress value={progressPct} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {question ? (
          <>
            <p className="text-sm font-semibold text-ink leading-relaxed">
              {question.prompt}
            </p>
            <div className="space-y-2" role="group" aria-label="选择答案">
              {question.options.map((opt) => {
                const isSel = selected === opt.key;
                const showOk = submitted && opt.key === question.correctAnswer;
                const showBad = submitted && isSel && opt.key !== question.correctAnswer;
                return (
                  <Button
                    key={opt.key}
                    type="button"
                    variant="outline"
                    disabled={submitted}
                    aria-pressed={isSel}
                    onClick={() => {
                      sound.playClick();
                      session.setSelected(opt.key);
                    }}
                    className={`h-auto w-full justify-start px-3 py-3 text-left font-normal transition-colors ${ showOk ? 'border-tone-emerald-500 bg-wash-emerald-500o10 text-ink-emerald-950 dark:text-tint-emerald-100' : showBad ? 'border-tone-rose-500 bg-wash-rose-500o10 text-ink-rose-950 dark:text-tint-rose-100' : isSel ? 'border-tone-amber-500 bg-wash-amber-500o10 font-medium' : '' }`}
                  >
                    <Badge variant="secondary" className="mr-2 font-mono shrink-0">
                      {opt.key}
                    </Badge>
                    <span className="text-sm">{opt.text}</span>
                    {showOk && (
                      <CheckCircle2 className="w-4 h-4 ml-auto text-tone-emerald-600 shrink-0" />
                    )}
                    {showBad && <XCircle className="w-4 h-4 ml-auto text-ink-rose-600 shrink-0" />}
                  </Button>
                );
              })}
            </div>

            {submitted && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl text-xs leading-relaxed bg-wash-amber-500o10 border border-tone-amber-500o20 text-ink-mute"
              >
                <p className="flex items-start gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{question.explanation}</span>
                </p>
              </motion.div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-sm text-ink-stone-400">
            暂无配套阅读理解题目
          </div>
        )}
      </div>

      <div className="p-3 border-t border-line-accent flex flex-wrap items-center gap-2 justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={stepIndex === 0 || session.completionPending}
          onClick={session.handlePrevQuestion}
        >
          <ChevronLeft className="w-4 h-4" /> 上一题
        </Button>

        <div className="flex items-center gap-2">
          {onOpenTutor && submitted && question && (
            <Button
              variant="amber"
              size="sm"
              onClick={() =>
                onOpenTutor({
                  questionText: `【阅读理解】篇目《${activeSet.title}》：${question.prompt}`,
                  userAnswer: selected ?? undefined,
                  correctAnswer: question.correctAnswer,
                  skillTag: '长文阅读理解',
                  explanation: `篇目正文：“${plainBody.slice(0, 100)}...”\n\n题目解析：“${question.explanation}”`,
                })
              }
            >
              <Bot className="w-3.5 h-3.5" /> 追问导师
            </Button>
          )}

          {!submitted ? (
            <Button size="sm" disabled={!selected} onClick={session.handleSubmitAnswer}>
              提交本题
            </Button>
          ) : (
            <Button size="sm" disabled={session.completionPending} onClick={session.handleNextQuestion}>
              {session.completionPending ? '保存成绩中…' : stepIndex < totalQuestions - 1 ? '下一题' : '完成本篇'}
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      {session.completionError && <p role="alert" className="px-4 pb-3 text-xs text-ink-rose-600">{session.completionError}；答案已保留，可再次完成本篇。</p>}
    </div>
  );
}
