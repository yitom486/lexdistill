import { describe, expect, it } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { pipelineModel, submissionFromPrompt } from './textbook-pipeline-fixtures.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

pinProcessToTestRuntime();
describe('超过原生单次渲染限额的章节', () => {
  it('11 个真实 PDF 页分批渲染，全部附件随目录发送，工具成功后逐章入库', async () => {
    const runtime = await ensurePdfTestRuntime();
    const fixture = await PDFDocument.load(await Bun.file(new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url)).arrayBuffer());
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 11; index++) pdf.addPage((await pdf.copyPages(fixture, [0]))[0]!);
    const repo = new DrizzleLearnerRepository(':memory:'), tool = new LibraryLessonCommitTool(repo);
    const requests: number[][] = [];
    const model = pipelineModel(tool, async ({ input, submit }) => {
      expect(input.attachments).toHaveLength(11);
      expect(input.attachments?.map(image => image.label)).toEqual(Array.from({ length: 11 }, (_, index) => `原书 PDF 第 ${index + 1} 页`));
      for (const image of input.attachments ?? []) expect([...image.png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(input.message).toContain('本章目录'); expect(input.message).toContain('十一页章节');
      expect((await submit(submissionFromPrompt(input.message))).ok).toBe(true);
    });
    try {
      const result = await repo.executeTextbookPipeline({ userId: 'image-owner', title: '原生页图验证', documentId: 'image-book',
        tocEntries: [{ id: 'chapter', title: '十一页章节', level: 'lesson', startPage: 1, endPage: 11 }], pdf: await pdf.save(),
        inspector: { ...runtime.inspector, processPdf: () => ({ pagesNeedingOcr: [1] }),
          processPdfWithOcr: runtime.inspector.processPdfWithOcr,
          renderPdfPages: async (bytes, pages) => { requests.push([...pages]); return runtime.inspector.renderPdfPages!(bytes, pages, { dpi: 90 }); } },
        chapterParser: { parse: async (_pdf, pages) => ({ parser: 'mineru-cloud', blocks: pages.map(page => ({ id: `p${page}b0`, page, kind: 'IMAGE', text: '' })) }) },
        adapter: model.adapter, submissionTool: tool, poolSize: 1, modelRetries: 0 });
      expect(result.ok && result.value.allLessonsReady).toBe(true);
      expect(requests.map(pages => pages.length)).toEqual([8, 3]);
      const stored = await repo.getTextbookAssetStats('image-book');
      expect(stored.ok && stored.value.readyLessons).toBe(1);
    } finally { repo.getRawDb().close(); }
  });
});
