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
  assessReviewableEvidence,
  buildTocReviewMessage,
  formatReviewEvidence,
  parseTocReviewDraft,
  reviewTocWithAgent,
  validateTocDraftContent,
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

  it('P3.1B 坏 JSON 两次 → unavailable（非 err）：PARSE/SCHEMA 分类保留', async () => {
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
    // 同一脚本两次均无效 → 同 session 重试一次后降级为可读 unavailable
    expect(isOk(bad)).toBe(true);
    if (!isOk(bad)) return;
    expect(bad.value.reviewStatus).toBe('unavailable');
    expect(bad.value.draft).toBeNull();
    expect(bad.value.reviewError?.code).toBe('E_TOC_REVIEW_PARSE');
    expect(bad.value.baseline.entries.length).toBe(2);

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
      expect(isOk(res)).toBe(true);
      if (!isOk(res)) continue;
      expect(res.value.reviewStatus).toBe('unavailable');
      expect(res.value.reviewError?.code).toBe('E_TOC_REVIEW_SCHEMA');
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
  });

  it('P3.1B parse 容错：围栏/前后杂话/裸数组切片成功', () => {
    expect(parseTocReviewDraft('```json\n{"entries":[],"warnings":[]}\n```')).toEqual({ entries: [], warnings: [] });
    expect(
      parseTocReviewDraft('好的，这是整理结果：\n{"entries": [{"title": "第1課", "printedPage": 3, "level": 1, "kind": "lesson", "confidence": "high"}], "warnings": []}\n请核对。')
    ).toEqual({
      entries: [{ title: '第1課', printedPage: 3, level: 1, kind: 'lesson', confidence: 'high' }],
      warnings: [],
    });
    // 裸数组包成 entries
    expect(
      parseTocReviewDraft('[{"title": "第1課", "printedPage": 3, "level": 1, "kind": "lesson", "confidence": "high"}]')
    ).toEqual({
      entries: [{ title: '第1課', printedPage: 3, level: 1, kind: 'lesson', confidence: 'high' }],
      warnings: [],
    });
    // 花括号不平衡 / 纯杂话仍 null
    expect(parseTocReviewDraft('{"entries": [')).toBeNull();
    expect(parseTocReviewDraft('今天天气不错')).toBeNull();
  });

  it('buildTocReviewMessage 纯函数：含范围/条目/计数，不含图片字节', () => {
    const baseline = {
      status: 'ok' as const,
      verdict: 'thin' as const,
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
        badTitle: 0,
      },
      pageEvidence: [{ page: 3, excerpt: '第2課 20' }],
      embedded: false,
    };
    const message = buildTocReviewMessage(baseline, 2);
    expect(message).toContain('第 3-4 页');
    expect(message).toContain('第2課');
    expect(message).toContain('印刷页 20');
    expect(message).not.toContain('iVBOR');
  });
});

/** 脚本队列 adapter：按 send 调用顺序逐个吐脚本（P3.1B 重试测试用）。 */
function mockAdapterQueue(args: { calls: AgentCalls; scripts: string[]; capable?: boolean }): AgentAdapter {
  const capable = args.capable ?? true;
  const adapter: AgentAdapter = {
    id: 'mock-toc-review-queue',
    name: 'Mock TOC Review Queue Adapter',
    createSession: async () => {
      args.calls.create++;
      let n = 0;
      const session: AgentSession = {
        sessionId: 'sess-queue',
        threadId: 'thread-queue',
        send: async function* (input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
          args.calls.inputs.push(input);
          const script = args.scripts[Math.min(n, args.scripts.length - 1)] as string;
          n++;
          yield { type: 'TEXT_DELTA', delta: script };
          yield { type: 'COMPLETED', finalOutput: script };
        },
        submitToolResult: async () => ok(undefined),
        submitApproval: async () => ok(undefined),
        steer: async () => ok(undefined),
        interrupt: async () => ok(undefined),
        close: async () => ok(undefined),
      };
      return ok(session);
    },
    resumeSession: async () =>
      ({ ok: false as const, error: new BusinessError('E_CODEX_SESSION', 'mock 不支持恢复', 'AGENT_RUNTIME') }),
  };
  if (capable) {
    return { ...adapter, supportsImageInput: () => true };
  }
  return adapter;
}

