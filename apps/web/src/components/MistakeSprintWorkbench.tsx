import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Flame,
  Bot,
  Award,
} from 'lucide-react';
import { sound } from '../utils/audio.js';
import { toast } from 'sonner';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { useMistakesQuery, useUpdateMistakeMutation } from '../queries/useLearnerQueries.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { ShimmerButton } from './magicui/index.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';

interface MistakeSprintWorkbenchProps {
  onOpenTutor: (context: AiTutorContext) => void;
}

export const MistakeSprintWorkbench: React.FC<MistakeSprintWorkbenchProps> = ({
  onOpenTutor,
}) => {
  const { data: mistakes = [] } = useMistakesQuery();
  const updateMistake = useUpdateMistakeMutation();

  const [filterState, setFilterState] = useState<'ALL' | 'UNRESOLVED' | 'RESOLVED'>('UNRESOLVED');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [isSprintActive, setIsSprintActive] = useState(false);
  const [sprintIndex, setSprintIndex] = useState(0);
  const [sprintAnswer, setSprintAnswer] = useState('');
  const [sprintFeedback, setSprintFeedback] = useState<{
    submitted: boolean;
    isCorrect: boolean;
  } | null>(null);

  // 提取所有唯一标签
  const uniqueTags = Array.from(new Set(mistakes.map((m) => m.categoryTag)));

  const filteredMistakes = mistakes.filter((m) => {
    const stateMatch =
      filterState === 'ALL' ? true : filterState === 'UNRESOLVED' ? !m.isResolved : m.isResolved;
    const tagMatch = selectedTag === 'ALL' ? true : m.categoryTag === selectedTag;
    return stateMatch && tagMatch;
  });

  const unresolvedMistakes = mistakes.filter((m) => !m.isResolved);
  const resolvedMistakes = mistakes.filter((m) => m.isResolved);

  // 当前冲刺中的题目
  const activeSprintItem = unresolvedMistakes[sprintIndex];

  // 启动错题冲刺
  const handleStartSprint = () => {
    if (unresolvedMistakes.length === 0) {
      toast.success('太棒了！当前没有任何未攻克的错题！');
      return;
    }
    sound.playClick();
    setIsSprintActive(true);
    setSprintIndex(0);
    setSprintAnswer('');
    setSprintFeedback(null);
  };

  // 退出冲刺
  const handleExitSprint = () => {
    sound.playClick();
    setIsSprintActive(false);
    setSprintFeedback(null);
  };

  // 提交冲刺作答
  const handleSubmitSprintAnswer = () => {
    if (!sprintAnswer.trim() || !activeSprintItem) return;

    const trimmed = sprintAnswer.trim();
    const isCorrect =
      trimmed.toLowerCase() === activeSprintItem.correctAnswer.toLowerCase();

    setSprintFeedback({ submitted: true, isCorrect });
    updateMistake.mutate(
      { mistakeId: activeSprintItem.id, isCorrect },
      {
        onSuccess: (result) => {
          if (isCorrect) {
            sound.playSuccess();
            toast.success(
              result.isResolved
                ? '🎉 连续 2 次正确！该题已彻底攻克出库！'
                : `回答正确！连对进度 ${result.consecutiveCorrect}/2`
            );
          } else {
            sound.playError();
            toast.error(`回答有误：正确应为「${activeSprintItem.correctAnswer}」`);
          }
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : '更新错题订正状态失败，请稍后重试。';
          toast.error(message);
        },
      }
    );
  };

  const handleNextSprintItem = () => {
    sound.playClick();
    setSprintAnswer('');
    setSprintFeedback(null);
    if (sprintIndex < unresolvedMistakes.length - 1) {
      setSprintIndex((prev) => prev + 1);
    } else {
      setIsSprintActive(false);
      toast.success('🎯 错题冲刺轮练已全部完成！');
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
      <PlanIntentBanner />
      {/* 顶部总览与冲刺卡片 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-paper-soft p-5 rounded-2xl border border-line-accent shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-wash-amber-500o15 border border-line-amber-500o30 text-ink-amber-900-amber-300 flex items-center justify-center font-bold">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold font-serif text-ink">
                错题本智能归因与专项攻克
              </h2>
              <Badge variant="amber" className="text-[11px] border-tone-amber-500o20">
                两连对出库标准
              </Badge>
            </div>
            <p className="text-xs text-ink-ghost">
              待攻克: {unresolvedMistakes.length} 题 · 已攻克: {resolvedMistakes.length} 题
            </p>
          </div>
        </div>

        {/* 快速发起冲刺大按钮 */}
        {!isSprintActive && unresolvedMistakes.length > 0 && (
          <ShimmerButton onClick={handleStartSprint} className="px-5 py-2.5 text-xs font-bold">
            <Flame className="w-4 h-4" />
            <span>⚡ 发起错题定向冲刺 ({unresolvedMistakes.length})</span>
          </ShimmerButton>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 冲刺专注训练工作台 (Sprint View)                                          */}
      {/* ========================================================================= */}
      <AnimatePresence mode="wait">
        {isSprintActive && activeSprintItem && (
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
                <Badge>🔥 错题冲刺中</Badge>
                <span className="text-xs text-ink-stone-500 font-mono">
                  第 {sprintIndex + 1} / {unresolvedMistakes.length} 题
                </span>
                <Badge variant="secondary">考点: {activeSprintItem.categoryTag}</Badge>
              </div>

              <Button variant="ghost" size="sm" onClick={handleExitSprint}>
                退出冲刺模式 ✕
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
              <label className="text-xs font-semibold text-ink-faint-soft">
                请键入正确的助词或选项答案：
              </label>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <input
                  type="text"
                  value={sprintAnswer}
                  onChange={(e) => setSprintAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !sprintFeedback?.submitted) {
                      handleSubmitSprintAnswer();
                    }
                  }}
                  disabled={sprintFeedback?.submitted}
                  placeholder="在此输入订正后的答案..."
                  className="flex-1 w-full px-4 py-3 rounded-xl bg-surface-warm border border-line-amber-900o20-amber-500o20 text-ink font-medium outline-none focus:ring-2 focus:ring-tone-amber-500 shadow-xs"
                />

                {!sprintFeedback?.submitted ? (
                  <Button onClick={handleSubmitSprintAnswer} className="w-full sm:w-auto h-11 px-6 shrink-0">
                    验证答案 ➔
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={handleNextSprintItem}
                    className="w-full sm:w-auto h-11 px-6 shrink-0 bg-surface-stone-900-amber-600 text-tone-white hover:brightness-110"
                  >
                    {sprintIndex < unresolvedMistakes.length - 1 ? '下一题 ➔' : '完成冲刺 ➔'}
                  </Button>
                )}
              </div>
            </div>

            {/* 反馈卡片与 AI 诊断 */}
            {sprintFeedback?.submitted && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-xl border text-xs space-y-3 ${ sprintFeedback.isCorrect ? 'bg-wash-emerald-500o10 border-line-emerald-500o30 text-ink-emerald-900-emerald-200' : 'bg-wash-rose-500o10 border-line-rose-500o30 text-ink-rose-900-rose-200' }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {sprintFeedback.isCorrect ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-tone-emerald-600" />
                        <span>订正正确！当前攻克进度稳步提升</span>
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

                <p className="text-ink-mute font-sans leading-relaxed">
                  💡 {activeSprintItem.reviewNote}
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* 错题列表检索与分类归因视图                                                */}
      {/* ========================================================================= */}
      {!isSprintActive && (
        <div className="flex flex-col gap-4">
          {/* 筛选控制器 */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <Tabs
              value={filterState}
              onValueChange={(val) => {
                if (!val) return;
                sound.playClick();
                setFilterState(val as typeof filterState);
              }}
            >
              <TabsList className="bg-veil-stone-200o60-stone-900">
                <TabsIndicator />
                <TabsTrigger value="ALL" className="px-3 py-1 text-xs">
                  全部 ({mistakes.length})
                </TabsTrigger>
                <TabsTrigger value="UNRESOLVED" className="px-3 py-1 text-xs">
                  待攻克 ({unresolvedMistakes.length})
                </TabsTrigger>
                <TabsTrigger value="RESOLVED" className="px-3 py-1 text-xs">
                  已攻克 ({resolvedMistakes.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-1 overflow-x-auto max-w-full">
              <Button
                variant={selectedTag === 'ALL' ? 'amber' : 'ghost'}
                size="sm"
                onClick={() => setSelectedTag('ALL')}
                className="h-7"
              >
                所有考点
              </Button>
              {uniqueTags.map((tag) => (
                <Button
                  key={tag}
                  variant={selectedTag === tag ? 'amber' : 'ghost'}
                  size="sm"
                  onClick={() => setSelectedTag(tag)}
                  className="h-7 shrink-0"
                >
                  {tag}
                </Button>
              ))}
            </div>
          </div>

          {/* 错题卡片流 */}
          <div className="space-y-3">
            {filteredMistakes.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-paper-soft border border-line-accent space-y-2">
                <Award className="w-8 h-8 text-tone-amber-500 mx-auto" />
                <p className="text-sm font-semibold text-ink-soft">
                  当前分类下没有匹配的错题！
                </p>
                <p className="text-xs text-ink-stone-400">保持全对节奏，持续稳固记忆曲线</p>
              </div>
            ) : (
              filteredMistakes.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-5 rounded-2xl bg-paper-soft border border-line-accent shadow-2xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="amber">{m.categoryTag}</Badge>
                      {m.isResolved ? (
                        <Badge variant="emerald" className="gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          已攻克
                        </Badge>
                      ) : (
                        <Badge variant="amber" className="font-mono">
                          连续订正进度: {m.consecutiveCorrect}/2
                        </Badge>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onOpenTutor({
                          questionText: m.sentence,
                          userAnswer: m.userWrongAnswer,
                          correctAnswer: m.correctAnswer,
                          skillTag: m.categoryTag,
                          explanation: m.reviewNote,
                        })
                      }
                      className="text-accent-ink-warm"
                    >
                      <Bot className="w-3.5 h-3.5" />
                      <span>AI 错因深度诊断</span>
                    </Button>
                  </div>

                  <div className="text-sm font-medium text-ink font-serif">
                    {m.sentence}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-wash-rose-500o10 text-ink-rose-800-rose-300 space-y-0.5">
                      <span className="font-bold">您的历史错误答复：</span>
                      <p className="font-mono">{m.userWrongAnswer || '(未填)'}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-wash-emerald-500o10 text-ink-emerald-800-emerald-300 space-y-0.5">
                      <span className="font-bold">权威标准考点答案：</span>
                      <p className="font-mono">{m.correctAnswer}</p>
                    </div>
                  </div>

                  <p className="text-xs text-ink-faint-soft font-sans leading-relaxed">
                    💡 <span className="font-medium">错因解析：</span>
                    {m.reviewNote}
                  </p>
                </motion.div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
