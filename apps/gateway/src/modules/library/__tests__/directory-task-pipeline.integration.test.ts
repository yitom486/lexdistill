import { afterEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { canonicalizeTocEntries, TextbookASTSchema, type TocEntry } from '@study-studio/document-model';
import * as schema from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { pipelineModel, submissionFromPrompt } from './textbook-pipeline-fixtures.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
const entries: TocEntry[] = [
  { id: 'unit', title: '学习单元', level: 'unit', startPage: 3, endPage: 15 },
  { id: 'chapter', title: '基础部分', level: 'chapter', parentId: 'unit', startPage: 3, endPage: 15 },
  { id: 'intro-child', title: '发音', level: 'section', parentId: 'intro', startPage: 3, endPage: 4 },
  { id: 'intro', title: '导入', level: 'section', parentId: 'chapter', startPage: 3, endPage: 4 },
  { id: 'lesson-a', title: '主题甲', level: 'lesson', parentId: 'chapter', startPage: 5, endPage: 9 },
  { id: 'section-a', title: '会话甲', level: 'section', parentId: 'lesson-a', startPage: 6, endPage: 9 },
  { id: 'lesson-b', title: '主题乙', level: 'lesson', parentId: 'chapter', startPage: 10, endPage: 15 },
];
function setup(failIntro = false) {
  const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
  const db = drizzle(repo.getRawDb(), { schema });
  const tool = new LibraryLessonCommitTool(repo);
  const model = pipelineModel(tool, async ({ input, submit }) => {
    const value = submissionFromPrompt(input.message);
    if (failIntro && value.lessonId === 'intro') return;
    expect((await submit(value)).ok).toBe(true);
  });
  return { repo, db, model, input: { userId: 'owner', documentId: 'directory-book', title: '目录任务集成教材', language: 'ja', tocEntries: entries,
    lessonJobs: ['intro', 'lesson-a', 'lesson-b'].map(lessonId => ({ lessonId, text: `当前部分文字 ${lessonId}` })),
    adapter: model.adapter, submissionTool: tool, poolSize: 1, modelRetries: 0 } };
}
describe('目录任务：实际会话输入 → 原生工具 → SQLite → 完成回执', () => {
  it('独立部分与课次都提取，提示词完整保留目录结构、顺序和页码，复用同一会话', async () => {
    const env = setup();
    const result = await env.repo.executeTextbookPipeline(env.input);
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect(result.ok && result.value.successfulLessons).toBe(3);
    expect(env.model.created).toHaveLength(1);
    expect(env.model.inputs).toHaveLength(3);
    const normalized = canonicalizeTocEntries(entries);
    const expected = new Map([['intro', ['intro-child', 'intro']], ['lesson-a', ['lesson-a', 'section-a']], ['lesson-b', ['lesson-b']]]);
    for (const turn of env.model.inputs) {
      const message = turn.input.message;
      const submission = submissionFromPrompt(message);
      const actual: unknown = JSON.parse(message.split('本章目录:\n')[1]!.split('\n')[0]!);
      expect(actual).toEqual(normalized.filter(entry => expected.get(submission.lessonId)!.includes(entry.id)));
      const path: unknown = JSON.parse(message.split('目录路径（所属单元与章）：\n')[1]!.split('\n')[0]!);
      expect(path).toEqual(normalized.filter(entry => entry.id === 'unit' || entry.id === 'chapter'));
      expect(message).toContain(`当前部分文字 ${submission.lessonId}`);
      expect(message).toContain('library_commit_lesson_knowledge');
      expect(message).not.toContain('"$schema"');
      expect(message).not.toContain('"properties"');
    }
    const ast = TextbookASTSchema.parse(JSON.parse(env.db.select().from(schema.documents).where(eq(schema.documents.id, 'directory-book')).get()!.astJson!));
    expect(ast.lessons.find(entry => entry.id === 'unit')?.kind).toBe('unit');
    expect(ast.lessons.find(entry => entry.id === 'intro')?.status).toBe('ready');
    expect(env.db.select().from(schema.textbookLines).all().filter(line => line.lessonId === 'intro').map(line => line.tocId)).toEqual(['intro-child', 'intro']);
    const stats = await env.repo.getTextbookAssetStats('directory-book');
    expect(stats.ok && stats.value.readyLessons).toBe(3);
    expect(stats.ok && stats.value.lessonDetails.map(item => item.lessonId)).toEqual(['intro', 'lesson-a', 'lesson-b']);
    expect(env.model.closed).toHaveLength(1);
  });
  it('课次都已保存但独立部分失败时，全书不能标记完成；再次执行仅处理该部分', async () => {
    const env = setup(true);
    const first = await env.repo.executeTextbookPipeline(env.input);
    expect(first.ok && first.value.allLessonsReady).toBe(false);
    expect(first.ok && first.value.successfulLessons).toBe(2);
    expect(env.db.select().from(schema.documentImports).where(eq(schema.documentImports.documentId, 'directory-book')).get()?.status).toBe('failed');
    const tool = new LibraryLessonCommitTool(env.repo), model = pipelineModel(tool);
    const second = await env.repo.executeTextbookPipeline({ ...env.input, adapter: model.adapter, submissionTool: tool });
    expect(second.ok && second.value.allLessonsReady).toBe(true);
    expect(model.inputs).toHaveLength(1);
    expect(submissionFromPrompt(model.inputs[0]!.input.message).lessonId).toBe('intro');
  });
  it('课内层级容器可汇总覆盖，不要求模型为容器编造正文', async () => {
    const env = setup(), tool = new LibraryLessonCommitTool(env.repo);
    const model = pipelineModel(tool, async ({ input, submit }) => {
      const value = submissionFromPrompt(input.message);
      value.content.blocks = value.content.blocks.filter(block => block.tocId !== 'container');
      expect((await submit(value)).ok).toBe(true);
    });
    const result = await env.repo.executeTextbookPipeline({ ...env.input, adapter: model.adapter, submissionTool: tool,
      tocEntries: [
        { id: 'lesson-a', title: '主题', level: 'lesson', startPage: 5, endPage: 9 },
        { id: 'container', title: '练习组', level: 'chapter', parentId: 'lesson-a', startPage: 6, endPage: 9 },
        { id: 'detail', title: '练习', level: 'section', parentId: 'container', startPage: 6, endPage: 9 },
      ], lessonJobs: [{ lessonId: 'lesson-a', text: '原书内容' }],
    });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect(env.db.select().from(schema.textbookLines).all().some(line => line.tocId === 'container')).toBe(false);
  });
  for (const broken of [
    [...entries, { id: 'orphan', title: '缺少父项', level: 'section', parentId: 'missing', startPage: 3 }],
    entries.map(entry => entry.id === 'unit' ? { ...entry, parentId: 'chapter' } : entry),
  ] as TocEntry[][]) it('父项缺失或循环在模型启动和写入之前显式拒绝', async () => {
    const env = setup();
    const result = await env.repo.executeTextbookPipeline({ ...env.input, tocEntries: broken });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_TOC_HIERARCHY_INVALID');
    expect(env.model.created).toHaveLength(0);
    expect(env.db.select().from(schema.documents).where(eq(schema.documents.id, 'directory-book')).all()).toHaveLength(0);
  });
});
