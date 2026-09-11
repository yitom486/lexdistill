import { describe, expect, it } from 'bun:test';
import type {
  AgentAdapter,
  AgentEvent,
  AgentInput,
  AgentSession,
} from '@study-studio/agent-core';
import { BusinessError, isOk, logger, ok } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import {
  TOC_REVIEW_SYSTEM_PROMPT,
  buildTocReviewMessage,
  parseTocReviewDraft,
  reviewTocWithAgent,
} from '../application/pdf-import/toc-review-agent.js';

/**
 * CMD-LINGUA-P4B reviewTocWithAgent 单测（全内存 mock，不调真实模型）。
 *
 * OCR 行取自 tray 规则可接受形状（行尾页码 + 课号 token），标题用
 * 显眼哨兵串，专供日志卫生断言抓泄漏。
 */

const SECRET_TITLE = 'LOGHYGIENE_SECRET_TITLE_ZQ';
const PROBE_USER = 'u-log-probe-1';

interface InspectorCalls {
  load: number;
  classify: number;
  ocr: number;
  render: number;
}

function newCalls(): InspectorCalls {
  return { load: 0, classify: 0, ocr: 0, render: 0 };
}

function agentMock(args: {
  pageCount: number;
  calls: InspectorCalls;
  /** 每页 OCR markdown（缺席=空页）；outline 有值=embedded 命中 */
  ocrMarkdown?: Map<number, string>;
  outlineItems?: Array<{ title: string; level: number; physicalPage: number }>;
}): PdfInspectorLike {
  const base: PdfInspectorLike = {
    processPdf: (_pdf, pages) => {
      args.calls.classify++;
      void pages;
      return { pdfType: 'Scanned', pageCount: args.pageCount, markdown: '', pagesNeedingOcr: [1, 2] };
    },
    processPdfWithOcr: async (options) => {
      void options;
      args.calls.ocr++;
      const pages: Array<{ pageNumber: number; markdown: string }> = [];
      if (args.ocrMarkdown) {
        for (const [pageNumber, markdown] of args.ocrMarkdown) {
          pages.push({ pageNumber, markdown });
        }
      }
      return { markdown: '', pages, pagesRoutedToOcr: [1, 2] };
    },
    renderPdfPages: async (_pdf, pages) => {
      args.calls.render++;
      return pages.map((n) => ({
        pageNumber: n,
        png: new Uint8Array([137, 80, 78, 71, n]),
        width: 100 + n,
        height: 200 + n,
      }));
    },
  };
  if (!args.outlineItems) return base;
  const items = args.outlineItems;
  return {
    ...base,
    extractEmbeddedOutline: () => ({ items, unresolvedCount: 0, truncated: false }),
  };
}

interface AgentCalls {
  create: number;
  inputs: AgentInput[];
  systemPrompts: Array<string | undefined>;
}

function mockAdapter(args: {
  calls: AgentCalls;
  script: string;
  capable?: boolean;
  failCreate?: BusinessError;
}): AgentAdapter {
  const capable = args.capable ?? true;
  const session: AgentSession = {
    sessionId: 'sess-mock',
    threadId: 'thread-mock',
    send: async function* (_input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
      void _input;
      yield { type: 'TEXT_DELTA', delta: args.script };
      yield { type: 'COMPLETED', finalOutput: args.script };
    },
    submitToolResult: async () => ok(undefined),
    submitApproval: async () => ok(undefined),
    steer: async () => ok(undefined),
    interrupt: async () => ok(undefined),
    close: async () => ok(undefined),
  };
  const adapter: AgentAdapter = {
    id: 'mock-toc-review',
    name: 'Mock TOC Review Adapter',
    createSession: async (options) => {
      args.calls.create++;
      args.calls.systemPrompts.push(options.systemPrompt);
      if (args.failCreate) return { ok: false as const, error: args.failCreate };
      const capturing: AgentSession = {
        ...session,
        send: async function* (input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
          args.calls.inputs.push(input);
          yield* session.send(input);
        },
      };
      return ok(capturing);
    },
    resumeSession: async () =>
      ({ ok: false as const, error: new BusinessError('E_CODEX_SESSION', 'mock 不支持恢复', 'AGENT_RUNTIME') }),
  };
  if (capable) {
    return { ...adapter, supportsImageInput: () => true };
  }
  return adapter;
}

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-review-agent');
}

function twoPageOcr(): Map<number, string> {
  return new Map([
    [1, `${SECRET_TITLE} 第1課 会話 12`],
    [2, '文法 まとめ 30'],
  ]);
}

