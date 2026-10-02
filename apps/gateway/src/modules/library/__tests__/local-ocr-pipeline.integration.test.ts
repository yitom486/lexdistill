import { expect, it } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { BusinessError } from '@study-studio/shared';
import { TextbookPipelineSettingsSchema, type ChapterSource } from '@study-studio/document-model';
import { createLocalOcrParser } from '../../../infrastructure/pdf-runtime/local-ocr-parser.js';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { producePdfLessons } from '../application/pdf-import/lesson-content-slicer.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { deferred, fixturePdf, pipelineModel } from './textbook-pipeline-fixtures.js';

const scan = (ocr: PdfInspectorLike['processPdfWithOcr']): PdfInspectorLike => ({
  processPdf: () => ({ markdown: '', pagesNeedingOcr: [1] }), processPdfWithOcr: ocr,
});
const recognized = (pageNumber: number) => ({ pageNumber, markdown: '错误表格拼装，不应发送', spans: [
  { text: `识别行 ${pageNumber}`, x: 0, y: 0, width: 10, height: 10, confidence: 0.9 },
] });

it('默认本地 OCR 按一级章切片，长章分批后只入队一次，采用逐页识别行', async () => {
  const batchSizes: number[] = [], delivered: ChapterSource[] = [];
  await producePdfLessons({ pdf: await fixturePdf(33), inspector: scan(async (slice, options) => {
    const count = (await PDFDocument.load(slice)).getPageCount(); batchSizes.push(count);
    expect(options?.pageNumbers).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    return { pages: options!.pageNumbers!.map(recognized) };
  }), lessons: [{ id: 'root', title: '长章节', level: 'lesson', startPage: 2, endPage: 33 }],
  concurrency: 2, retries: 0, signal: new AbortController().signal,
  onStart: () => {}, onFailure: error => { throw new Error(String(error)); }, onText: async (_, text, source) => {
    delivered.push(source); expect(text).not.toContain('错误表格拼装');
  } });
  expect(batchSizes).toEqual([30, 2]); expect(delivered).toHaveLength(1);
  expect(delivered[0]?.parser).toBe('local-ocr');
  expect(delivered[0]?.blocks.map(block => block.page)).toEqual(Array.from({ length: 32 }, (_, index) => index + 2));
});

it('数字原生 PDF 保持直接读取，零 OCR 调用', async () => {
  const delivered: ChapterSource[] = [];
  await producePdfLessons({ pdf: await fixturePdf(1), inspector: {
    processPdf: () => ({ markdown: '原生文字', pagesNeedingOcr: [] }),
    processPdfWithOcr: async () => { throw new Error('文字 PDF 不应 OCR'); },
  }, lessons: [{ id: 'a', title: '课文', level: 'lesson', startPage: 1 }], concurrency: 1, retries: 0,
  signal: new AbortController().signal, onStart: () => {}, onFailure: () => { throw new Error('不应失败'); },
  onText: async (_, __, source) => { delivered.push(source); } });
  expect(delivered[0]).toMatchObject({ parser: 'native', blocks: [{ text: '原生文字' }] });
});

it('本地 OCR 一章失败不阻塞另一章入库，模型收到目录和识别行，无图片或数据库 ID', async () => {
  const repo = new DrizzleLearnerRepository(':memory:');
  let calls = 0;
  try {
    const tool = new TextbookContentTools(repo), model = pipelineModel(tool);
    const result = await repo.executeTextbookPipeline({ userId: 'local-owner', documentId: 'local-book', title: '本地 OCR 教材',
      pdf: await fixturePdf(2), poolSize: 1, parseConcurrency: 1, parseRetries: 0,
      tocEntries: [{ id: 'a', title: '失败章', level: 'lesson', startPage: 1 },
        { id: 'b', title: '成功章', level: 'lesson', startPage: 2 }],
      inspector: scan(async () => ++calls === 1 ? { pages: [] } : { pages: [recognized(1)] }),
      adapter: model.adapter, submissionTool: tool });
    expect(result.ok && result.value).toMatchObject({ successfulLessons: 1, failedLessons: 1 });
    expect(model.inputs).toHaveLength(1);
    expect(model.inputs[0]?.input.message).toContain('- 成功章');
    expect(model.inputs[0]?.input.message).toContain('识别行 1');
    expect(model.inputs[0]?.input.message).not.toContain('错误表格拼装');
    expect(model.inputs[0]?.input.attachments).toBeUndefined();
    const assets = await repo.getTextbookAssetStats('local-book');
    expect(assets.ok && assets.value).toMatchObject({ readyLessons: 1, vocab: 1, grammar: 1, exercises: 1 });
    expect(model.closed).toHaveLength(1);
  } finally { repo.getRawDb().close(); }
});

it('OCR 重试不重新识别已成功的批次，不切换云端', async () => {
  const batches: number[] = [], sources: ChapterSource[] = [];
  let failed = false;
  await producePdfLessons({ pdf: await fixturePdf(3), settings: TextbookPipelineSettingsSchema.parse({ parsePageLimit: 2 }),
    inspector: scan(async (bytes, options) => {
      const count = (await PDFDocument.load(bytes)).getPageCount(); batches.push(count);
      if (count === 1 && !failed) { failed = true; throw new BusinessError('E_OCR_BUSY', '本地暂忙', 'TOOL_EXECUTION', true); }
      return { pages: options!.pageNumbers!.map(recognized) };
    }), lessons: [{ id: 'a', title: '整课', level: 'lesson', startPage: 1 }], concurrency: 1, retries: 1,
    signal: new AbortController().signal, onStart: () => {}, onFailure: () => { throw new Error('应重试成功'); },
    onText: async (_, __, source) => { sources.push(source); } });
  expect(batches).toEqual([2, 1, 1]); expect(sources).toHaveLength(1);
  expect(sources[0]?.blocks.map(block => block.page)).toEqual([1, 2, 3]);
});

it('取消与超时结束本地等待，原生推理迟到结果丢弃', async () => {
  for (const mode of ['cancel', 'timeout'] as const) {
    const started = deferred(), released = deferred();
    const controller = new AbortController();
    const settings = TextbookPipelineSettingsSchema.parse({ parseTimeoutMs: 100 });
    const parser = createLocalOcrParser(scan(async () => { started.resolve(); await released.promise; return { pages: [recognized(1)] }; }), settings);
    const task = parser.parse(await fixturePdf(1), [8], controller.signal, () => { throw new Error('迟到结果不应完成'); });
    await started.promise; if (mode === 'cancel') controller.abort();
    await expect(task).rejects.toMatchObject({ code: mode === 'cancel' ? 'E_CANCELLED' : 'E_OCR_TIMEOUT' });
    released.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
  }
});
