import { describe, expect, it } from 'bun:test';
import {
  buildOcrOverflowError,
  buildPdfConvertReport,
  buildPdfMapReport,
} from '../application/pdf-import/pdf-import-report.js';

describe('pdf-import-report', () => {
  it('未选页 = all；课标题进摘要、不含正文', () => {
    const r = buildPdfConvertReport({
      title: 'scan',
      pdfType: 'Scanned',
      pageCount: 371,
      selectedPages: [],
      ocrUsed: true,
      ocrPages: [1, 2, 3],
      lessons: 2,
      dialogues: 4,
      lessonTitles: ['第1課', '第2課'],
    });
    expect(r.scope).toBe('all');
    expect(r.lessonTitles).toEqual(['第1課', '第2課']);
    // 结构锁：摘要只有计数/标题级字段，装不下 markdown 与对话正文
    expect(Object.keys(r).sort()).toEqual([
      'azurePages',
      'clampedFromAll',
      'dialogues',
      'lessonTitles',
      'lessons',
      'ocrPages',
      'ocrUsed',
      'pageCount',
      'pdfType',
      'scope',
      'selectedPages',
      'title',
    ]);
    expect(r.clampedFromAll).toBe(false);
    expect(JSON.stringify(r)).not.toContain('わたし');
  });

  it('有选页 = range', () => {
    const r = buildPdfConvertReport({
      title: 'scan',
      pdfType: 'Scanned',
      pageCount: 371,
      selectedPages: [12, 13],
      ocrUsed: true,
      ocrPages: [12, 13],
      lessons: 1,
      dialogues: 2,
      lessonTitles: ['第4課'],
    });
    expect(r.scope).toBe('range');
    expect(r.selectedPages).toEqual([12, 13]);
  });

  it('map 预览只保留标题行，截断长列表', () => {
    const r = buildPdfMapReport({
      pageCount: 371,
      window: [1, 2, 3],
      ocrUsed: true,
      ocrPages: [1, 2],
      headings: Array.from({ length: 30 }, (_, i) => ({ page: 1, text: `第${i + 1}課` })),
      tocCount: 25,
    });
    expect(r.headingCount).toBe(30);
    expect(r.headingPreview).toHaveLength(24);
    expect(r.headingPreview[0]).toBe('p1:第1課');
    // 结构锁：预览只有「页码+标题」短行，无正文字段
    expect(Object.keys(r).sort()).toEqual([
      'headingCount',
      'headingPreview',
      'ocrPages',
      'ocrUsed',
      'pageCount',
      'tocCount',
      'window',
    ]);
  });
});

describe('buildOcrOverflowError（全部页扫描超限引导）', () => {
  it('all：文案不变 + details 带首个 30 页窗', () => {
    const e = buildOcrOverflowError({
      scope: 'all',
      pageCount: 371,
      ocrPages: Array.from({ length: 371 }, (_, i) => i + 1),
      limit: 30,
    });
    expect(e.code).toBe('E_INVALID_INPUT');
    expect(e.category).toBe('VALIDATION');
    expect(e.userMessage).toBe('本书 371 页需 OCR（单次上限 30 页），请按课分段选页导入');
    expect(e.internalDetails).toEqual({
      pageCount: 371,
      ocrPages: Array.from({ length: 371 }, (_, i) => i + 1),
      suggestedStartPage: 1,
      suggestedEndPage: 30,
    });
  });

  it('range：文案不变 + 上限仍 30', () => {
    const e = buildOcrOverflowError({ scope: 'range', pageCount: 371, ocrPages: [40, 41], limit: 30 });
    expect(e.userMessage).toBe('所选页中有 2 页需 OCR（单次上限 30 页），请缩小选页范围');
    expect(e.internalDetails).toEqual({
      pageCount: 371,
      ocrPages: [40, 41],
      suggestedStartPage: 1,
      suggestedEndPage: 30,
    });
  });
});

describe('buildPdfConvertReport 夹持标志', () => {
  it('clampedFromAll=true 透出且 scope=range（成功 warn 可见）', () => {
    const r = buildPdfConvertReport({
      title: 'scan35',
      pdfType: 'Scanned',
      pageCount: 35,
      selectedPages: Array.from({ length: 30 }, (_, i) => i + 1),
      ocrUsed: true,
      ocrPages: Array.from({ length: 30 }, (_, i) => i + 1),
      lessons: 2,
      dialogues: 4,
      lessonTitles: ['第1課', '第2課'],
      clampedFromAll: true,
    });
    expect(r.scope).toBe('range');
    expect(r.clampedFromAll).toBe(true);
    expect(r.lessonTitles).toEqual(['第1課', '第2課']);
  });
});