const GOOD_DRAFT = JSON.stringify({
  entries: [
    { title: '第1課 会話', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
    { title: '第2課 文法', printedPage: 20, level: 1, kind: 'lesson', confidence: 'high' },
  ],
  warnings: [],
});

describe('P3.1B review 容错（同 session 单次重试 + unavailable）', () => {
  function usableDeps(inspectorCalls: InspectorCalls, calls: AgentCalls, scripts: string[]) {
    return {
      loadInspector: async () => {
        inspectorCalls.load++;
        return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
      },
      adapter: mockAdapterQueue({ calls, scripts }),
    };
  }

  it('第一次杂话、第二次成功：同一 session 发两轮，不新增 OCR/渲染', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const res = await reviewTocWithAgent(
      usableDeps(inspectorCalls, agentCalls, ['抱歉我没听清，请再说一遍', GOOD_DRAFT]),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('ok');
    expect(res.value.draft?.entries.length).toBe(2);
    expect(res.value.reviewError).toBeNull();
    expect(agentCalls.create).toBe(1);
    expect(agentCalls.inputs.length).toBe(2);
    // 第二轮纯文本纠错：无附件（不重新渲染）
    expect(agentCalls.inputs[1]?.attachments?.length ?? 0).toBe(0);
    // OCR/渲染各一次（重试不新增）
    expect(inspectorCalls.ocr).toBe(1);
    expect(inspectorCalls.render).toBe(1);
  });

  it('两次无效：ok 的 unavailable 态（非 502），基线保留，模型原文不外泄', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const rawSecret = 'SECRET-RAW-MODEL-TEXT-xyz';
    const res = await reviewTocWithAgent(
      usableDeps(inspectorCalls, agentCalls, ['我不知道', rawSecret]),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('unavailable');
    expect(res.value.draft).toBeNull();
    expect(res.value.reviewError?.code).toBe('E_TOC_REVIEW_PARSE');
    expect(res.value.baseline.entries.length).toBe(2);
    expect(res.value.baseline.verdict).toBe('usable');
    expect(agentCalls.inputs.length).toBe(2);
    const dumped = JSON.stringify(res.value);
    expect(dumped).not.toContain(rawSecret);
    expect(dumped).not.toContain('我不知道');
  });

  it('两次类 JSON 但非法：E_TOC_REVIEW_SCHEMA 的 unavailable', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const bad = '{"entries": [{"title": "", "printedPage": -1}], "warnings": []}';
    const res = await reviewTocWithAgent(
      usableDeps(inspectorCalls, agentCalls, [bad, bad]),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('unavailable');
    expect(res.value.reviewError?.code).toBe('E_TOC_REVIEW_SCHEMA');
  });

  it('thin 基线服务端拒绝（E_TOC_BASELINE_THIN），零 Agent 调用', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({
            pageCount: 371,
            calls: inspectorCalls,
            ocrMarkdown: new Map([[1, '##### …… 322']]),
          });
        },
        adapter: mockAdapterQueue({ calls: agentCalls, scripts: [GOOD_DRAFT] }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 1 }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_TOC_BASELINE_THIN');
    expect(agentCalls.create).toBe(0);
    expect(agentCalls.inputs.length).toBe(0);
  });
});

