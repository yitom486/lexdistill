import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { slicePdfLessonsWithOcr } from '../application/pdf-import/lesson-content-slicer.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

pinProcessToTestRuntime();
const runtime = await ensurePdfTestRuntime();

const nativePdfUrl = new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url);
const scannedPdfUrl = new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url);

describe('课次正文并发切片抽取器 (slicePdfLessonsWithOcr 集成测试)', () => {
  it('【真实数字原生 PDF】按目录页码快速切片并提取各课原文（文字版直提）', async () => {
    const pdfBytes = new Uint8Array(await Bun.file(nativePdfUrl).arrayBuffer());

    const result = await slicePdfLessonsWithOcr({
      pdf: pdfBytes,
      inspector: runtime.inspector,
      concurrency: 2,
      tocEntries: [
        { id: 'u1', level: 'unit', title: 'Unit 1', startPage: 1 },
        { id: 'l1', level: 'lesson', title: 'Lesson 1 Introduction', startPage: 1, endPage: 1, parentId: 'u1' },
        { id: 'l2', level: 'lesson', title: 'Lesson 2 Basic Greetings', startPage: 2, endPage: 2, parentId: 'u1' },
      ],
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const slices = result.value;
    expect(slices).toHaveLength(2);

    expect(slices[0]?.lessonId).toBe('l1');
    expect(slices[0]?.title).toBe('Lesson 1 Introduction');
    expect(slices[0]?.startPage).toBe(1);
    expect(slices[0]?.endPage).toBe(1);
    expect(slices[0]?.ocrText.length).toBeGreaterThan(0);

    expect(slices[1]?.lessonId).toBe('l2');
    expect(slices[1]?.title).toBe('Lesson 2 Basic Greetings');
    expect(slices[1]?.startPage).toBe(2);
    expect(slices[1]?.endPage).toBe(2);
    expect(slices[1]?.ocrText.length).toBeGreaterThan(0);
  });

  it('【真实扫描版纯图片 PDF】局部页码并发 OCR 提取（自动降级扫描识别）', async () => {
    const pdfBytes = new Uint8Array(await Bun.file(scannedPdfUrl).arrayBuffer());

    const result = await slicePdfLessonsWithOcr({
      pdf: pdfBytes,
      inspector: runtime.inspector,
      concurrency: 2,
      tocEntries: [
        { id: 'scanned_l1', level: 'lesson', title: '扫描第1课 方言发音', startPage: 1, endPage: 1 },
      ],
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const slices = result.value;
    expect(slices).toHaveLength(1);
    expect(slices[0]?.lessonId).toBe('scanned_l1');
    expect(slices[0]?.startPage).toBe(1);
    expect(slices[0]?.endPage).toBe(1);
    // 扫描版 OCR 识别出真实的文本
    expect(slices[0]?.ocrText.length).toBeGreaterThan(0);
  });

  it('【防御校验】空目录或未包含成课课次时安全拦截并返回业务错误', async () => {
    const pdfBytes = new Uint8Array(await Bun.file(nativePdfUrl).arrayBuffer());

    const emptyResult = await slicePdfLessonsWithOcr({
      pdf: pdfBytes,
      inspector: runtime.inspector,
      tocEntries: [],
    });
    expect(isOk(emptyResult)).toBe(false);
    if (!isOk(emptyResult)) {
      expect(emptyResult.error.code).toBe('E_TOC_EMPTY');
    }

    const noLessonResult = await slicePdfLessonsWithOcr({
      pdf: pdfBytes,
      inspector: runtime.inspector,
      tocEntries: [{ id: 'u1', level: 'unit', title: '仅有大单元', startPage: 1 }],
    });
    expect(isOk(noLessonResult)).toBe(false);
    if (!isOk(noLessonResult)) {
      expect(noLessonResult.error.code).toBe('E_TOC_NO_LESSONS');
    }
  });
});
