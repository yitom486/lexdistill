/**
 * M6-1 learner-core 复习排程兼容出口：实现已迁入 `@study-studio/review-core`，
 * 此处仅作类型与函数重导出，既有消费者（kana-adaptive、外部 import）行为不变。
 */
export { scheduleFsrsReviewV1, type FsrsReviewInput } from '@study-studio/review-core';
