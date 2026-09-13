import { describe, expect, it } from 'bun:test';
import * as pub from '../public.js';

/**
 * M5.1：Content 公共表面锁定（运行时值集合；类型表面由 tsc 锁定——
 * facade 的 `export { type X }` 与消费者引用在类型缺席时即编译失败）。
 * 新增导出必须同步更新本集合（防无声膨胀）；删除导出必须同步更新
 * Gateway facade 与消费者（防悬挂引用）。
 */
const EXPECTED_RUNTIME_KEYS = new Set([
  'FOLIO_CANDIDATE_MAX_PAGES',
  'FOLIO_OCR_MIN_CONFIDENCE',
  'MIN_SEMANTIC_RATIO',
  'MIN_SEMANTIC_TITLES',
  'buildOcrOverflowError',
  'buildPdfConvertReport',
  'buildPdfMapReport',
  'classifyEmbeddedOutline',
  'detectDocScript',
  'detectFolioCandidates',
  'extractHeadingsFromMarkdown',
  'extractTocEntries',
  'groundClassesByTitle',
  'groupSectionsByClasses',
  'groupSectionsByLesson',
  'isSemanticOutlineTitle',
  'layoutItemsToCandidates',
  'markdownToAst',
  'mergeHeadingCandidates',
  'newProvisionalBookId',
  'promoteLessonHeadings',
  'splitInlineChinese',
]);

describe('content public surface', () => {
  it('运行时导出不多不少（22 项）', () => {
    const actual = new Set(Object.keys(pub));
    expect(actual.size).toBe(EXPECTED_RUNTIME_KEYS.size);
    for (const key of actual) {
      expect(EXPECTED_RUNTIME_KEYS.has(key)).toBe(true);
    }
  });
});
