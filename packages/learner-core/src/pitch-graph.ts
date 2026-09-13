/**
 * M7-2 learner-core 声调图兼容出口：实现在 `@study-studio/flashcards`
 * （C5 起规范源；原 flashcard-core 已并入），此处仅作具名重导出，
 * 既有消费者（Web、外部 import）行为不变。
 *
 * @deprecated 方向性垫片：新代码请直引 `@study-studio/flashcards` 统一入口；
 * 本文件排入 C6 删除，届时消费者同步迁移。
 */
export {
  splitMorae,
  moraPitchPattern,
  buildPitchGraphSvg,
  type PitchGraphOptions,
} from '@study-studio/flashcards';
