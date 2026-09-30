import { describe, expect, it } from 'bun:test';
import type { AgentAdapter, AgentInput, AgentSession, CreateSessionOptions } from '@study-studio/agent-runtime';
import { ok } from '@study-studio/shared';
import { ToolRegistry } from '@study-studio/tool-core';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { LibraryProposeTocTool } from '../tools/library-propose-toc-tool.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const validEntries = [
  { title: '第1課 はじめまして', level: 'lesson', startPage: 6 },
  { title: '第2課 これからお世話になります', level: 'lesson', startPage: 18 },
];

function harness(entries: unknown = validEntries) {
  let ocrCalls = 0;
  let renderedPages: number[] = [];
  let seenInput: AgentInput | undefined;
  let seenOptions: CreateSessionOptions | undefined;
  const tool = new LibraryProposeTocTool();
  const registry = new ToolRegistry();
  registry.register(tool);
  const inspector: PdfInspectorLike = {
    processPdf: () => ({ pageCount: 371 }),
    processPdfWithOcr: async () => {
      ocrCalls++;
      return { markdown: 'bad flattened OCR' };
    },
    renderPdfPages: async (_pdf, pages) => {
      renderedPages = pages;
      return pages.map((pageNumber) => ({ pageNumber, png, width: 100, height: 160 }));
    },
  };
  const adapter: AgentAdapter = {
    id: 'mock-vision',
    name: 'Mock Vision',
    supportsImageInput: () => true,
    async createSession(options) {
      seenOptions = options;
      const session: AgentSession = {
        sessionId: options.sessionId,
        async *send(input) {
          seenInput = input;
          const result = await tool.execute({ entries } as never, {
            sessionId: options.sessionId,
            userId: options.userId,
          });
          if (!result.ok) yield { type: 'ERROR', error: result.error } as const;
          else yield { type: 'COMPLETED' } as const;
        },
        submitToolResult: async () => ok(undefined),
        submitApproval: async () => ok(undefined),
        steer: async () => ok(undefined),
        interrupt: async () => ok(undefined),
        close: async () => ok(undefined),
      };
      return ok(session);
    },
    async resumeSession() {
      throw new Error('此视觉会话不得恢复旧 Thread');
    },
  };
  // 本测试仅触发目录视觉路由，所需 Gateway 字段由真实 Registry 和 mock Adapter 提供。
  const deps = { server: { toolRegistry: registry, agentAdapter: adapter } } as GatewayDeps;
  const app = createPdfImportRoutes(deps, { loadInspector: async () => inspector });
  async function post() {
    const body = new FormData();
    body.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'book.pdf', { type: 'application/pdf' }));
    body.set('startPage', '16');
    body.set('endPage', '17');
    return app.request('/api/documents/u1/extract-toc-llm', { method: 'POST', body });
  }
  async function latestTrace() {
    const response = await app.request('/api/toc-vision/u1/traces');
    const body = await response.json() as {
      traces: Array<{ status: string; events: Array<{ stage: string; details?: Record<string, unknown> }> }>;
    };
    return body.traces[0];
  }
  return { post, latestTrace, get ocrCalls() { return ocrCalls; }, get renderedPages() { return renderedPages; },
    get seenInput() { return seenInput; }, get seenOptions() { return seenOptions; } };
}

describe('目录视觉识别 HTTP 闭环', () => {
  it('原页 PNG 作为附件，专用会话仅注入草稿工具，OCR 不参与', async () => {
    const flow = harness();
    const response = await flow.post();
    expect(response.status).toBe(200);
    const body = await response.json() as { entries: Array<{ title: string; startPage: number }> };
    expect(body.entries.map((entry) => entry.startPage)).toEqual([6, 18]);
    expect(body.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'toc-1', level: 'lesson' }), expect.objectContaining({ id: 'toc-2', level: 'lesson' })]));
    expect(flow.renderedPages).toEqual([16, 17]);
    expect(flow.ocrCalls).toBe(0);
    expect(flow.seenInput?.attachments?.map((attachment) => attachment.png)).toEqual([png, png]);
    expect(flow.seenInput?.message).not.toContain('bad flattened OCR');
    expect(flow.seenInput?.message).toContain('library_propose_toc');
    expect(flow.seenOptions?.tools?.map((candidate) => candidate.name)).toEqual(['library.propose_toc']);
    expect(flow.seenOptions?.systemPrompt).toContain('必须通过本会话提供的目录草稿工具提交结果');
    expect(flow.seenOptions?.ephemeral).toBe(true);
    const trace = await flow.latestTrace();
    expect(trace?.status).toBe('completed');
    expect(trace?.events.map((event) => event.stage)).toContain('render_completed');
    expect(trace?.events.map((event) => event.stage)).toContain('tool_validation_accepted');
    expect(JSON.stringify(trace)).not.toContain('book.pdf');
    expect(JSON.stringify(trace)).not.toContain('第1課 はじめまして');
  });

  it('印刷页码倒退时工具拒绝，HTTP 不返回目录草稿', async () => {
    const flow = harness([
      { title: '第1課', level: 'lesson', startPage: 18 },
      { title: '第2課', level: 'lesson', startPage: 6 },
    ]);
    const response = await flow.post();
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('E_TOC_PAGE_ORDER_INVALID');
    expect(flow.ocrCalls).toBe(0);
    const trace = await flow.latestTrace();
    expect(trace?.status).toBe('failed');
    expect(trace?.events.some((event) => event.stage === 'tool_validation_rejected' && event.details?.code === 'E_TOC_PAGE_ORDER_INVALID')).toBe(true);
  });

  it('工具参数结构错误时返回 Schema 错误', async () => {
    const flow = harness([{ title: '第1課', level: 'lesson', startPage: 'six' }]);
    const response = await flow.post();
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('E_LLM_SCHEMA_INVALID');
  });
});
