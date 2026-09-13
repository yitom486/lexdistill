/**
 * M7-2 learner-core 卡片模板兼容出口：实现在 `@study-studio/flashcards`
 * 的浏览器安全子入口 `./render`（C5 起规范源；根入口含 Node-only 的 APKG
 * 解析，打进 Web bundle 会失败，故垫片绝不引用根入口）。
 * 此处仅作具名重导出，既有消费者（Gateway apkg-export、Web、外部 import）
 * 行为不变。
 *
 * @deprecated 方向性垫片：新代码请直引 `@study-studio/flashcards/render` 浏览器安全子入口；
 * 本文件随后续 Web 迁移任务删除（届时 Web 直引 render 子入口）。
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
} from '@study-studio/flashcards/render';
