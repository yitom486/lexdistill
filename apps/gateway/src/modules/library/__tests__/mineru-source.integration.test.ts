import { afterEach, expect, it } from 'bun:test';
import { cloudChapterSource } from '../../../infrastructure/mineru/chapter-source.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { pipelineModel, submissionFromPrompt } from './textbook-pipeline-fixtures.js';
import { fixturePdf, fixturePng } from './textbook-pipeline-fixtures.js';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import * as tables from '@study-studio/storage-sqlite';
import { TextbookASTSchema } from '@study-studio/document-model';

let repo: DrizzleLearnerRepository | undefined;
afterEach(() => { repo?.getRawDb().close(); repo = undefined; });

it('逐页表格保持跨页边界，原书物理页随实际章节输入进入会话并通过工具落库', async () => {
  const source = cloudChapterSource([
    [{ type: 'table', bbox: [0.1, 0.2, 0.9, 0.8], content: '<table><tr><td>人物甲</td><td>人物</td></tr></table>' }, { type: 'image', content: null }],
    [{ type: 'table', content: '<table><tr><td>职业乙</td><td>职业</td></tr></table>' }],
  ], [7, 8]);
  repo = new DrizzleLearnerRepository(':memory:');
  const tool = new LibraryLessonCommitTool(repo);
  const model = pipelineModel(tool, async ({ input, submit }) => {
    expect(input.message).toContain('"rows":[["人物甲","人物"]]');
    expect(input.message).not.toContain('<table>');
    expect(source.blocks.filter(block => block.kind === 'TABLE').map(block => [block.page, block.rows])).toEqual([[7, [['人物甲', '人物']]], [8, [['职业乙', '职业']]]]);
    expect((await submit(submissionFromPrompt(input.message))).ok).toBe(true);
  });
  const result = await repo.executeTextbookPipeline({ userId: 'source-owner', documentId: 'source-book', title: '解析材料集成验证',
    tocEntries: [{ id: 'chapter', title: '当前章节', level: 'lesson', startPage: 7, endPage: 8 }],
    lessonJobs: [{ lessonId: 'chapter', text: JSON.stringify(source), source }], adapter: model.adapter, submissionTool: tool, poolSize: 1 });
  expect(result.ok && result.value.allLessonsReady).toBe(true);
  const assets = await repo.getTextbookAssetStats('source-book');
  expect(assets.ok && assets.value.readyLessons).toBe(1);
});

it('实际 Turn 包含目录子树、表格与原页附件；越界行引用拒绝零写入，修正后保存在规范 AST', async () => {
  repo = new DrizzleLearnerRepository(':memory:');
  const db = drizzle(repo.getRawDb(), { schema: tables }), tool = new LibraryLessonCommitTool(repo);
  const model = pipelineModel(tool, async ({ input, submit }) => {
    expect(input.message).toContain('本章目录:'); expect(input.message).toContain('生词小节');
    expect(input.message).toContain('"rows":[["词甲","释义甲"]]');
    expect(input.message).not.toContain('<table>'); expect(input.message).not.toContain('"properties"');
    expect(input.attachments).toHaveLength(1); expect(input.attachments?.[0]?.label).toBe('原书 PDF 第 2 页');
    expect(input.attachments?.[0]?.png).toEqual(fixturePng);
    const candidate = submissionFromPrompt(input.message);
    candidate.content.vocabularies[0]!.sourceRefs = [{ blockId: 'p2b0', row: 9 }];
    const rejected = await submit(candidate);
    expect(rejected.ok).toBe(false); if (!rejected.ok) expect(rejected.error.code).toBe('E_SOURCE_REFERENCE_INVALID');
    expect(db.select().from(tables.textbookVocab).all()).toHaveLength(0);
    candidate.content.vocabularies[0]!.sourceRefs = [{ blockId: 'p2b0', row: 0 }];
    expect((await submit(candidate)).ok).toBe(true);
  });
  const result = await repo.executeTextbookPipeline({ userId: 'source-owner', documentId: 'source-book', title: '来源定位验证', traceId: 'source-trace',
    tocEntries: [{ id: 'chapter', title: '当前章节', level: 'lesson', startPage: 2, endPage: 2 }, { id: 'vocab', title: '生词小节', level: 'section', parentId: 'chapter', startPage: 2 }],
    pdf: await fixturePdf(2), inspector: { processPdf: () => ({ markdown: '', pagesNeedingOcr: [2] }), processPdfWithOcr: async () => { throw new Error('旧 OCR 不应调用'); }, renderPdfPages: async (_pdf, pages) => pages.map(pageNumber => ({ pageNumber, png: fixturePng, width: 1, height: 1 })) },
    chapterParser: { parse: async (_pdf, pages) => cloudChapterSource([[{ type: 'table', content: '<table><tr><td>词甲</td><td>释义甲</td></tr></table>' }, { type: 'image' }]], pages) },
    adapter: model.adapter, submissionTool: tool, poolSize: 1, modelRetries: 0 });
  expect(result.ok && result.value.allLessonsReady).toBe(true);
  const ast = TextbookASTSchema.parse(JSON.parse(db.select().from(tables.documents).where(eq(tables.documents.id, 'source-book')).get()!.astJson!));
  expect(ast.lessons[0]?.content?.vocabularies[0]?.sourceRefs).toEqual([{ blockId: 'p2b0', page: 2, row: 0 }]);
  const events = await repo.listImportEvents({ userId: 'source-owner', traceId: 'source-trace' });
  expect(events.ok && events.value.some(event => event.name === 'rejected')).toBe(true);
});
