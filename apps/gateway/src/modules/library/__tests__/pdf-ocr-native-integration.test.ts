import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { unlink } from 'node:fs/promises';
import { isOk } from '@study-studio/shared';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';
import { slicePdfLessonsWithOcr } from '../application/pdf-import/lesson-content-slicer.js';
import { TextbookPipelineJobRegistry } from '../application/pipeline-job-runner.js';
import type { AgentPoolLike } from '../application/lesson-batch-extractor.js';
import type { TextbookPipelineJobSnapshot } from '@study-studio/protocol';

/**
 * 真实 OCR 引擎与扫描教材切片全链路集成测试（Native OCR Integration Test）
 *
 * 验证重点：
 * 1. 原生 OCR 引擎能否通过 ONNX Runtime 正常加载 Det/Rec 模型并完成真实图像推理；
 * 2. 局部页码切片提取器能否正确识别扫描页并无缝调用 processPdfWithOcr；
 * 3. 一条龙流水线在面对扫描版教材时，能否通过真实 OCR 提取正文并驱动后续结构化提炼；
 * 4. 网关 HTTP 路由层在接收到本地 filePath 扫描教材时，能否通过 ensurePdfRuntime({ needOcr: true })
 *    完整注入 ORT_DYLIB_PATH 并驱动一条龙流水线，彻底杜绝 "failed to create ONNX session" 崩溃。
 */

pinProcessToTestRuntime();
const { inspector } = await ensurePdfTestRuntime();

const SCANNED_PDF_URL = new URL('./fixtures/scanned-lesson-dialect.pdf', import.meta.url);

const repos: DrizzleLearnerRepository[] = [];
const tempFiles: string[] = [];

afterEach(async () => {
  for (const r of repos.splice(0)) r.getRawDb().close();
  for (const f of tempFiles.splice(0)) {
    try {
      await unlink(f);
    } catch {
      /* 已清理或未写盘 */
    }
  }
});

async function copyScannedFixtureToTemp(): Promise<{ path: string; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await Bun.file(SCANNED_PDF_URL).arrayBuffer());
  expect(bytes.byteLength).toBeGreaterThan(0);
  const tmp = join(tmpdir(), `test-ocr-scan-${process.pid}-${Date.now()}.pdf`);
  await Bun.write(tmp, bytes);
  expect(isAbsolute(tmp)).toBe(true);
  tempFiles.push(tmp);
  return { path: tmp, bytes };
}

describe('真实 Native OCR 引擎直接调用集成测试 (Direct processPdfWithOcr)', () => {
  it('真实加载 ONNX 运行时与 OCR 模型，完成扫描页字符推理与 Span 定位', async () => {
    const { bytes } = await copyScannedFixtureToTemp();

    // 1. 直接调用底层 Rust NAPI 插件 processPdfWithOcr
    const ocrResult = await inspector.processPdfWithOcr(bytes, { pageNumbers: [1] });

    // 2. 验证基本返回结构
    expect(ocrResult).toBeDefined();
    expect(ocrResult.pageCount).toBe(3);
    expect(ocrResult.pages).toHaveLength(1);

    // 3. 验证真实执行了 OCR 推理耗时（非 mock 静态返回）
    expect(ocrResult.ocrTimeMs).toBeDefined();
    expect(ocrResult.ocrTimeMs).toBeGreaterThan(0);

    // 4. 验证 OCR 模型识别出了图片中的真实日语文本
    const markdown = ocrResult.markdown ?? '';
    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown).toContain('第1課');
    expect(markdown).toContain('会話');

    // 5. 验证 Span 级行坐标与置信度元数据
    const spans = ocrResult.pages?.[0]?.spans ?? [];
    expect(spans.length).toBeGreaterThan(0);
    const firstSpan = spans[0];
    expect(firstSpan?.text.length).toBeGreaterThan(0);
    expect(firstSpan?.width).toBeGreaterThan(0);
    expect(firstSpan?.height).toBeGreaterThan(0);
    expect(firstSpan?.confidence).toBeGreaterThan(0);
  }, 120000);
});

