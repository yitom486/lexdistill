import { describe, expect, it } from 'bun:test';
import * as doc from '../index.js';

/**
 * E2b：Content `document` 子入口表面锁定（运行时值集合；类型由 tsc 锁定）。
 * 根表面（`../public.ts`，浏览器安全）禁含 epub 符号；新增导出同步更新本集合。
 */
const EXPECTED_RUNTIME_KEYS = new Set([
  'DOCUMENT_SOURCE_KINDS',
  'decodeTextBytes',
  'extractEpubText',
  'extractMobiText',
  'guessSourceKind',
  'parseNavToc',
  'parseNcxToc',
  'xhtmlToMarkdown',
]);

describe('content document sub-entry surface', () => {
  it('运行时导出不多不少（8 项）', () => {
    const actual = new Set(Object.keys(doc));
    expect(actual.size).toBe(EXPECTED_RUNTIME_KEYS.size);
    for (const key of actual) {
      expect(EXPECTED_RUNTIME_KEYS.has(key)).toBe(true);
    }
  });

  it('根表面不含 epub 符号（浏览器安全隔离）', async () => {
    const root = await import('../../public.js');
    for (const key of ['extractEpubText', 'xhtmlToMarkdown', 'parseNcxToc', 'parseNavToc']) {
      expect((root as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});
