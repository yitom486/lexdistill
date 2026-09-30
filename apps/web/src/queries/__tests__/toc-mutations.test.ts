import { describe, expect, it, afterEach } from 'bun:test';
import {
  requestExecuteTextbookPipeline,
  findMatchingDocument,
  lessonSlotsToTocCandidates,
  type ExecuteTextbookPipelineVars,
  type ExecuteTextbookPipelineResult,
  type RawDocumentSummary,
  type TextbookLessonSlotItem,
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

  it('更新已有教材时正确透传 documentId 与 forceOverwrite 参数', async () => {
    installFetchStub();
    nextResponse = { status: 200, payload: PIPELINE_SUCCESS_PAYLOAD };

    const vars: ExecuteTextbookPipelineVars = {
      documentId: 'doc_existing_123',
      title: '更新现有书',
      forceOverwrite: false,
      tocEntries: [{ title: '第1课', printedPage: 1 }],
    };

    await requestExecuteTextbookPipeline('user_123', vars);

    expect(calls.length).toBe(1);
    expect(calls[0]?.jsonBody).toMatchObject({
      documentId: 'doc_existing_123',
      title: '更新现有书',
      forceOverwrite: false,
    });
  });
});

describe('教材匹配与槽位复用纯函数测试', () => {
  it('findMatchingDocument: 支持完全匹配、规范化去标点匹配与子串匹配', () => {
    const docs: RawDocumentSummary[] = [
      {
        id: 'doc_mtt3n2rp0v4d5u',
        userId: 'user_1',
        title: 'minna1',
        sourceKind: 'user_import',
        language: 'ja',
        content: '日本3A出版社 编写 第二版 みんなの日本語 大家的日本語 教材',
        createdAt: '2026-09-29T10:00:00Z',
        updatedAt: '2026-09-29T10:00:00Z',
      },
      {
        id: 'minna-nihongo-1',
        userId: 'system',
        title: '大家的日语 第1册 (Minna no Nihongo I)',
        sourceKind: 'curriculum_textbook',
        language: 'ja',
        content: '',
        createdAt: '2026-09-29T10:00:00Z',
        updatedAt: '2026-09-29T10:00:00Z',
      },
    ];

    // 1. 完全一致
    const match1 = findMatchingDocument('minna1', docs);
    expect(match1?.id).toBe('doc_mtt3n2rp0v4d5u');

    // 2. 规范化匹配（不同括号与标点）
    const match2 = findMatchingDocument('大家的日语（第 1 册）', docs);
    expect(match2?.id).toBe('minna-nihongo-1');

    // 3. 子串匹配
    const match3 = findMatchingDocument('大家的日语', docs);
    expect(match3?.id).toBe('minna-nihongo-1');

    // 4. 通用文本特征与底稿内容匹配（长文件名 大家的日语（初级 1）系列 第二版（日本 3A 出版社）动态命中包含该底稿内容的 minna1）
    const matchAlias = findMatchingDocument(
      '大家的日语（初级 1）大家的日语系列 第二版（日本 3A 出版社）(z-library)',
      docs
    );
    expect(matchAlias).not.toBeNull();
    // 命中包含 3A出版社/第二版/大家的日语 的 doc_mtt3n2rp0v4d5u
    expect(matchAlias?.id).toBe('doc_mtt3n2rp0v4d5u');

    // 5. 无匹配
    const matchNone = findMatchingDocument('完全不相干的未知法语教材', docs);
    expect(matchNone).toBeNull();
  });

  it('lessonSlotsToTocCandidates: 准确将持久化槽位映射为可编辑目录候选', () => {
    const slots: TextbookLessonSlotItem[] = [
      {
        documentId: 'doc_01',
        lessonId: 'l1',
        lessonNumber: 1,
        title: '第 1 课 初次见面',
        sortOrder: 1,
        kind: 'lesson',
        parentId: null,
        startPage: 14,
        endPage: 22,
        status: 'ready',
        hasPassage: true,
        hasPreview: true,
        hasSummary: true,
      },
      {
        documentId: 'doc_01',
        lessonId: 'u1',
        lessonNumber: 2,
        title: '第 1 单元 总结',
        sortOrder: 2,
        kind: 'chapter',
        parentId: null,
        startPage: 23,
        endPage: 25,
        status: 'pending',
        hasPassage: false,
        hasPreview: false,
        hasSummary: false,
      },
    ];

    const candidates = lessonSlotsToTocCandidates(slots);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.key).toBe('l1');
    expect(candidates[0]!.title).toBe('第 1 课 初次见面');
    expect(candidates[0]!.printedPage).toBe(''); // 槽位只保存 PDF 物理页，不臆造印刷页
    expect(candidates[0]!.level).toBe(1);
    expect(candidates[0]!.kind).toBe('lesson');
    expect(candidates[0]!.physicalPage).toBe(14);

    expect(candidates[1]!.key).toBe('u1');
    expect(candidates[1]!.kind).toBe('section');
    expect(candidates[1]!.level).toBe(2);
  });
});
