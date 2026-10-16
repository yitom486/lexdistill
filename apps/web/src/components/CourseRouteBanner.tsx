import React, { useState } from 'react';
import { courseUnitPlanStep } from '@lexdistill/learner-core';
import { Check, ChevronDown, Footprints, Lock, RotateCcw } from 'lucide-react';
import { sound } from '../utils/audio.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import {
  courseStageName,
  useCourseRouteQuery,
  type CourseRouteUnit,
} from '../queries/useLearnerQueries.js';
import { groupUnitsByStage } from '../utils/course-route-view.js';
import { cn } from '../lib/utils.js';
import { Progress } from './ui/progress.js';
import { Badge } from './ui/badge.js';

/**
 * 长期学程里程碑：嵌入今日晨报 Hero 的内联模块，不再单开全宽大框。
 * 里程碑 chips + 内联复习胶囊 + 可展开完整路线；失败/空时静默隐藏，不挡计划。
 * 挂载于今日学习页 Hero 内部（TodayPlanWorkbench），不占导航。
 */
export function CourseRouteBanner({ className }: { className?: string | undefined }) {
  const { data: route } = useCourseRouteQuery();
  const startPlanStep = useStudySessionStore((s) => s.startPlanStep);
  const [expanded, setExpanded] = useState(false);
  if (!route || route.units.length === 0) return null;
  const nextUp = route.units.find((u) => u.unit.id === route.nextUpId) ?? null;
  const mastered = route.units.filter((u) => u.status === 'mastered').length;
  const reviewList = route.units.filter((u) => u.status === 'mastered' && u.needsReview);
  const stage = nextUp ? nextUp.unit.stage : (route.units[route.units.length - 1]?.unit.stage ?? 0);
  const goUnit = (u: CourseRouteUnit) => {
    sound.playClick();
    startPlanStep(courseUnitPlanStep(u.unit));
  };
  const stages = expanded ? groupUnitsByStage(route.units) : [];
  return (
    <section aria-label="长期学程里程碑" className={cn('border-t border-line-hairline pt-4 space-y-2.5', className)}>
      <div className="flex items-center gap-2.5">
        <div className="surface-elevated w-8 h-8 rounded-lg flex items-center justify-center shrink-0">
          <Footprints className="w-4 h-4 text-gold-warm" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
          <span className="font-mono text-[10px] px-1.5 py-px rounded border border-line-hairline bg-surface/80 text-ink-faint-soft shrink-0">
            {courseStageName(stage)}
          </span>
          <span className="font-mono text-[11px] text-ink-faint-soft shrink-0">
            已掌握 {mastered}/{route.units.length} 单元
          </span>
        </div>
        {nextUp && (
          <button
            type="button"
            onClick={() => goUnit(nextUp)}
            className="shrink-0 inline-flex items-center h-7 px-2.5 rounded-lg text-xs font-bold text-gold-warm border border-gold-warm/30 hover:bg-gold-warm/10 transition-colors cursor-pointer active:scale-[0.97]"
          >
            去学 →
          </button>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink truncate">
          {nextUp ? `下一步：${nextUp.unit.title}` : '本轨道路线已走完，保持复习即可'}
        </h3>
        {nextUp && (
          <p className="text-[11px] text-ink-ghost mt-0.5 leading-relaxed">
            {nextUp.unit.summary}（{nextUp.progress}）
          </p>
        )}
      </div>
      <Progress
        value={Math.round((mastered / Math.max(route.units.length, 1)) * 100)}
        className="h-1"
        indicatorClassName="bg-tone-emerald-500"
      />
      {reviewList.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gold-warm/20 bg-gold-warm/10 px-2.5 py-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold-warm">
            <RotateCcw className="w-3 h-3" />
            建议复习：
          </span>
          {reviewList.map((u) => (
            <button
              key={u.unit.id}
              type="button"
              onClick={() => goUnit(u)}
              className="rounded-full border border-gold-warm/30 px-2 py-0.5 text-[11px] text-ink hover:bg-gold-warm/10 transition-colors cursor-pointer"
              title="近期有错误，回去练两道"
            >
              {u.unit.title}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          sound.playClick();
          setExpanded((v) => !v);
        }}
        className="inline-flex items-center gap-1 text-[11px] text-ink-faint-soft hover:text-ink transition-colors cursor-pointer"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        {expanded ? '收起完整路线' : '展开完整路线'}
      </button>
      {expanded && (
        <div className="space-y-3 pt-1">
          {stages.map((g) => (
            <div key={g.stage} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-ink-mute-deep">
                  {courseStageName(g.stage)}
                </p>
                <span className="font-mono text-[10px] text-ink-faint-soft">
                  {g.mastered}/{g.total}
                </span>
              </div>
              <Progress
                value={Math.round((g.mastered / Math.max(g.total, 1)) * 100)}
                className="h-1"
                indicatorClassName="bg-tone-emerald-500"
              />
              <ul className="space-y-1">
                {g.units.map((u) => (
                  <li
                    key={u.unit.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line-hairline px-2.5 py-1.5"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {u.status === 'mastered' ? (
                        <Check className="w-3.5 h-3.5 shrink-0 text-tone-emerald-600" />
                      ) : u.status === 'available' ? (
                        <span className="w-3.5 h-3.5 shrink-0 rounded-full bg-gold-warm/70" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 shrink-0 text-ink-hint" />
                      )}
                      {u.status === 'available' ? (
                        <button
                          type="button"
                          onClick={() => goUnit(u)}
                          className="truncate text-xs font-semibold text-ink hover:underline transition-colors cursor-pointer"
                          title={u.unit.summary}
                        >
                          {u.unit.title}
                        </button>
                      ) : (
                        <span
                          className="truncate text-xs text-ink-ghost"
                          title={u.unit.summary}
                        >
                          {u.unit.title}
                        </span>
                      )}
                      {u.status === 'mastered' && u.needsReview && (
                        <Badge variant="amber" className="text-[10px] shrink-0">
                          需复习
                        </Badge>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint-soft">{u.progress}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[10px] text-ink-faint-soft">
            后续单元按前置自动解锁；已掌握永不收回，近期错误只提示复习。
          </p>
        </div>
      )}
    </section>
  );
}
