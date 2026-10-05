import { describe, expect, it } from 'bun:test';
import type { MapPdfResult } from '../../queries/useLearnerQueries.js';
import { parseTocScanRange, tocCandidatesFromMap, validateTocCandidates } from '../toc-recognition.js';

const BASE: MapPdfResult = {
  classification: { pdfType: 'Scanned', pageCount: 80, selectedPages: [3, 4] },
  window: [3, 4],
  headings: [],
  tocEntries: [],
};

describe('目录候选与人工确认边界', () => {
  it('目录页窗超出 30 页或只填一端时拒绝，避免服务端静默截断', () => {
    expect(parseTocScanRange('', '')).toEqual({ ok: true });
    expect(parseTocScanRange('31', '60')).toEqual({ ok: true, startPage: 31, endPage: 60 });
    expect(parseTocScanRange('31', '61').ok).toBe(false);
    expect(parseTocScanRange('31', '').ok).toBe(false);
  });

  it('PDF 书签只提供物理页，绝不推测印刷页', () => {
    const rows = tocCandidatesFromMap({
      ...BASE,
      outlineSource: 'embedded',
      embeddedOutline: [
        { title: '第一章', level: 1, physicalPage: 7 },
        { title: '第1課 あいさつ', level: 2, physicalPage: 12 },
      ],
    });
    expect(rows.map((row) => [row.printedPage, row.physicalPage, row.kind, row.level])).toEqual([
      ['', 7, 'section', 1],
      ['', 12, 'lesson', 2],
    ]);
    expect(validateTocCandidates(rows)).toContain('印刷页');
  });

  it('OCR 候选保留印刷页并去掉页码与点线，非课单元保守归为章节', () => {
    const rows = tocCandidatesFromMap({
      ...BASE,
      outlineSource: 'none',
      tocEntries: [
        { label: '第1課 あいさつ ……… 12', lessonNo: '1', printedPage: 12 },
        { label: '復習A42', lessonNo: '復習A', printedPage: 42 },
      ],
    });
    expect(rows.map((row) => [row.title, row.printedPage, row.kind])).toEqual([
      ['第1課 あいさつ', '12', 'lesson'],
      ['復習A', '42', 'section'],
    ]);
    expect(validateTocCandidates(rows)).toBeNull();
  });

  it('空页码、倒退页码不能确认；一级章节无需标为成课', () => {
    const rows = tocCandidatesFromMap({
      ...BASE,
      tocEntries: [
        { label: '第1課 10', lessonNo: '1', printedPage: 10 },
        { label: '第2課 20', lessonNo: '2', printedPage: 20 },
      ],
    });
    expect(validateTocCandidates([{ ...rows[0]!, printedPage: '' }])).toContain('印刷页');
    expect(validateTocCandidates(rows.map((row) => ({ ...row, kind: 'section' })))).toBeNull();
    expect(validateTocCandidates([rows[1]!, rows[0]!])).toContain('倒退');
  });
});
