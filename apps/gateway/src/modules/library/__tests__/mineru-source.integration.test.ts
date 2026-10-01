import { afterEach, expect, it } from 'bun:test';
import { cloudChapterSource } from '../../../infrastructure/mineru/chapter-source.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { pipelineModel, submissionFromPrompt } from './textbook-pipeline-fixtures.js';

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
    expect(input.message).toContain(JSON.stringify(source));
    expect(source.blocks.filter(block => block.kind === 'TABLE').map(block => [block.page, block.rows])).toEqual([[7, [['人物甲', '人物']]], [8, [['职业乙', '职业']]]]);
    expect((await submit(submissionFromPrompt(input.message))).ok).toBe(true);
  });
  const result = await repo.executeTextbookPipeline({ userId: 'source-owner', documentId: 'source-book', title: '解析材料集成验证',
    tocEntries: [{ id: 'chapter', title: '当前章节', level: 'lesson', startPage: 7, endPage: 8 }],
    lessonJobs: [{ lessonId: 'chapter', ocrText: JSON.stringify(source) }], adapter: model.adapter, submissionTool: tool, poolSize: 1 });
  expect(result.ok && result.value.allLessonsReady).toBe(true);
  const assets = await repo.getTextbookAssetStats('source-book');
  expect(assets.ok && assets.value.readyLessons).toBe(1);
});
