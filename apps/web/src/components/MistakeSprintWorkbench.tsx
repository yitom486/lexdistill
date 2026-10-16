import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Flame } from 'lucide-react';
import { sound } from '../utils/audio.js';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { useMistakesQuery } from '../queries/useLearnerQueries.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { ShimmerButton } from './magicui/index.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';
import { useMistakeSprint } from './mistake-sprint/useMistakeSprint.js';
import { SprintRunner } from './mistake-sprint/SprintRunner.js';
import { MistakeList, type MistakeFilterState } from './mistake-sprint/MistakeList.js';

interface MistakeSprintWorkbenchProps {
  onOpenTutor: (context: AiTutorContext) => void;
}

/**
 * 错题冲刺工作台：容器只做查询状态与筛选编排，
 * 冲刺交互归 useMistakeSprint，展示归 SprintRunner/MistakeList。
 */
export const MistakeSprintWorkbench: React.FC<MistakeSprintWorkbenchProps> = ({
  onOpenTutor,
}) => {
  const mistakesQuery = useMistakesQuery();
  const mistakes = mistakesQuery.data ?? [];

  const [filterState, setFilterState] = useState<MistakeFilterState>('UNRESOLVED');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');

  const unresolvedMistakes = mistakes.filter((m) => !m.isResolved);
  const resolvedMistakes = mistakes.filter((m) => m.isResolved);
  const sprint = useMistakeSprint(unresolvedMistakes);

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
                错题归因与专项攻克
              </h2>
              <Badge variant="amber" className="text-xs border-tone-amber-500o20">
                两连对出库标准
              </Badge>
            </div>
            <p className="text-xs text-ink-ghost">
              {mistakesQuery.isPending ? (
                '正在读取错题本…'
              ) : mistakesQuery.isError ? (
                '错题本读取失败'
              ) : (
                <>待攻克: {unresolvedMistakes.length} 题 · 已攻克: {resolvedMistakes.length} 题</>
              )}
            </p>
          </div>
        </div>

        {/* 快速发起冲刺大按钮 */}
        {!sprint.isSprintActive && unresolvedMistakes.length > 0 && (
          <ShimmerButton onClick={sprint.handleStartSprint} className="px-5 py-2.5 text-xs font-bold">
            <Flame className="w-4 h-4" />
            <span>发起错题定向冲刺 ({unresolvedMistakes.length})</span>
          </ShimmerButton>
        )}
      </div>

      {mistakesQuery.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-ink-ghost">
          正在读取错题本…
        </p>
      ) : mistakesQuery.isError && !mistakesQuery.data?.length && !sprint.isSprintActive ? (
        <div role="alert" className="py-10 text-center text-sm text-ink-ghost space-y-2">
          <p>错题本读取失败，请检查网关后重试。</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void mistakesQuery.refetch()} className="gap-1 text-xs">
            重新读取
          </Button>
        </div>
      ) : (
        <>
        {mistakesQuery.isError && <p role="alert" className="text-xs text-ink-ghost">更新错题本失败，当前练习和已读取内容仍保留。<Button type="button" size="sm" variant="outline" onClick={() => void mistakesQuery.refetch()}>重新读取</Button></p>}
        <AnimatePresence mode="wait">
          {sprint.isSprintActive && sprint.activeSprintItem ? (
            <SprintRunner key="sprint" sprint={sprint} onOpenTutor={onOpenTutor} />
          ) : !sprint.isSprintActive ? (
            <motion.div key="list">
              <MistakeList
                mistakes={mistakes}
                unresolvedCount={unresolvedMistakes.length}
                resolvedCount={resolvedMistakes.length}
                filterState={filterState}
                onFilterChange={(v) => {
                  sound.playClick();
                  setFilterState(v);
                }}
                selectedTag={selectedTag}
                onSelectTag={(tag) => {
                  sound.playClick();
                  setSelectedTag(tag);
                }}
                onOpenTutor={onOpenTutor}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        </>
      )}
    </div>
  );
};
