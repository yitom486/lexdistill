import { motion } from 'framer-motion';
import { CheckCircle2, Award, Bot, Lightbulb } from 'lucide-react';
import { sound } from '../../utils/audio.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from '../ui/tabs.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import type { MistakeNotebookItem } from '../../models/learning.js';
import type { AiTutorContext } from '../AiTutorDrawer.js';

export type MistakeFilterState = 'ALL' | 'UNRESOLVED' | 'RESOLVED';

interface MistakeListProps {
  mistakes: MistakeNotebookItem[];
  unresolvedCount: number;
  resolvedCount: number;
  filterState: MistakeFilterState;
  onFilterChange: (v: MistakeFilterState) => void;
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  onOpenTutor: (context: AiTutorContext) => void;
}

/** 错题列表检索与分类归因视图（纯展示）：筛选器 + 错题卡片流。 */
export function MistakeList({
  mistakes,
  unresolvedCount,
  resolvedCount,
  filterState,
  onFilterChange,
  selectedTag,
  onSelectTag,
  onOpenTutor,
}: MistakeListProps) {
  const uniqueTags = Array.from(new Set(mistakes.map((m) => m.categoryTag)));
  const filteredMistakes = mistakes.filter((m) => {
    const stateMatch =
      filterState === 'ALL' ? true : filterState === 'UNRESOLVED' ? !m.isResolved : m.isResolved;
    const tagMatch = selectedTag === 'ALL' ? true : m.categoryTag === selectedTag;
    return stateMatch && tagMatch;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* 筛选控制器 */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <Tabs
          value={filterState}
          onValueChange={(val) => {
            if (!val) return;
            sound.playClick();
            onFilterChange(val as MistakeFilterState);
          }}
        >
          <TabsList className="bg-veil-stone-200o60-stone-900">
            <TabsIndicator />
            <TabsTrigger value="ALL" className="px-3 py-1 text-xs">
              全部 ({mistakes.length})
            </TabsTrigger>
            <TabsTrigger value="UNRESOLVED" className="px-3 py-1 text-xs">
              待攻克 ({unresolvedCount})
            </TabsTrigger>
            <TabsTrigger value="RESOLVED" className="px-3 py-1 text-xs">
              已攻克 ({resolvedCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1 overflow-x-auto max-w-full">
          <Button
            variant={selectedTag === 'ALL' ? 'amber' : 'ghost'}
            size="sm"
            onClick={() => onSelectTag('ALL')}
            className="h-7"
          >
            所有考点
          </Button>
          {uniqueTags.map((tag) => (
            <Button
              key={tag}
              variant={selectedTag === tag ? 'amber' : 'ghost'}
              size="sm"
              onClick={() => onSelectTag(tag)}
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
              当前分类下没有匹配的错题
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

              <p className="text-xs text-ink-faint-soft font-sans leading-relaxed flex items-start gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                  <span className="font-medium">错因解析：</span>
                  {m.reviewNote}
                </span>
              </p>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
