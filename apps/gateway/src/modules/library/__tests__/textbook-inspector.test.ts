import { afterEach, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { TextbookInspectionResultSchema } from '@study-studio/protocol';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { submitRequired, pipelineModel, submissionFromPrompt } from './textbook-pipeline-fixtures.js';

const fixture = new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url);
const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
describe('教材检测：真实指纹、内容统计、补课与重复导入', () => {
  it('部分导入明确报告；补齐后按真实状态报告已完成；改名识别、同名不同文件和其他用户不匹配', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const tool = new TextbookContentTools(repo);
    let partial = true;
    const model = pipelineModel(tool, async ({ input, submit }) => { const value = submissionFromPrompt(input.message); if (!partial || input.message.includes('章节: 第一章')) { await submit(value); await submitRequired(submit); } });
    const app = createPdfImportRoutes({ repo, server: {} as never, port: 0 });
    const input = { userId: 'owner', documentId: 'book', title: '教材', pdf: new Uint8Array(await Bun.file(fixture).arrayBuffer()), poolSize: 1, modelRetries: 0, adapter: model.adapter, submissionTool: tool,
      tocEntries: [{ id: 'l1', title: '第一章', level: 'lesson' as const, startPage: 1 }, { id: 'l2', title: '第二章', level: 'lesson' as const, startPage: 2 }],
      lessonJobs: [{ lessonId: 'l1', text: '第一章' }, { lessonId: 'l2', text: '第二章' }],
    };
    const inspect = async (user = 'owner', file = fixture) => {
      const response = await app.request(`/api/documents/${user}/inspect-import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: '改名.pdf', filePath: fileURLToPath(file) }) });
      expect(response.status).toBe(200); return TextbookInspectionResultSchema.parse(await response.json());
    };
    expect((await repo.executeTextbookPipeline(input)).ok).toBe(true);
    const first = await inspect(); expect(first.status).toBe('partial'); expect(first.summary).toContain('1/2'); expect(first.matchedDocument?.lineCount).toBe(1);
    expect(first.matchedDocument?.lessonDetails[0]?.hasPassage).toBe(true); expect(first.matchedDocument?.exerciseCount).toBe(1);
    partial = false;
    expect((await repo.executeTextbookPipeline(input)).ok).toBe(true);
    const ready = await inspect(); expect(ready.status).toBe('ready'); expect(ready.matchedDocument?.readyLessonCount).toBe(2); expect(ready.matchedDocument?.lineCount).toBe(2);
    const calls = model.inputs.length;
    expect((await repo.executeTextbookPipeline(input)).ok).toBe(true); expect(model.inputs.length).toBe(calls);
    expect((await inspect('other')).matchedDocument).toBeUndefined();
    expect((await inspect('owner', new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url))).status).toBe('not_imported');
  });
});