describe('课文切片抽取器扫描页降级与并发 OCR 提取集成测试 (slicePdfLessonsWithOcr)', () => {
  it('课内小节不截断整课，最后一课自动包含 PDF 末页，非法范围直接拒绝', async () => {
    const { bytes } = await copyScannedFixtureToTemp();
    const result = await slicePdfLessonsWithOcr({ pdf: bytes, inspector, tocEntries: [
      { id: 'l1', level: 'lesson', title: '第1課', startPage: 1 },
      { id: 's1', level: 'section', title: '練習A', startPage: 2, parentId: 'l1' },
      { id: 'l2', level: 'lesson', title: '復習', startPage: 3 },
    ] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value[0]?.endPage).toBe(2);
    expect(result.value[0]?.ocrText).toContain('第2課');
    expect(result.value[1]?.endPage).toBe(3);
    expect(result.value[1]?.ocrText).toContain('ふくしゅう');
    const last = await slicePdfLessonsWithOcr({ pdf: bytes, inspector, tocEntries: [
      { id: 'l1', level: 'lesson', title: '第2課及其复习', startPage: 2 },
    ] });
    expect(last.ok).toBe(true);
    if (last.ok) {
      expect(last.value[0]?.endPage).toBe(3);
      expect(last.value[0]?.ocrText).toContain('ふくしゅう');
    }
    const invalid = await slicePdfLessonsWithOcr({ pdf: bytes, inspector, tocEntries: [
      { id: 'l1', level: 'lesson', title: '越界课', startPage: 4 },
    ] });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('E_PDF_PAGE_RANGE_INVALID');
  }, 120000);

  it('对扫描教材的多课并发切片提取真实 OCR 文本', async () => {
    const { bytes } = await copyScannedFixtureToTemp();

    const tocEntries = [
      { id: 'l1', level: 'lesson' as const, title: '第1課 方言初探', startPage: 1, endPage: 1 },
      { id: 'l2', level: 'lesson' as const, title: '第2課 语法交流', startPage: 2, endPage: 2 },
    ];

    const sliceRes = await slicePdfLessonsWithOcr({
      pdf: bytes,
      tocEntries,
      inspector,
      concurrency: 2,
    });

    expect(isOk(sliceRes)).toBe(true);
    if (!isOk(sliceRes)) return;

    const slices = sliceRes.value;
    expect(slices).toHaveLength(2);

    // 第1课切片校验
    expect(slices[0]?.lessonId).toBe('l1');
    expect(slices[0]?.title).toBe('第1課 方言初探');
    expect(slices[0]?.startPage).toBe(1);
    expect(slices[0]?.endPage).toBe(1);
    expect(slices[0]?.ocrText.length).toBeGreaterThan(0);
    expect(slices[0]?.ocrText).toContain('第1課');

    // 第2课切片校验
    expect(slices[1]?.lessonId).toBe('l2');
    expect(slices[1]?.title).toBe('第2課 语法交流');
    expect(slices[1]?.startPage).toBe(2);
    expect(slices[1]?.endPage).toBe(2);
    expect(slices[1]?.ocrText.length).toBeGreaterThan(0);
  }, 120000);
});

describe('教材提炼一条龙全链路集成测试（真实扫描 PDF 自动切片 + 模型结构化落库）', () => {
  it('未提供 lessonJobs 时自动通过真实 OCR 切片，识别日语文本并驱动结构化入库', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const { bytes } = await copyScannedFixtureToTemp();

    let capturedPrompt = '';
    const mockPool: AgentPoolLike = {
      acquire: async () => ({
        ask: async (prompt) => {
          capturedPrompt = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
          return {
            text: JSON.stringify({
              passageMd: '# 第1課\n\n## 会话\n\n对话内容...',
              vocabularies: [{ surface: '会話', reading: 'かいわ', glossZh: '会话' }],
              knowledgePoints: [{ title: '～ですね', explanation: '表示认同' }],
              exercises: [{ type: 'CHOICE', prompt: '选择题', options: ['A', 'B'], answer: 'A' }],
            }),
          };
        },
        finish: async () => {},
      }),
      close: async () => {},
    };

    const res = await repo.executeTextbookPipeline({
      userId: 'test_ocr_user',
      title: '扫描教材全流程集成测试',
      pdf: bytes,
      inspector,
      tocEntries: [
        { id: 'l1', level: 'lesson', title: '第1課', startPage: 1, endPage: 1 },
      ],
      pool: mockPool,
    });

    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    // 核心断言：模型 prompt 确实接收到了真实 OCR 引擎从扫描图切片提取出的日语原文
    expect(capturedPrompt.length).toBeGreaterThan(0);
    expect(capturedPrompt).toContain('第1課');
    expect(capturedPrompt).toContain('会話');

    // 流水线结果核验
    expect(res.value.allLessonsReady).toBe(true);
    expect(res.value.successfulLessons).toBe(1);
    expect(res.value.failedLessons).toBe(0);
  }, 120000);
});

