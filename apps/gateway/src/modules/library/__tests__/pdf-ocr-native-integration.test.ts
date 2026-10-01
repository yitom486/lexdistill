import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { isOk } from '@study-studio/shared';
import { canonicalizeTocEntries } from '@study-studio/document-model';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';
import { producePdfLessons } from '../application/pdf-import/lesson-content-slicer.js';
import { TextbookPipelineJobRegistry } from '../application/pipeline-job-runner.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { pipelineModel, submissionFromPrompt } from './textbook-pipeline-fixtures.js';

pinProcessToTestRuntime();
const { inspector } = await ensurePdfTestRuntime();
const fixture = new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url);
const bytes = new Uint8Array(await Bun.file(fixture).arrayBuffer());
// 实际原生识别仅验证目录探测所需能力；在正文链路边界注入受控解析器，禁止测试调用付费云端。
const chapterParser = { parse: async (pdf: Uint8Array, pages: readonly number[]) => {
  const raw = await inspector.processPdfWithOcr(pdf, { pageNumbers: pages.map((_, index) => index + 1) });
  return { parser: 'mineru-cloud' as const, blocks: pages.map((page, index) => ({ id: `p${page}b0`, page, kind: 'TEXT' as const, text: raw.pages?.[index]?.markdown ?? raw.markdown ?? '' })) };
} };
const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
async function threadCpuSnapshot(): Promise<Map<number, number>> {
  if (process.platform !== 'win32') return new Map();
  const child = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Process -Id ${process.pid}).Threads | ForEach-Object { [pscustomobject]@{ id = $_.Id; cpuMs = $_.TotalProcessorTime.TotalMilliseconds } } | ConvertTo-Json -Compress`,
  ], { stdout: 'pipe', stderr: 'pipe' });
  const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit !== 0) throw new Error(`线程 CPU 采样失败：${error}`);
  const rows = z.array(z.object({ id: z.number(), cpuMs: z.number() })).parse(JSON.parse(output));
  return new Map(rows.map(row => [row.id, row.cpuMs]));
}

describe('真实原生 OCR 与教材流水线', () => {
  it('真实 ONNX/OCR 推理返回日语、坐标和置信度', async () => {
    const result = await inspector.processPdfWithOcr(bytes, { pageNumbers: [1] });
    expect(result.pageCount).toBe(3); expect(result.pages).toHaveLength(1);
    expect(result.ocrTimeMs).toBeGreaterThan(0);
    expect(result.markdown).toContain('第1課'); expect(result.markdown).toContain('会話');
    const span = result.pages?.[0]?.spans?.[0];
    expect(span?.text.length).toBeGreaterThan(0); expect(span?.width).toBeGreaterThan(0); expect(span?.confidence).toBeGreaterThan(0);
  }, 120000);
  it('真实多页批次与逐页推理结果一致，记录串行/批次耗时，不承诺固定加速', async () => {
    const beginSerial = performance.now();
    const serial = [];
    for (const page of [1, 2, 3]) serial.push(await inspector.processPdfWithOcr(bytes, { pageNumbers: [page] }));
    const serialMs = performance.now() - beginSerial;
    const beforeCpu = await threadCpuSnapshot();
    const beginBatch = performance.now();
    const batch = await inspector.processPdfWithOcr(bytes, { pageNumbers: [1, 2, 3] });
    const batchMs = performance.now() - beginBatch;
    const afterCpu = await threadCpuSnapshot();
    const activeThreads = [...afterCpu].map(([id, cpuMs]) => ({ id, cpuMs: cpuMs - (beforeCpu.get(id) ?? cpuMs) })).filter(thread => thread.cpuMs >= 50);
    if (process.platform === 'win32') expect(activeThreads.length).toBeGreaterThanOrEqual(2);
    expect(batch.pages).toHaveLength(3);
    for (const page of batch.pages ?? []) expect(page.markdown).toBe(serial[page.pageNumber - 1]?.pages?.[0]?.markdown ?? '');
    await Bun.write('.studio-internal/textbook-ocr-measurements.json', JSON.stringify({ serialMs, batchMs, activeThreads, serialOcrTimeMs: serial.map(result => result.ocrTimeMs), batchOcrTimeMs: batch.ocrTimeMs,
      note: 'Windows 原生多页推理前后线程 CPU 增量；至少两条计算线程参与。公开接口未提供独立渲染计时，采样不能区分 ONNX 内部线程与 Rayon worker；Rayon 页并行路径依据对应版本源码。',
    }, null, 2));
  }, 120000);
  it('章节范围不被小节截断，末章包含 PDF 尾页；越界单章失败不停止其他章', async () => {
    const entries = canonicalizeTocEntries([
      { id: 'l1', title: '第一章', level: 'lesson', startPage: 1 },
      { id: 's1', title: '小节', level: 'section', startPage: 2, parentId: 'l1' },
      { id: 'l2', title: '末章', level: 'lesson', startPage: 3 },
      { id: 'bad', title: '越界', level: 'lesson', startPage: 4 },
    ]);
    const texts = new Map<string, string>(), failed: string[] = [];
    await producePdfLessons({ pdf: bytes, inspector, parser: chapterParser, lessons: entries.filter(entry => entry.level === 'lesson'), concurrency: 2, retries: 0, signal: new AbortController().signal,
      onStart: () => {}, onText: async (lesson, text) => { texts.set(lesson.id, text); }, onFailure: (lesson, error) => { failed.push(error.code); expect(lesson.id).toBe('bad'); },
    });
    expect(texts.get('l1')).toContain('第2課'); expect(texts.get('l2')).toContain('ふくしゅう'); expect(failed).toEqual(['E_PDF_PAGE_RANGE_INVALID']);
  }, 120000);
  it('真实扫描文字进入工具会话后结构化落库，OCR 原文没有写作正式正文', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const tool = new TextbookContentTools(repo);
    const model = pipelineModel(tool, async ({ input, submit }) => {
      expect(input.message).toContain('第1課'); expect(input.message).toContain('会話');
      expect(input.message).not.toContain('properties'); expect(input.message).not.toContain('passageMd');
      expect((await submit(submissionFromPrompt(input.message))).ok).toBe(true);
    });
    const result = await repo.executeTextbookPipeline({ userId: 'native', title: '扫描教材', pdf: bytes, inspector, chapterParser,
      tocEntries: [{ id: 'l1', title: '第一章', level: 'lesson', startPage: 1, endPage: 1 }], poolSize: 1, adapter: model.adapter, submissionTool: tool });
    expect(isOk(result)).toBe(true); expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect(model.closed).toHaveLength(1);
    const doc = await repo.getDocumentById(result.ok ? result.value.documentId : '');
    expect(doc.ok && doc.value?.astJson).toContain('整理后的正文 第一章');
  }, 120000);
  it('HTTP 本地路径 → 后台注册 → 原生 OCR → 工具 → SQLite 完成，透传用户模型和思考等级', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const registry = new TextbookPipelineJobRegistry(), tool = new TextbookContentTools(repo), model = pipelineModel(tool);
    const app = createPdfImportRoutes({ repo, server: { pipelineJobs: registry } as never, port: 0 }, { adapter: model.adapter, submissionTool: tool, chapterParser });
    const response = await app.request('/api/documents/native/textbook-pipeline-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      filePath: fileURLToPath(fixture), title: '扫描教材', model: 'user-model', effort: 'low', poolSize: 1,
      tocEntries: [{ id: 'l1', title: '第一章', level: 'lesson', startPage: 1, endPage: 1 }],
    }) });
    expect({status:response.status,...(response.status!==202 ? {body:await response.text()} : {})}).toEqual({status:202});
    const initial = await response.json() as { jobId: string };
    const deadline = Date.now() + 90000;
    while (registry.get(initial.jobId)?.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    const result = registry.get(initial.jobId);
    expect(result?.status).toBe('done'); expect(result?.successfulLessons).toBe(1); expect(result?.lessonStages?.l1).toBe('saved');
    expect(model.created[0]?.model).toBe('user-model'); expect(model.inputs[0]?.input.turnOptions?.effort).toBe('low'); expect(model.closed).toHaveLength(1);
  }, 120000);
});
