import { describe, expect, it, afterEach } from 'bun:test';
import {
  requestExecuteTextbookPipeline,
  type ExecuteTextbookPipelineVars,
  type ExecuteTextbookPipelineResult,
} from '../textbooks-annotations.js';

/**
 * 教材流水线前端请求层集成测试（无私人 PDF、无真实网关）。
 * 全局 fetch 桩按 URL 路由并记录每次调用的方法/地址/体，
 * 验证请求参数形态、成功响应解析与后端错误 userMessage 透传。
 */

interface RecordedCall {
  url: string;
  method: string;
  contentType: string | null;
  jsonBody: Record<string, unknown> | null;
}

const calls: RecordedCall[] = [];
let nextResponse: { status: number; payload: unknown } = { status: 200, payload: {} };

const originalFetch = globalThis.fetch;

function installFetchStub(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    let jsonBody: Record<string, unknown> | null = null;
    const body = init?.body;
    if (typeof body === 'string') {
      try {
        jsonBody = JSON.parse(body) as Record<string, unknown>;
      } catch {
        jsonBody = null;
      }
    }
    calls.push({ url, method, contentType: headers.get('content-type'), jsonBody });
    return new Response(JSON.stringify(nextResponse.payload), {
      status: nextResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls.length = 0;
  nextResponse = { status: 200, payload: {} };
});

const PIPELINE_SUCCESS_PAYLOAD: ExecuteTextbookPipelineResult = {
  task: { id: 'task-100', status: 'completed', lessons: 2 },
  documentId: 'doc_minna_1',
  title: '新版标准日本语 初级上册',
  lessonCount: 2,
  allLessonsReady: true,
  successfulLessons: 2,
  failedLessons: 0,
  errors: [],
};

describe('requestExecuteTextbookPipeline 请求层', () => {
  it('正确装配并发出 POST 请求到 execute-textbook-pipeline', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: PIPELINE_SUCCESS_PAYLOAD };

    const vars: ExecuteTextbookPipelineVars = {
      title: '新版标准日本语 初级上册',
      language: 'ja',
      filename: 'sample.pdf',
      tocEntries: [
        { title: '第1課', printedPage: 14, physicalPage: 18 },
        { title: '第2課', printedPage: 26, physicalPage: 30 },
      ],
      lessonJobs: [
        { lessonId: 'lesson-1', title: '第1課', ocrText: '第1課 私の友達' },
        { lessonId: 'lesson-2', title: '第2課', ocrText: '第2課 これは本です' },
      ],
    };

    const res = await requestExecuteTextbookPipeline('user_123', vars);

    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/api/documents/user_123/execute-textbook-pipeline');
    expect(calls[0]?.contentType).toBe('application/json');
    expect(calls[0]?.jsonBody).toMatchObject({
      title: '新版标准日本语 初级上册',
      language: 'ja',
      filename: 'sample.pdf',
    });
    expect(res.documentId).toBe('doc_minna_1');
    expect(res.allLessonsReady).toBe(true);
    expect(res.successfulLessons).toBe(2);
  });

  it('后端业务错误友好信息透传 (E_TOC_SLOT_NOT_FOUND 等)', async () => {
    installFetchStub();
    nextResponse = {
      status: 400,
      payload: {
        success: false,
        error: {
          code: 'E_TOC_SLOT_NOT_FOUND',
          userMessage: '章节槽位未在教材骨架中找到，请重新核验目录',
          category: 'VALIDATION',
          retryable: false,
        },
      },
    };

    const vars: ExecuteTextbookPipelineVars = {
      title: '测试教材',
      tocEntries: [],
      lessonJobs: [{ lessonId: 'missing-slot', ocrText: 'some text' }],
    };

    const err = await requestExecuteTextbookPipeline('u1', vars).then(
      () => null,
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('章节槽位未在教材骨架中找到，请重新核验目录');
  });

  it('非正常状态码且无 error 结构时提供兜底友好提示', async () => {
    installFetchStub();
    nextResponse = { status: 500, payload: {} };

    const vars: ExecuteTextbookPipelineVars = {
      title: '测试教材',
      tocEntries: [],
      lessonJobs: [],
    };

    const err = await requestExecuteTextbookPipeline('u1', vars).then(
      () => null,
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('教材导入流水线执行失败（HTTP 500）');
  });
});
