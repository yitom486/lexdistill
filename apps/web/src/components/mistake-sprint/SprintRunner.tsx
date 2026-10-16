import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Flame, Bot, Lightbulb } from 'lucide-react';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import type { AiTutorContext } from '../AiTutorDrawer.js';
import type { MistakeSprint } from './useMistakeSprint.js';

interface SprintRunnerProps {
  sprint: MistakeSprint;
  onOpenTutor: (context: AiTutorContext) => void;
}

/** 冲刺专注训练视图（纯展示）：快照队列内推进，提交期禁用重复提交。 */
export function SprintRunner({ sprint, onOpenTutor }: SprintRunnerProps) {
  const { activeSprintItem, sprintQueue, sprintIndex, sprintAnswer, sprintFeedback, submitPending } = sprint;
  if (!activeSprintItem) return null;
  const submitted = sprintFeedback?.submitted ?? false;
  // 回执落定前不推进：保存结果以服务端为准，失败时留在本题可重试
  const settled = sprintFeedback?.saved && !submitPending;
  return (
    <motion.div
      key={activeSprintItem.id}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="p-6 sm:p-8 rounded-2xl bg-paper-soft border-2 border-tone-amber-500o40 shadow-md space-y-6"
    >
      {/* 冲刺顶栏导航 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className="gap-1">
            <Flame className="w-3.5 h-3.5" />
            错题冲刺中
          </Badge>
          <span className="text-xs text-ink-stone-500 font-mono">
            第 {sprintIndex + 1} / {sprintQueue.length} 题
          </span>
          <Badge variant="secondary">考点: {activeSprintItem.categoryTag}</Badge>
        </div>

        <Button variant="ghost" size="sm" onClick={sprint.handleExitSprint}>
          退出冲刺模式
        </Button>
      </div>

      {/* 题目内容展示 */}
      <div className="space-y-3 py-3">
        <p className="text-xs text-ink-stone-500 font-medium">{activeSprintItem.prompt}</p>
        <h3 className="text-xl sm:text-2xl font-serif font-bold text-ink">
          {activeSprintItem.sentence}
        </h3>
      </div>

      {/* 作答输入框 */}
      <div className="space-y-2">
        {sprint.saveError && <p role="alert" className="text-xs text-ink-rose-600">{sprint.saveError}；答案已保留，请重新验证。</p>}
        <label className="text-xs font-semibold text-ink-faint-soft" htmlFor="sprint-answer">
          请键入正确的助词或选项答案：
        </label>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <input
            id="sprint-answer"
            type="text"
            value={sprintAnswer}
            onChange={(e) => sprint.setSprintAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitted && !submitPending) {
                sprint.handleSubmitSprintAnswer();
              }
            }}
            disabled={submitted || submitPending}
            placeholder="在此输入订正后的答案..."
            className="flex-1 w-full px-4 py-3 rounded-xl bg-surface-warm border border-line-amber-900o20-amber-500o20 text-ink font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring shadow-xs"
          />

          {!settled ? (
            <Button
              onClick={sprint.handleSubmitSprintAnswer}
              disabled={!sprintAnswer.trim() || submitPending}
              className="w-full sm:w-auto h-11 px-6 shrink-0"
            >
              {submitPending ? '提交中…' : '验证答案'}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={sprint.handleNextSprintItem}
              className="w-full sm:w-auto h-11 px-6 shrink-0 bg-surface-stone-900-amber-600 text-tone-white hover:brightness-110"
            >
              {sprintIndex < sprintQueue.length - 1 ? '下一题' : '完成冲刺'}
            </Button>
          )}
        </div>
      </div>

      {/* 反馈卡片与 AI 诊断（本地即时判定；连对/出库以服务端回执 toast 为准） */}
      {sprintFeedback?.submitted && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl border text-xs space-y-3 ${ sprintFeedback.isCorrect ? 'bg-wash-emerald-500o10 border-line-emerald-500o30 text-ink-emerald-900-emerald-200' : 'bg-wash-rose-500o10 border-line-rose-500o30 text-ink-rose-900-rose-200' }`}
        >
          {submitPending && (
            <p role="status" className="text-xs text-ink-ghost">正在保存订正结果…</p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-sm">
              {sprintFeedback.isCorrect ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-tone-emerald-600" />
                  <span>{sprintFeedback.saved ? '订正正确，结果已保存' : '本次答案正确，等待保存'}</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-ink-rose-600" />
                  <span>仍有偏差：标准答案为「{activeSprintItem.correctAnswer}」</span>
                </>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onOpenTutor({
                  questionText: activeSprintItem.sentence,
                  userAnswer: sprintAnswer,
                  correctAnswer: activeSprintItem.correctAnswer,
                  skillTag: activeSprintItem.categoryTag,
                  explanation: activeSprintItem.reviewNote,
                })
              }
              className="text-accent-ink-warm"
            >
              <Bot className="w-4 h-4" />
              <span>向 AI 导师追问</span>
            </Button>
          </div>

          <p className="text-ink-mute font-sans leading-relaxed flex items-start gap-1.5">
            <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{activeSprintItem.reviewNote}</span>
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
