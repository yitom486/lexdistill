import type { DailyPlanStepTemplate } from './daily-plan.js';
import type { CourseUnit } from './course-units.js';

/** 今日任务与路线入口共用同一份单元活动，避免分别维护跳转逻辑。 */
export function courseUnitPlanStep(unit: CourseUnit): DailyPlanStepTemplate {
  return {
    id: `step_unit_${unit.id}`,
    courseUnitId: unit.id,
    kind: unit.activity.planKind,
    title: unit.title,
    summary: unit.summary,
    navigateTo: unit.activity.navigateTo,
    skillId: unit.activity.skillId,
    skillName: unit.activity.skillName,
    targetCount: unit.activity.targetCount,
  };
}

/** 按单元证据选词；前 20 词与路线判定使用同一 entryId 顺序。 */
export function selectCourseWords<T extends { entryId: string }>(unit: CourseUnit, groups: Array<{ id: string; words: T[] }>): T[] {
  const rule = unit.evidence;
  if (rule.type !== 'words-studied') return [];
  if (rule.entryIds) {
    const byId = new Map(groups.flatMap(g => g.words.map(w => [w.entryId, w] as const)));
    return rule.entryIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  }
  const words = [...(groups.find(g => g.id === rule.group)?.words ?? [])];
  words.sort((a, b) => a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);
  return words.slice(0, rule.take ?? words.length);
}