describe('P4B reviewTocWithAgent（mock）', () => {
  it('P3 基线 + 两张 PNG 进入同一次 AgentInput；草稿与基线分离返回', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const script = JSON.stringify({
      entries: [
        { title: `${SECRET_TITLE} 第1課 会話`, printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
        { title: '文法 まとめ', printedPage: 30, level: 2, kind: 'section', confidence: 'medium' },
      ],
      warnings: ['第2页有污渍，页码存疑'],
    });
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
        },
        adapter: mockAdapter({ calls: agentCalls, script }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const out = res.value;
    expect(out.embedded).toBe(false);
    expect(out.range).toEqual({ fromPage: 1, toPage: 2 });
    expect(out.pageCount).toBe(371);
    // 基线是 OCR 原样（未被草稿合并）：两条，level/kind 守恒
    expect(out.baseline.entries.length).toBe(2);
    expect(out.baseline.entries[0]).toMatchObject({ printedPage: 12, level: 1, kind: 'lesson' });
    expect(out.baseline.entries[1]).toMatchObject({ printedPage: 30, level: 2, kind: 'section' });
    // 草稿是独立对象
    expect(out.draft?.entries.length).toBe(2);
    expect(out.draft?.warnings).toEqual(['第2页有污渍，页码存疑']);
    expect(out.diagnostics).toMatchObject({ pagesRendered: 2, baselineEntries: 2, draftEntries: 2 });
    // 同一次 AgentInput
    expect(agentCalls.create).toBe(1);
    expect(agentCalls.inputs.length).toBe(1);
    const agentInput = agentCalls.inputs[0];
    if (!agentInput) return;
    expect(agentInput.message).toContain('第 1-2 页');
    expect(agentInput.message).toContain(SECRET_TITLE);
    expect(agentInput.message).toContain('印刷页');
    expect(agentInput.contextSnapshot).toBeUndefined();
    expect(agentInput.attachments?.length).toBe(2);
    expect(agentInput.attachments?.[0]?.png).toEqual(new Uint8Array([137, 80, 78, 71, 1]));
    expect(agentInput.attachments?.[1]?.png).toEqual(new Uint8Array([137, 80, 78, 71, 2]));
    expect(agentInput.attachments?.[0]?.label).toContain('1');
    // 图片未 base64 化塞进文本
    const pngB64 = Buffer.from([137, 80, 78, 71, 1]).toString('base64');
    expect(agentInput.message).not.toContain(pngB64);
    // systemPrompt 约束 printedPage / 禁 physicalPage
    expect(agentCalls.systemPrompts[0]).toContain('printedPage');
    expect(agentCalls.systemPrompts[0]).toContain('physicalPage');
    expect(agentCalls.systemPrompts[0]).toBe(TOC_REVIEW_SYSTEM_PROMPT);
  });

  it('embedded 命中：零 Agent 调用、零渲染、draft 为 null', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({
            pageCount: 371,
            calls: inspectorCalls,
            outlineItems: [
              { title: '第1課', level: 1, physicalPage: 5 },
              { title: '第2課', level: 1, physicalPage: 9 },
            ],
          });
        },
        adapter: mockAdapter({ calls: agentCalls, script: '{"entries":[],"warnings":[]}' }),
      },
      { userId: 'u1', filename: 'outlined.pdf', bytes: mockBytes(), fromPage: 2, toPage: 3 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.embedded).toBe(true);
    expect(res.value.draft).toBeNull();
    expect(agentCalls.create).toBe(0);
    expect(agentCalls.inputs.length).toBe(0);
    expect(inspectorCalls.render).toBe(0);
    expect(inspectorCalls.ocr).toBe(0);
  });

  it('坏 JSON → E_TOC_REVIEW_PARSE；schema 非法 → E_TOC_REVIEW_SCHEMA', async () => {
    const bad = await reviewTocWithAgent(
      {
        loadInspector: async () =>
          agentMock({ pageCount: 371, calls: newCalls(), ocrMarkdown: twoPageOcr() }),
        adapter: mockAdapter({
          calls: { create: 0, inputs: [], systemPrompts: [] },
          script: 'not json at all',
        }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(bad)).toBe(false);
    if (isOk(bad)) return;
    expect(bad.error.code).toBe('E_TOC_REVIEW_PARSE');
    expect(bad.error.retryable).toBe(true);

    for (const script of [
      JSON.stringify({ entries: [{ title: 'x', printedPage: 1, level: 3, kind: 'lesson', confidence: 'high' }], warnings: [] }),
      JSON.stringify({ entries: [], warnings: [], physicalPage: 5 }),
      JSON.stringify({ entries: 'nope', warnings: [] }),
    ]) {
      const res = await reviewTocWithAgent(
        {
          loadInspector: async () =>
            agentMock({ pageCount: 371, calls: newCalls(), ocrMarkdown: twoPageOcr() }),
          adapter: mockAdapter({ calls: { create: 0, inputs: [], systemPrompts: [] }, script }),
        },
        { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
      );
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_TOC_REVIEW_SCHEMA');
    }
  });

  it('超 8 页 / 空范围：loadInspector 零调用、Agent 零调用', async () => {
    for (const range of [
      { fromPage: 1, toPage: 9 },
      { fromPage: 5, toPage: 3 },
    ]) {
      const inspectorCalls = newCalls();
      const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
      const res = await reviewTocWithAgent(
        {
          loadInspector: async () => {
            inspectorCalls.load++;
            return agentMock({ pageCount: 371, calls: inspectorCalls });
          },
          adapter: mockAdapter({ calls: agentCalls, script: '{"entries":[],"warnings":[]}' }),
        },
        { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), ...range }
      );
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_INVALID_INPUT');
      expect(inspectorCalls.load).toBe(0);
      expect(agentCalls.create).toBe(0);
    }
  });

  it('越界：在 OCR/渲染/Agent 之前拒绝（仅诚实探针）', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({ pageCount: 371, calls: inspectorCalls });
        },
        adapter: mockAdapter({ calls: agentCalls, script: '{"entries":[],"warnings":[]}' }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 400, toPage: 405 }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
    expect(res.error.userMessage).toContain('371');
    expect(inspectorCalls.ocr).toBe(0);
    expect(inspectorCalls.render).toBe(0);
    expect(agentCalls.create).toBe(0);
  });

  it('不支持图片的 Adapter：E_AGENT_CAPABILITY，零渲染零会话', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
        },
        adapter: mockAdapter({ calls: agentCalls, script: '{"entries":[],"warnings":[]}', capable: false }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_AGENT_CAPABILITY');
    expect(agentCalls.create).toBe(0);
    expect(agentCalls.inputs.length).toBe(0);
    expect(inspectorCalls.render).toBe(0);
  });

  it('日志只记计数：不含标题、正文、PNG、路径、userId', async () => {
    const captured: unknown[][] = [];
    const originalWarn = logger.warn;
    logger.warn = (...args: unknown[]): void => {
      captured.push(args);
    };
    try {
      const res = await reviewTocWithAgent(
        {
          loadInspector: async () =>
            agentMock({ pageCount: 371, calls: newCalls(), ocrMarkdown: twoPageOcr() }),
          adapter: mockAdapter({
            calls: { create: 0, inputs: [], systemPrompts: [] },
            script: '{"entries":[],"warnings":[]}',
          }),
        },
        { userId: PROBE_USER, filename: 'secret-path-toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
      );
      expect(isOk(res)).toBe(true);
    } finally {
      logger.warn = originalWarn;
    }
    expect(captured.length).toBeGreaterThan(0);
    const dumped = JSON.stringify(captured);
    expect(dumped).not.toContain(SECRET_TITLE);
    expect(dumped).not.toContain(PROBE_USER);
    expect(dumped).not.toContain('secret-path-toc.pdf');
    expect(dumped).not.toContain('tmp');
    expect(dumped).not.toContain('.png');
    expect(dumped).not.toContain('iVBOR');
  });

  it('parseTocReviewDraft 纯函数：合法过、非法 null', () => {
    expect(parseTocReviewDraft('  {"entries":[],"warnings":[]}  ')).toEqual({ entries: [], warnings: [] });
    expect(parseTocReviewDraft('nope')).toBeNull();
    expect(parseTocReviewDraft('')).toBeNull();
    expect(parseTocReviewDraft('{"entries":[],"warnings":[],"extra":1}')).toBeNull();
    expect(parseTocReviewDraft('```json\n{"entries":[],"warnings":[]}\n```')).toBeNull();
  });

  it('buildTocReviewMessage 纯函数：含范围/条目/计数，不含图片字节', () => {
    const baseline = {
      status: 'ok' as const,
      range: { fromPage: 3, toPage: 4 },
      pageCount: 100,
      entries: [
        { title: '第2課', printedPage: 20, level: 1, source: 'text' as const, kind: 'lesson' as const },
      ],
      diagnostics: {
        pagesRequested: 2,
        pagesOcr: 2,
        linesConsidered: 10,
        linesDroppedWash: 1,
        entriesAccepted: 1,
        entriesRejected: 0,
      },
      embedded: false,
    };
    const message = buildTocReviewMessage(baseline, 2);
    expect(message).toContain('第 3-4 页');
    expect(message).toContain('第2課');
    expect(message).toContain('印刷页 20');
    expect(message).not.toContain('iVBOR');
  });
});
