import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfTaskWorkspace, directoryWindow } from '../application/pdf-import/pdf-task-workspace.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { harnessInjection, stubPoolDriver, type ChapterScript } from './agentpool-pipeline-harness.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import type { AgentPoolLease } from '@study-studio/agent-runtime';
import * as schema from '@study-studio/storage-sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { pinProcessToTestRuntime } from './pdf-test-runtime.js';

pinProcessToTestRuntime();

const repos: DrizzleLearnerRepository[] = [];
const workspaces: PdfTaskWorkspace[] = [];
afterEach(async () => { for (const ws of workspaces.splice(0)) await ws.close(); for (const repo of repos.splice(0)) repo.getRawDb().close(); });
export async function textPdf(count: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) pdf.addPage().drawText(`PDF page marker ${i}`, { x: 30, y: 300, font });
  return pdf.save();
}
async function workspace(bytes: Uint8Array) {
  const created = await PdfTaskWorkspace.create(bytes); if (!created.ok) throw created.error;
  workspaces.push(created.value); return created.value;
}
let fileRpcSeq = 0;
async function submitRequiredScope(scope: McpChapterScope) {
  for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
    const result = await scope.submission.execute(kind, requiredContent[kind], `file-${++fileRpcSeq}`);
    if (!result.ok) throw result.error;
  }
}
describe('裁剪 PDF → 连续 Worker → 内容暂存 → 章节事务', () => {
  it('目录定位窗：起点前留 2 页余量，首尾夹紧', async () => {
    expect(directoryWindow(371, 17)).toEqual([15, 16, 17, 18, 19, 20, 21]);
    expect(directoryWindow(371, 1)).toEqual([1, 2, 3, 4, 5]);
    expect(directoryWindow(371, 371)).toEqual([369, 370, 371]);
  }, 30000);
  it('无内置书签的 PDF 定位返回 null，走既有默认', async () => {
    const ws = await workspace(await textPdf(2));
    expect(ws.findDirectoryPage()).toBeNull();
  }, 30000);
  it('裁剪只保留指定页面并记录原页映射；有字版零图片，只放文件', async () => {
    const ws = await workspace(await textPdf(4));
    const sliced = await ws.slice('1.pdf', [2, 4]); if (!sliced.ok) throw sliced.error;
    expect((await PDFDocument.load(await Bun.file(sliced.value.path).bytes())).getPageCount()).toBe(2);
    expect(sliced.value.originalPages).toEqual([2, 4]);
    expect(sliced.value.images).toEqual([]);
    expect(existsSync(sliced.value.path)).toBe(true);
    expect(existsSync(`${sliced.value.path}.page-1.png`)).toBe(false);
  }, 30000);
  it('扫描版备图推迟到开工：切片只有 PDF，prepareImages 后按切片页序映射原页，网关不运行 OCR', async () => {
    const ws = await workspace(await Bun.file(new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url)).bytes());
    const sliced = await ws.slice('1.pdf', [1]); if (!sliced.ok) throw sliced.error;
    expect(sliced.value.images).toEqual([]);
    const ready = await ws.prepareImages(sliced.value); if (!ready.ok) throw ready.error;
    expect(ready.value.images).toHaveLength(1);
    expect(ready.value.images[0]).toMatchObject({ page: 1, originalPage: 1 });
    expect(existsSync(ready.value.images[0]!.path)).toBe(true);
    expect((await Bun.file(ready.value.images[0]!.path).bytes()).subarray(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
    // 幂等：重复备料不重复烘图。
    const again = await ws.prepareImages(sliced.value); if (!again.ok) throw again.error;
    expect(again.value.images).toHaveLength(1);
  }, 30000);
  it('非法、重复页和文件名均拒绝，不静默夹持到合法页', async () => {
    const ws = await workspace(await textPdf(2));
    for (const [name, pages] of [['1.pdf', [3]], ['1.pdf', [1, 1]], ['../1.pdf', [1]], ['1.pdf', []]] as const) {
      const result = await ws.slice(name, [...pages]); expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('E_PDF_PAGE_RANGE_INVALID');
    }
  }, 30000);
  it('全部文件先准备；一个 Worker 连续处理两课；迟到工具拒绝；完成后清理整目录', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const db = drizzle(repo.getRawDb(), { schema });
    const paths: string[] = [];
    let previous: McpChapterScope | undefined;
    async function submitChapterText(scope: McpChapterScope, pdfPath: string | undefined, originalPages: readonly number[]) {
      if (!pdfPath) throw new Error('Missing chapter PDF');
      paths.push(pdfPath);
      const text = `PDF page marker ${originalPages[0]}`;
      expect((await scope.submission.execute('articles', { items: [{ text }] }, `rpc-text-${paths.length}`)).ok).toBe(true);
      expect(db.select().from(schema.textbookArticles).all()).toHaveLength(paths.length - 1);
      await submitRequiredScope(scope);
    }
    const harness = harnessInjection(repo, new Map<string, ChapterScript>([
      ['a', async (scope, job) => { await submitChapterText(scope, job.pdfFile?.path, job.pdfFile?.originalPages ?? []); }],
      ['b', async (scope, job) => {
        await submitChapterText(scope, job.pdfFile?.path, job.pdfFile?.originalPages ?? []);
        if (previous) {
          const late = await previous.submission.execute('articles', { items: [{ text: '旧轮次污染' }] }, 'rpc-late');
          expect(late.ok ? '' : late.error.code).toBe('E_SUBMISSION_SCOPE_INVALID');
        }
        previous = scope;
      }],
    ]));
    const result = await repo.executeTextbookPipeline({userId:'pdf-owner',title:'文件教材',documentId:'file-book',tocEntries:[{id:'a',title:'第一课',level:'lesson',startPage:1,endPage:1},{id:'b',title:'第二课',level:'lesson',startPage:2,endPage:2}],pdf:await textPdf(2),poolSize:1,modelRetries:0,...harness.extra});
    expect(result.ok && result.value.successfulLessons).toBe(2);
    expect(harness.driver.asks).toHaveLength(2); expect(harness.driver.finishes).toHaveLength(1);
    expect(db.select().from(schema.textbookArticles).all().map(row=>row.text)).toEqual(['PDF page marker 1','PDF page marker 2']);
    expect(paths.every(path => !existsSync(path))).toBe(true);
  },30000);
  it('章节页码越界仅该章失败，其他章事务继续完成', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const harness = harnessInjection(repo, new Map<string, ChapterScript>([['a', async (scope) => { await submitRequiredScope(scope); }]]));
    const result = await repo.executeTextbookPipeline({userId:'owner',title:'页码核对',tocEntries:[{id:'a',title:'有效章节',level:'lesson',startPage:1,endPage:1},{id:'b',title:'越界章节',level:'lesson',startPage:3,endPage:4}],pdf:await textPdf(2),modelRetries:0,...harness.extra});
    expect(result.ok && [result.value.successfulLessons,result.value.failedLessons]).toEqual([1,1]);
    expect(harness.driver.asks).toHaveLength(1);
  },30000);
  it('取消后不提交暂存内容，先关闭会话再删除任务 PDF', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const controller = new AbortController();
    let path = '', fileExistedAtFinish = false;
    const driver = stubPoolDriver();
    const finishing = driver.finish.bind(driver);
    driver.finish = (async (lease: AgentPoolLease) => { fileExistedAtFinish = existsSync(path); return finishing(lease); }) as typeof driver.finish;
    const harnessWithDriver = harnessInjection(repo, new Map<string, ChapterScript>([['a', async (scope, job) => {
      path = job.pdfFile?.path ?? '';
      expect(existsSync(path)).toBe(true);
      expect((await scope.submission.execute('articles', { items: [{ text: '尚未提交' }] }, 'rpc-cancel')).ok).toBe(true);
      controller.abort();
    }]]), driver);
    const result = await repo.executeTextbookPipeline({userId:'owner',title:'取消教材',tocEntries:[{id:'a',title:'当前课',level:'lesson',startPage:1,endPage:1}],pdf:await textPdf(1),signal:controller.signal,modelRetries:0,...harnessWithDriver.extra});
    expect(result.ok).toBe(false); if(!result.ok) expect(result.error.code).toBe('E_CANCELLED');
    expect(fileExistedAtFinish).toBe(true); expect(existsSync(path)).toBe(false); expect(driver.finishes).toHaveLength(1);
    expect(drizzle(repo.getRawDb(),{schema}).select().from(schema.textbookArticles).all()).toHaveLength(0);
  },30000);
});
