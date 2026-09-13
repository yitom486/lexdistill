/**
 * M7-2 learner-core 卡片模板兼容出口：实现已迁入 `@study-studio/flashcard-core`，
 * 此处仅作具名重导出，既有消费者（Gateway apkg-export、Web、外部 import）行为不变。
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
} from '@study-studio/flashcard-core';
