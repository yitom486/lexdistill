/**
 * M8-4 Gateway 薄兼容出口：实现已迁入 `@study-studio/document-ingest-pdf`，
 * 此处仅作具名重导出，既有消费者行为不变。新代码请直引 canonical 出口。
 */
export {
  buildOcrOverflowError,
  buildPdfConvertReport,
  buildPdfMapReport,
  type PdfConvertReport,
  type PdfOcrOverflowDetails,
} from '@study-studio/document-ingest-pdf';
