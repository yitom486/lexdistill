/**
 * M6-2 learner-core 测评蓝图兼容出口：实现已迁入 `@study-studio/practice-core`，
 * 此处仅作具名重导出，既有消费者（Gateway placement、外部 import）行为不变。
 */
export {
  ASSESSMENT_BLUEPRINT_VERSION,
  blueprintFor,
  attributeGroup,
  evaluateExamVerdict,
  type BlueprintGroup,
  type AssessmentBlueprint,
  type GroupSubscore,
  type ExamVerdict,
} from '@study-studio/practice-core';
