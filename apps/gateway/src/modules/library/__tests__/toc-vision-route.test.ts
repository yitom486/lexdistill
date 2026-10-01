import { describe, expect, it } from 'bun:test';
import type { AgentAdapter, AgentInput, AgentSession, CreateSessionOptions } from '@study-studio/agent-runtime';
import { ok } from '@study-studio/shared';
import { ToolRegistry } from '@study-studio/tool-core';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { LibraryProposeTocTool } from '../tools/library-propose-toc-tool.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { SaveTextbookOutlineResultSchema, TocEntrySchema, ImportEventPageSchema } from '@study-studio/document-model';
import { fileURLToPath } from 'node:url';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { pipelineModel } from './textbook-pipeline-fixtures.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const validEntries = [
  { title: '第1課 はじめまして', level: 'lesson', startPage: 6 },
  { title: '第2課 これからお世話になります', level: 'lesson', startPage: 18 },
];

function harness(entries: unknown = validEntries, repo?: DrizzleLearnerRepository) {
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
          yield { type: 'TOOL_CALL_REQUESTED', callId: 'toc-call', toolName: 'library_propose_toc', input: { entries } };
          const result = await tool.execute({ entries } as never, {
            sessionId: options.sessionId,
            userId: options.userId,
            callId: 'toc-call',
          });
          yield { type: 'TOOL_CALL_COMPLETED', callId: 'toc-call', result };
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
  const deps = { ...(repo ? { repo } : {}), server: { toolRegistry: registry, agentAdapter: adapter } } as GatewayDeps;
  const app = createPdfImportRoutes(deps, { loadInspector: async () => inspector });
  async function post(traceId?: string) {
    const body = new FormData();
    body.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'book.pdf', { type: 'application/pdf' }));
    body.set('startPage', '16');
    body.set('endPage', '17');
    return app.request('/api/documents/u1/extract-toc-llm', { method: 'POST', body, ...(traceId ? { headers: { 'X-Textbook-Trace': traceId } } : {}) });
  }
  async function latestTrace() {
    const response = await app.request('/api/toc-vision/u1/traces');
    const body = await response.json() as {
      traces: Array<{ status: string; events: Array<{ stage: string; details?: Record<string, unknown> }> }>;
    };
    return body.traces[0];
  }
  return { app, post, latestTrace, get ocrCalls() { return ocrCalls; }, get renderedPages() { return renderedPages; },
    get seenInput() { return seenInput; }, get seenOptions() { return seenOptions; } };
}

describe('目录视觉识别 HTTP 闭环', () => {
  it('原生草稿父关系贯通 HTTP → 独立目录保存 → 实际章节目录输入 → SQLite 回执', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const flow = harness([
        { title: '真实单元', level: 'unit', startPage: 1 },
        { title: '独立导入', level: 'section', parentIndex: 0, startPage: 1 },
        { title: '第一课', level: 'lesson', parentIndex: 0, startPage: 2 },
        { title: '课内会话', level: 'section', parentIndex: 2, startPage: 2 },
      ], repo);
      const proposed = await flow.post('directory-to-content'); expect(proposed.status).toBe(200);
      const raw: unknown = await proposed.json();
      expect(typeof raw === 'object' && raw !== null && 'entries' in raw).toBe(true);
      if (typeof raw !== 'object' || raw === null || !('entries' in raw)) throw new Error('目录回执缺失');
      const entries = TocEntrySchema.array().parse(raw.entries);
      expect(entries.map(entry => [entry.id, entry.parentId ?? null])).toEqual([['toc-1', null], ['toc-2', 'toc-1'], ['toc-3', 'toc-1'], ['toc-4', 'toc-3']]);
      const savedResponse = await flow.app.request('/api/documents/u1/textbook-outline', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Textbook-Trace': 'directory-to-content' },
        body: JSON.stringify({ title: '完整目录集成教材', language: 'ja', traceId: 'directory-to-content', filePath: fileURLToPath(new URL('./fixtures/smoke-native-2lessons.pdf', import.meta.url)), tocEntries: entries }),
      });
      expect(savedResponse.status).toBe(200);
      const saved = SaveTextbookOutlineResultSchema.parse(await savedResponse.json());
      expect(saved.lessonCount).toBe(1); expect(saved.totalEntries).toBe(2);
      const before = await repo.getTextbookAssetStats(saved.documentId); expect(before.ok && before.value.lines).toBe(0);
      const tool = new TextbookContentTools(repo), model = pipelineModel(tool);
      const completed = await repo.executeTextbookPipeline({ userId: 'u1', documentId: saved.documentId, traceId: 'directory-to-content', title: saved.title, tocEntries: saved.entries,
        lessonJobs: [{ lessonId: 'toc-2', text: '独立部分的文字' }, { lessonId: 'toc-3', text: '当前课与小节的文字' }], adapter: model.adapter, submissionTool: tool, poolSize: 1, modelRetries: 0,
      });
      expect(completed.ok && completed.value.allLessonsReady).toBe(true);
      expect(model.inputs).toHaveLength(2);
      expect(model.inputs.every(turn=>!turn.input.message.includes('toc-'))).toBe(true);
      expect(model.inputs[0]?.input.message).toContain('独立部分的文字');
      expect(model.inputs[1]?.input.message).toContain('当前课与小节的文字');
      const monitor = ImportEventPageSchema.parse(await (await flow.app.request('/api/documents/u1/textbook-imports/directory-to-content')).json());
      expect(monitor.events.map(event => event.name)).toEqual(expect.arrayContaining(['extract-toc-llm_result', 'confirmed_saved', 'content_saved', 'committed']));
    } finally { repo.getRawDb().close(); }
  });

  it('父节点循环和未知参数拒绝目录草稿，保留具体失败记录且不写教材', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const flow = harness([{ title: '课次', level: 'lesson', startPage: 1, parentIndex: 0 }], repo);
      const rejected = await flow.post('invalid-parent'); expect(rejected.status).toBe(400);
      expect(JSON.stringify(await rejected.json())).toContain('E_TOC_HIERARCHY_INVALID');
      const events = await repo.listImportEvents({ userId: 'u1', traceId: 'invalid-parent' });
      expect(events.ok && events.value.some(event => event.name === 'rejected')).toBe(true);
      const documents = await repo.listDocuments('u1'); expect(documents.ok && documents.value.length).toBe(0);
      const unknown = harness([{ ...validEntries[0], unexpectedField: '禁止静默删除字段' }]);
      expect((await unknown.post()).status).toBe(400);
    } finally { repo.getRawDb().close(); }
  });
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
