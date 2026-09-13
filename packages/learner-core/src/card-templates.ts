/**
 * M7-2 learner-core 卡片模板兼容出口：实现在 `@study-studio/flashcards`
 * （C5 起规范源；原 flashcard-core 已并入），此处仅作具名重导出，
 * 既有消费者（Gateway apkg-export、Web、外部 import）行为不变。
 *
 * @deprecated 方向性垫片：新代码请直引 `@study-studio/flashcards` 统一入口；
 * 本文件排入 C6 删除，届时消费者同步迁移。
 */
export {
  FIELD_MARKERS,
  escapeHtml,
  buildCardContext,
  renderFieldTemplate,
  extractFieldMarkers,
  validateFieldTemplate,
  extractCardFields,
  renderClozeText,
  renderCardTemplate,
  validateCardTemplate,
  renderCard,
  validateCardFormat,
  BUILTIN_CARD_FORMATS,
  getBuiltinCardFormat,
  guessFieldMapping,
  analyzeTemplateCompat,
  type FieldMarker,
  type CardContext,
  type CardSourceEntry,
  type AnkiCardFormat,
  type RenderedCard,
  type CardRenderExtra,
} from '@study-studio/flashcards';
