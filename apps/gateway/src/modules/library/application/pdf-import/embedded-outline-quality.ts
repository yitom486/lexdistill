/**
 * M8-5 Gateway 薄兼容出口：实现已迁入 `@study-studio/content`，
 * 此处仅作具名重导出，既有消费者行为不变。新代码请直引 canonical 出口。
 */
export {
  MIN_SEMANTIC_RATIO,
  MIN_SEMANTIC_TITLES,
  classifyEmbeddedOutline,
  isSemanticOutlineTitle,
  type EmbeddedOutlineEntry,
  type EmbeddedOutlineInspector,
  type EmbeddedOutlineQuality,
  type EmbeddedOutlineQualityReason,
  type EmbeddedOutlineQualityReport,
  type EmbeddedOutlineSource,
  type EmbeddedOutlineSourceItem,
} from '@study-studio/content';