describe('P3.2 reviewable 门与草稿内容门', () => {
  it('assessReviewableEvidence：空/过短/超范围拒绝，达标放行', () => {
    expect(assessReviewableEvidence([], 1, 2).reviewable).toBe(false);
    expect(assessReviewableEvidence([], 1, 2).reason).toBe('empty-evidence');
    expect(
      assessReviewableEvidence([{ page: 1, excerpt: '第1課 3' }], 1, 1).reviewable
    ).toBe(false);
    expect(assessReviewableEvidence([{ page: 1, excerpt: 'x'.repeat(100) }], 1, 9).reason).toBe(
      'range-too-large'
    );
    const ok = assessReviewableEvidence(
      [{ page: 1, excerpt: 'この本のもくじです\n第1課 はじめまして 3\nつづく' }],
      1,
      1
    );
    expect(ok.reviewable).toBe(true);
    expect(ok.reason).toBe('ok');
    expect(ok.evidenceChars).toBeGreaterThanOrEqual(20);
  });

  it('formatReviewEvidence：逐页标记 + 总量截断', () => {
    expect(formatReviewEvidence([])).toBe('');
    expect(formatReviewEvidence([{ page: 2, excerpt: '  第1課 12  ' }])).toContain('--- PDF第2页 ---');
    const big = formatReviewEvidence([{ page: 1, excerpt: 'あ'.repeat(20000) }]);
    expect(big.length).toBeLessThanOrEqual(12000 + 20);
    expect(big.endsWith('…(证据过长已截断)')).toBe(true);
  });

  it('validateTocDraftContent：倒退/空标题/纯数字/不足拒绝，正常通过', () => {
    const good = {
      entries: [
        { title: '第1課', printedPage: 12, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
        { title: '第2課', printedPage: 30, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
      ],
      warnings: [],
    };
    expect(validateTocDraftContent(good)).toMatchObject({ ok: true, semanticEntries: 2 });
    const single = {
      entries: [
        { title: '第1課', printedPage: 12, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
      ],
      warnings: [],
    };
    expect(validateTocDraftContent(single).reason).toBe('too-few');
    expect(
      validateTocDraftContent({
        entries: [
          { title: '第1課', printedPage: 30, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
          { title: '第2課', printedPage: 12, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
        ],
        warnings: [],
      }).reason
    ).toBe('page-regress');
    expect(
      validateTocDraftContent({
        entries: [
          { title: '   ', printedPage: 12, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
          { title: '第2課', printedPage: 30, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
        ],
        warnings: [],
      }).reason
    ).toBe('empty-title');
    expect(
      validateTocDraftContent({
        entries: [
          { title: '123', printedPage: 12, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
          { title: '456', printedPage: 30, level: 1 as const, kind: 'lesson' as const, confidence: 'high' as const },
        ],
        warnings: [],
      }).reason
    ).toBe('non-semantic-title');
  });

  it('thin + 有效证据 → AI 重建 ≥2 条草稿（证据进输入，无新增 OCR）', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({
            pageCount: 371,
            calls: inspectorCalls,
            ocrMarkdown: new Map([[1, 'この本のもくじです\n第1課 はじめまして 3\nつづく']]),
          });
        },
        adapter: mockAdapterQueue({ calls: agentCalls, scripts: [GOOD_DRAFT] }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 1 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.baseline.verdict).toBe('thin');
    expect(res.value.reviewStatus).toBe('ok');
    expect(res.value.draft?.entries.length).toBe(2);
    expect(agentCalls.create).toBe(1);
    expect(agentCalls.inputs.length).toBe(1);
    const firstInput = agentCalls.inputs[0] as { message?: unknown } | undefined;
    const message = typeof firstInput?.message === 'string' ? firstInput.message : '';
    expect(message).toContain('--- PDF第1页 ---');
    expect(message).toContain('thin');
  });

  it('thin 但证据不足 → 不调用 AI（E_TOC_EVIDENCE_INSUFFICIENT）', async () => {
    const inspectorCalls = newCalls();
    const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({
            pageCount: 371,
            calls: inspectorCalls,
            ocrMarkdown: new Map([[1, '第1課 3']]),
          });
        },
        adapter: mockAdapterQueue({ calls: agentCalls, scripts: [GOOD_DRAFT] }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 1 }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_TOC_EVIDENCE_INSUFFICIENT');
    expect(agentCalls.create).toBe(0);
  });

  it('编造内容两次 → unavailable E_TOC_REVIEW_CONTENT（页码倒退/空标题/纯数字）', async () => {
    const cases: Array<{ script: string; reason: string }> = [
      {
        script: JSON.stringify({
          entries: [
            { title: '第1課', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
            { title: '第2課', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
          ],
          warnings: [],
        }),
        reason: 'regress',
      },
      {
        script: JSON.stringify({
          entries: [
            { title: '   ', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
            { title: '第2課', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
          ],
          warnings: [],
        }),
        reason: 'empty',
      },
      {
        script: JSON.stringify({
          entries: [
            { title: '123', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
            { title: '456', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
          ],
          warnings: [],
        }),
        reason: 'digit',
      },
    ];
    for (const item of cases) {
      const inspectorCalls = newCalls();
      const agentCalls: AgentCalls = { create: 0, inputs: [], systemPrompts: [] };
      const res = await reviewTocWithAgent(
        {
          loadInspector: async () => {
            inspectorCalls.load++;
            return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
          },
          adapter: mockAdapterQueue({ calls: agentCalls, scripts: [item.script, item.script] }),
        },
        { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
      );
      expect(isOk(res)).toBe(true);
      if (!isOk(res)) continue;
      expect(res.value.reviewStatus).toBe('unavailable');
      expect(res.value.reviewError?.code).toBe('E_TOC_REVIEW_CONTENT');
      expect(res.value.draft).toBeNull();
      expect(res.value.baseline.verdict).toBe('usable');
    }
  });
});
