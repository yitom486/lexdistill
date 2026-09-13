/**
 * M6-2 learner-core 练习计划兼容出口：实现已迁入 `@study-studio/practice-core`，
 * 此处仅作具名重导出，既有消费者（Gateway practice、activity-plan、外部 import）行为不变。
 */
export {
  SUBJECTIVE_BATCH_MAX_COUNT,
  SUBJECTIVE_BATCH_MAX_CHARS,
  isPracticeBlockKind,
  isGradingMode,
  validateBlockSpec,
  validatePracticePlanTemplate,
  validatePracticePlanSchedule,
  isTemplateDueOn,
  freezeRunFromTemplate,
  isRunComplete,
  parsePracticeBlockSpec,
  parsePracticeBlockSpecs,
} from '@study-studio/practice-core';
