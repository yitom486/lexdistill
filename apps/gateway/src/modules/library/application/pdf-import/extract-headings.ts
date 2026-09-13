/**
 * M8-3 Gateway 薄兼容出口：实现已迁入 `@study-studio/content`，
 * 此处仅作具名重导出，既有消费者（pdf-import-service、测试）行为不变。
 */
export {
  extractHeadingsFromMarkdown,
  extractTocEntries,
  type PageHeading,
  type TocEntry,
} from '@study-studio/content';
