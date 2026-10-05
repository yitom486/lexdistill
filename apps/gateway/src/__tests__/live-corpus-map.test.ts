import { describe, expect, it } from 'bun:test';
import {
  formatMapSummary,
  runLiveCorpusMap,
  usageText,
  LIVE_PDF_ENV,
} from '../scripts/live-corpus-map.js';
import type { PdfMapOutput } from '../modules/library/application/pdf-import/pdf-import-service.js';

/**
 * CMD-04：可选 live 探针只测“未设 env / 缺文件”两条安全行为，CI 永不读 D:\book。
 * 真书 happy path 只在开发者本机手动跑（见 docs/pdf-live-corpus-playbook.md）。
 */
describe('live-corpus-map 探针安全行为', () => {
  it('未设 env → exit 0 + 用法，不读盘', async () => {
    const res = await runLiveCorpusMap(undefined);
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain(LIVE_PDF_ENV);
    expect(res.output).toContain('用法');
    expect(usageText()).toContain(LIVE_PDF_ENV);
  });

  it('空白 env 视同未设', async () => {
    const res = await runLiveCorpusMap('   ');
    expect(res.exitCode).toBe(0);
  });

  it('不存在的路径 → 友好错误 exit 2，无底层栈', async () => {
    const res = await runLiveCorpusMap('D:\\definitely\\not\\here\\no-such.pdf');
    expect(res.exitCode).toBe(2);
    expect(res.output).toContain('找不到');
    expect(res.output).not.toMatch(/\n\s*at\s+/);
  });

  it('目录路径 → 不是文件 exit 2', async () => {
    const res = await runLiveCorpusMap(import.meta.dir);
    expect(res.exitCode).toBe(2);
    expect(res.output).toContain('不是文件');
  });

  it('formatMapSummary：摘要含计数与条目，长列表截断且不 dump 全文', () => {
    const result: PdfMapOutput = {
      classification: { pdfType: 'TextBased', pageCount: 371, selectedPages: [1] },
      window: [1],
      headings: Array.from({ length: 35 }, (_, i) => ({ page: 1, level: 1, text: `第${i + 1}課` })),
      tocEntries: [{ label: '第1課', lessonNo: '1', printedPage: 2 }],
      outlineSource: 'none',
      embeddedOutline: [],
    };
    const out = formatMapSummary(result, 'some.pdf');
    expect(out).toContain('pageCount=371');
    expect(out).not.toContain('ocrPages');
    expect(out).toContain('p1 第1課');
    expect(out).toContain('1 -> p2');
    expect(out).toContain('…等 5 条');
  });
});
