/**
 * M8-3 Gateway 薄兼容出口：实现已迁入 `@study-studio/document-ingest-pdf`，
 * 此处仅作具名重导出，既有消费者（pdf-import-service、document-import-service、测试）行为不变。
 */
export {
  newProvisionalBookId,
  detectDocScript,
  groupSectionsByLesson,
  groundClassesByTitle,
  groupSectionsByClasses,
  promoteLessonHeadings,
  splitInlineChinese,
  markdownToAst,
} from '@study-studio/document-ingest-pdf';
