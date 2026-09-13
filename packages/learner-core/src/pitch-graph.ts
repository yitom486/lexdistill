/**
 * M7-2 learner-core 声调图兼容出口：实现已迁入 `@study-studio/flashcard-core`，
 * 此处仅作具名重导出，既有消费者（Web、外部 import）行为不变。
 */
export {
  splitMorae,
  moraPitchPattern,
  buildPitchGraphSvg,
  type PitchGraphOptions,
} from '@study-studio/flashcard-core';
