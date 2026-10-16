import { afterEach, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { TextbookInspectionResultSchema } from '@lexdistill/protocol';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import { harnessInjection, type ChapterScript } from './agentpool-pipeline-harness.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import { pinProcessToTestRuntime } from './pdf-test-runtime.js';

pinProcessToTestRuntime();

const fixture = new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url);
const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });

let rpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: 'grammar' | 'vocabulary' | 'exercises' | 'articles', raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `inspect-${++rpcSeq}`);
  if (!result.ok) throw result.error;
}
async function submitLesson(scope: McpChapterScope, lessonId: string) {
  await submitScope(scope, 'grammar', requiredContent.grammar);
  await submitScope(scope, 'vocabulary', requiredContent.vocabulary);
  await submitScope(scope, 'exercises', requiredContent.exercises);
  await submitScope(scope, 'articles', { items: [{ text: `${lessonId}正文第一段` }] });
}

describe('教材检测：真实指纹、内容统计、补课与重复导入', () => {
  it('部分导入明确报告；补齐后按真实状态报告已完成；改名识别、同名不同文件和其他用户不匹配', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    let partial = true;
    const scripts = new Map<string, ChapterScript>([
      ['l1', async (scope) => { await submitLesson(scope, 'l1'); }],
      ['l2', async (scope) => { if (!partial) await submitLesson(scope, 'l2'); }],
    ]);
    const harness = harnessInjection(repo, scripts);
    const app = createPdfImportRoutes({ repo, server: {} as never, port: 0 });
    const input = { userId: 'owner', documentId: 'book', title: '教材', pdf: new Uint8Array(await Bun.file(fixture).arrayBuffer()), poolSize: 1, modelRetries: 0,
      tocEntries: [{ id: 'l1', title: '第一章', level: 'lesson' as const, startPage: 1 }, { id: 'l2', title: '第二章', level: 'lesson' as const, startPage: 2 }],
      lessonJobs: [{ lessonId: 'l1', text: '第一章' }, { lessonId: 'l2', text: '第二章' }],
      ...harness.extra,
    };
    const inspect = async (user = 'owner', file = fixture) => {
      const response = await app.request(`/api/documents/${user}/inspect-import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: '改名.pdf', filePath: fileURLToPath(file) }) });
      expect(response.status).toBe(200); return TextbookInspectionResultSchema.parse(await response.json());
    };
    const first = await repo.executeTextbookPipeline(input);
    expect(first.ok && first.value.failedLessons).toBe(1);
    const partialReport = await inspect(); expect(partialReport.status).toBe('partial'); expect(partialReport.summary).toContain('1/2'); expect(partialReport.matchedDocument?.lineCount).toBe(1);
    expect(partialReport.matchedDocument?.lessonDetails[0]?.hasPassage).toBe(true); expect(partialReport.matchedDocument?.exerciseCount).toBe(1);
    partial = false;
    const asksBeforeComplement = harness.driver.asks.length;
    expect((await repo.executeTextbookPipeline(input)).ok).toBe(true);
    expect(harness.driver.asks.length).toBeGreaterThan(asksBeforeComplement);
    const ready = await inspect(); expect(ready.status).toBe('ready'); expect(ready.matchedDocument?.readyLessonCount).toBe(2); expect(ready.matchedDocument?.lineCount).toBe(2);
    const calls = harness.driver.asks.length;
    expect((await repo.executeTextbookPipeline(input)).ok).toBe(true); expect(harness.driver.asks.length).toBe(calls);
    expect((await inspect('other')).matchedDocument).toBeUndefined();
    expect((await inspect('owner', new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url))).status).toBe('not_imported');
  });
});