describe('网关 HTTP 流水线接口扫描教材一条龙集成测试 (POST /textbook-pipeline-jobs)', () => {
  it('通过本地 filePath 启动流水线任务，网关路由正确准备 OCR 运行时并完成任务注册', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const registry = new TextbookPipelineJobRegistry();
    let closed = false;
    let poolOptions: { model?: string | undefined; effort?: string | undefined; poolSize?: number | undefined } | undefined;
    const app = createPdfImportRoutes({ repo, server: { pipelineJobs: registry } as never, port: 0 }, {
      poolFactory: (options) => {
        poolOptions = options;
        return { acquire: async () => ({
          ask: async () => ({ text: JSON.stringify({ passageMd: '扫描教材的测试提取正文', vocabularies: [{ surface: '会話' }] }) }),
          finish: async () => {},
        }), close: async () => { closed = true; } };
      },
    });
    const { path: tempPdfPath } = await copyScannedFixtureToTemp();

    // 1. 发起 POST 任务请求（与前端 Step 3 行为完全对齐）
    const postRes = await app.request('/api/documents/user_ocr_test/textbook-pipeline-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: tempPdfPath,
        title: '全流程测试扫描教材',
        language: 'ja',
        model: 'test-model-from-user',
        effort: 'low',
        poolSize: 1,
        tocEntries: [
          { id: 'l1', level: 'lesson', title: '第1課', startPage: 1, endPage: 1 },
        ],
      }),
    });

    expect(postRes.status).toBe(202);
    const jobSnapshot = (await postRes.json()) as TextbookPipelineJobSnapshot;
    expect(jobSnapshot.jobId).toBeDefined();
    expect(jobSnapshot.status).toBe('running');
    expect(jobSnapshot.totalLessons).toBe(1);

    // 2. 查询活跃任务与任务详情
    const getRes = await app.request(`/api/documents/user_ocr_test/textbook-pipeline-jobs/${jobSnapshot.jobId}`);
    expect(getRes.status).toBe(200);
    const activeSnapshot = (await getRes.json()) as TextbookPipelineJobSnapshot;
    expect(activeSnapshot.jobId).toBe(jobSnapshot.jobId);
    const deadline = Date.now() + 90_000;
    while (registry.get(jobSnapshot.jobId)?.status === 'running' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(registry.get(jobSnapshot.jobId)?.status).toBe('done');
    expect(closed).toBe(true);
    expect(poolOptions?.model).toBe('test-model-from-user');
    expect(poolOptions?.effort).toBe('low');
    expect(poolOptions?.poolSize).toBe(1);
    const stats = await repo.getTextbookAssetStats(jobSnapshot.documentId);
    expect(stats.ok).toBe(true);
    if (!stats.ok) throw stats.error;
    expect(stats.value.readyLessons).toBe(1);
    expect(stats.value.vocab).toBe(1);
    const recheck = await app.request('/api/documents/user_ocr_test/inspect-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: '重命名扫描教材.pdf', filePath: tempPdfPath }),
    });
    expect(recheck.status).toBe(200);
    const inspection = await recheck.json() as { status: string; matchedDocument: { matchKind: string } };
    expect(inspection.status).toBe('ready');
    expect(inspection.matchedDocument.matchKind).toBe('file');
  }, 120000);
});
