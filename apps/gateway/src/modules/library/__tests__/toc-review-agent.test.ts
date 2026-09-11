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
  TOC_REVIEW_EFFORT_ENV,
  TOC_REVIEW_MODEL_ENV,
  TOC_REVIEW_SYSTEM_PROMPT,
  assessReviewableEvidence,
  buildTocReviewMessage,
  buildTocReviewRetryMessage,
  formatReviewEvidence,
  isTocDraftToolCall,
  resolveTocReviewModelOptions,
  reviewTocWithAgent,
  type TocReviewDraftEntry,
} from '../application/pdf-import/toc-review-agent.js';
import {
  TOC_DRAFT_TOOL_NAME,
  tocDraftReplaceAllTool,
  type TocReviewToolEvent,
} from '../application/pdf-import/toc-draft-tool.js';

/**
 * CMD-LINGUA-P3.4A reviewTocWithAgent 单测（全内存 mock，不调真实模型）。
 *
 * 假通道建模生产 adapter 的固定行为（codex-adapter 内自执行，不由 review
 * loop 执行）：脚本出现 tool 步骤即同步跑**真实**工具 execute（校验 + 会话
 * 暂存），再吐 COMPLETED；review loop 只观察事件 + 终态读暂存。
 * 模型自然语言（text 步骤）必须证明被忽略：输出 draft 只能等于工具入参。
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

/** 工具通道脚本步骤（假通道用真实工具 execute，见文件头）。 */
type ToolScriptStep =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; input: unknown }
  | { kind: 'approval'; action: string; description: string }
  | { kind: 'error'; error: BusinessError };

interface AgentCalls {
  create: number;
  inputs: AgentInput[];
  systemPrompts: Array<string | undefined>;
  toolsOffered: string[][];
  approvals: Array<{ approvalId: string; decision: unknown }>;
  sessionModels: Array<string | undefined>;
}

function newAgentCalls(): AgentCalls {
  return { create: 0, inputs: [], systemPrompts: [], toolsOffered: [], approvals: [], sessionModels: [] };
}

function mockToolAdapter(args: {
  calls: AgentCalls;
  steps: ToolScriptStep[];
  /** 分轮脚本（缺席则每轮复用 steps；P3.4B-FIX4 两轮用） */
  turns?: ToolScriptStep[][];
  capable?: boolean;
  failCreate?: BusinessError;
}): AgentAdapter {
  const capable = args.capable ?? true;
  const sessionId = 'sess-tool-mock';
  let sendCount = 0;
  const session: AgentSession = {
    sessionId,
    threadId: 'thread-tool-mock',
    send: async function* (_input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
      void _input;
      const steps = args.turns ? args.turns[Math.min(sendCount, args.turns.length - 1)] ?? [] : args.steps;
      sendCount++;
      let n = 0;
      for (const step of steps) {
        if (step.kind === 'text') {
          yield { type: 'TEXT_DELTA', delta: step.text };
        } else if (step.kind === 'tool') {
          const callId = `call-${n++}`;
          yield {
            type: 'TOOL_CALL_REQUESTED',
            callId,
            toolName: TOC_DRAFT_TOOL_NAME,
            input: step.input as Record<string, unknown>,
          };
          // 生产行为：adapter 内自执行（全局 registry → 本工具 execute）。
          const execRes = await tocDraftReplaceAllTool.execute(step.input, {
            userId: 'u1',
            sessionId,
          });
          yield {
            type: 'TOOL_CALL_COMPLETED',
            callId,
            result: { status: 'completed', success: execRes.ok },
          };
        } else if (step.kind === 'approval') {
          yield {
            type: 'APPROVAL_REQUESTED',
            approvalId: 'appr-1',
            action: step.action,
            description: step.description,
            riskLevel: 'low',
          };
        } else {
          yield { type: 'ERROR', error: step.error };
          return;
        }
      }
      yield { type: 'COMPLETED' };
    },
    submitToolResult: async () => ok(undefined),
    submitApproval: async (approvalId: string, decision: unknown) => {
      args.calls.approvals.push({ approvalId, decision });
      return ok(undefined);
    },
    steer: async () => ok(undefined),
    interrupt: async () => ok(undefined),
    close: async () => ok(undefined),
  };
  const adapter: AgentAdapter = {
    id: 'mock-toc-review-tool',
    name: 'Mock TOC Review Tool Adapter',
    createSession: async (options) => {
      args.calls.create++;
      args.calls.systemPrompts.push(options.systemPrompt);
      args.calls.toolsOffered.push((options.tools ?? []).map((t) => t.name));
      args.calls.sessionModels.push(options.model);
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

const GOOD_TOOL_INPUT: { entries: TocReviewDraftEntry[]; warnings: string[] } = {
  entries: [
    { title: '第1課 会話', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
    { title: '第2課 文法', printedPage: 20, level: 1, kind: 'lesson', confidence: 'high' },
  ],
  warnings: [],
};

function reviewDeps(inspectorCalls: InspectorCalls, calls: AgentCalls, steps: ToolScriptStep[], extra?: Record<string, unknown>) {
  return {
    loadInspector: async () => {
      inspectorCalls.load++;
      return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
    },
    adapter: mockToolAdapter({ calls, steps }),
    ...(extra ?? {}),
  };
}

describe('P3.4A reviewTocWithAgent（工具通道 mock）', () => {
  it('P3 基线 + 两张 PNG 进入同一次 AgentInput；工具声明且自然语言被忽略', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const chatter = '好的，这是整理结果：{"entries": [{"title": "编造课", "printedPage": 999, "level": 1, "kind": "lesson", "confidence": "high"}], "warnings": []}请核对。';
    const events: TocReviewToolEvent[] = [];
    const res = await reviewTocWithAgent(
      reviewDeps(inspectorCalls, agentCalls, [{ kind: 'text', text: chatter }, { kind: 'tool', input: GOOD_TOOL_INPUT }], {
        toolObserver: { emit: (e: TocReviewToolEvent) => events.push(e) },
      }),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const out = res.value;
    expect(out.embedded).toBe(false);
    expect(out.reviewStatus).toBe('ok');
    expect(out.reviewError).toBeNull();
    // draft 唯一来自工具入参：自然语言里的 JSON（编造课/999）必须无踪
    expect(out.draft?.entries).toEqual(GOOD_TOOL_INPUT.entries);
    expect(out.draft?.warnings).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('编造课');
    expect(JSON.stringify(out)).not.toContain('999');
    expect(out.diagnostics).toMatchObject({ pagesRendered: 2, baselineEntries: 2, draftEntries: 2 });
    // 基线未被草稿合并
    expect(out.baseline.entries.length).toBe(2);
    // 工具声明进 createSession
    expect(agentCalls.toolsOffered).toEqual([[TOC_DRAFT_TOOL_NAME]]);
    // 单轮：附件一次，OCR/渲染各一次（无文本纠错第二轮）
    expect(agentCalls.create).toBe(1);
    expect(agentCalls.inputs.length).toBe(1);
    const agentInput = agentCalls.inputs[0];
    if (!agentInput) return;
    expect(agentInput.attachments?.length).toBe(2);
    expect(inspectorCalls.ocr).toBe(1);
    expect(inspectorCalls.render).toBe(1);
    // 可观测序列：ready → offered → received → draft_ready（计数，无原文）
    expect(events.map((e) => e.type)).toEqual([
      'agent_session_ready',
      'tool_offered',
      'tool_call_received',
      'draft_ready',
    ]);
    expect(JSON.stringify(events)).not.toContain('编造课');
    // systemPrompt 要求工具提交、不再要求回复 JSON
    expect(agentCalls.systemPrompts[0]).toContain(TOC_DRAFT_TOOL_NAME);
    expect(agentCalls.systemPrompts[0]).toContain('printedPage');
  });

  it('工具参数非法一次后纠正 → 成功；失败计数可观测', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const events: TocReviewToolEvent[] = [];
    const badInput = {
      entries: [
        { title: '第1課 会話', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
        { title: '第2課 文法', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
      ],
      warnings: [],
    };
    const res = await reviewTocWithAgent(
      reviewDeps(inspectorCalls, agentCalls, [{ kind: 'tool', input: badInput }, { kind: 'tool', input: GOOD_TOOL_INPUT }], {
        toolObserver: { emit: (e: TocReviewToolEvent) => events.push(e) },
      }),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('ok');
    expect(res.value.draft?.entries.length).toBe(2);
    expect(agentCalls.inputs.length).toBe(1);
    expect(events.map((e) => e.type)).toEqual([
      'agent_session_ready',
      'tool_offered',
      'tool_call_received',
      'tool_call_received',
      'tool_validation_failed',
      'draft_ready',
    ]);
    const failed = events.find((e) => e.type === 'tool_validation_failed');
    expect(failed).toMatchObject({ type: 'tool_validation_failed', code: 'E_TOC_DRAFT_ORDER' });
  });

  it('两次非法 → unavailable E_TOC_REVIEW_TOOL_INVALID，基线保留', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const events: TocReviewToolEvent[] = [];
    const badInput = {
      entries: [
        { title: '   ', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
        { title: '第2課 文法', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
      ],
      warnings: [],
    };
    const res = await reviewTocWithAgent(
      reviewDeps(inspectorCalls, agentCalls, [{ kind: 'tool', input: badInput }, { kind: 'tool', input: badInput }], {
        toolObserver: { emit: (e: TocReviewToolEvent) => events.push(e) },
      }),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('unavailable');
    expect(res.value.draft).toBeNull();
    expect(res.value.reviewError?.code).toBe('E_TOC_REVIEW_TOOL_INVALID');
    expect(res.value.baseline.entries.length).toBe(2);
    expect(events.map((e) => e.type)).toContain('unavailable');
  });

  it('无工具调用（纯杂话）→ unavailable E_TOC_REVIEW_NO_TOOL_CALL，模型原文不外泄', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const rawSecret = 'SECRET-RAW-MODEL-TEXT-xyz';
    const res = await reviewTocWithAgent(
      reviewDeps(inspectorCalls, agentCalls, [{ kind: 'text', text: '我不知道' }, { kind: 'text', text: rawSecret }]),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('unavailable');
    expect(res.value.draft).toBeNull();
    expect(res.value.reviewError?.code).toBe('E_TOC_REVIEW_NO_TOOL_CALL');
    expect(res.value.baseline.entries.length).toBe(2);
    expect(res.value.baseline.verdict).toBe('usable');
    const dumped = JSON.stringify(res.value);
    expect(dumped).not.toContain(rawSecret);
    expect(dumped).not.toContain('我不知道');
  });

  it('本工具审批自动接受，他工具拒绝', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      reviewDeps(inspectorCalls, agentCalls, [
        { kind: 'approval', action: 'call toc_draft_replace_all', description: '提交目录草稿 toc_draft_replace_all' },
        { kind: 'approval', action: 'delete everything', description: '无关审批' },
        { kind: 'tool', input: GOOD_TOOL_INPUT },
      ]),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('ok');
    expect(agentCalls.approvals).toEqual([
      { approvalId: 'appr-1', decision: 'accept' },
      { approvalId: 'appr-1', decision: 'decline' },
    ]);
  });

  it('embedded 命中：零 Agent 调用、零渲染、draft 为 null', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
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
        adapter: mockToolAdapter({ calls: agentCalls, steps: [] }),
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

  it('超 8 页 / 空范围：loadInspector 零调用、Agent 零调用', async () => {
    for (const range of [
      { fromPage: 1, toPage: 9 },
      { fromPage: 5, toPage: 3 },
    ]) {
      const inspectorCalls = newCalls();
      const agentCalls = newAgentCalls();
      const res = await reviewTocWithAgent(
        {
          loadInspector: async () => {
            inspectorCalls.load++;
            return agentMock({ pageCount: 371, calls: inspectorCalls });
          },
          adapter: mockToolAdapter({ calls: agentCalls, steps: [] }),
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
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({ pageCount: 371, calls: inspectorCalls });
        },
        adapter: mockToolAdapter({ calls: agentCalls, steps: [] }),
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
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
        },
        adapter: mockToolAdapter({ calls: agentCalls, steps: [], capable: false }),
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
          adapter: mockToolAdapter({
            calls: newAgentCalls(),
            steps: [{ kind: 'tool', input: GOOD_TOOL_INPUT }],
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

  it('buildTocReviewMessage 纯函数：含范围/条目/计数与工具指令，不含图片字节', () => {
    const baseline = {
      status: 'ok' as const,
      verdict: 'thin' as const,
      range: { fromPage: 3, toPage: 4 },
      pageCount: 100,
      entries: [
        { title: '第2課', printedPage: 20, level: 1, source: 'text-fallback' as const, kind: 'lesson' as const },
      ],
      diagnostics: {
        pagesRequested: 2,
        pagesOcr: 2,
        linesConsidered: 10,
        linesDroppedWash: 1,
        entriesAccepted: 1,
        entriesRejected: 0,
        badTitle: 0,
        entriesFromBlocks: 0,
        unresolvedBlocks: 0,
      },
      pageEvidence: [{ page: 3, excerpt: '第2課 20' }],
      embedded: false,
    };
    const message = buildTocReviewMessage(baseline, 2);
    expect(message).toContain('第 3-4 页');
    expect(message).toContain('第2課');
    expect(message).toContain('印刷页 20');
    expect(message).toContain('工具');
    expect(message).not.toContain('iVBOR');
  });

  it('isTocDraftToolCall：精确名与 sanitize 变体命中，他名拒绝', () => {
    expect(isTocDraftToolCall('toc_draft_replace_all')).toBe(true);
    expect(isTocDraftToolCall('toc.draft.replace.all')).toBe(true);
    expect(isTocDraftToolCall('other_tool')).toBe(false);
    expect(isTocDraftToolCall('')).toBe(false);
  });

  it('P3.4B-ISO 专精模型配置：显式 > 环境变量 > 缺席；透传到会话与 Turn', async () => {
    // 纯函数：去空白/截断/优先级
    expect(resolveTocReviewModelOptions()).toEqual({});
    expect(resolveTocReviewModelOptions({ model: '  ', effort: '' })).toEqual({});
    expect(resolveTocReviewModelOptions({ model: 'm1', effort: 'high' })).toEqual({ model: 'm1', effort: 'high' });
    const savedModel = process.env[TOC_REVIEW_MODEL_ENV];
    const savedEffort = process.env[TOC_REVIEW_EFFORT_ENV];
    try {
      process.env[TOC_REVIEW_MODEL_ENV] = 'env-model';
      process.env[TOC_REVIEW_EFFORT_ENV] = 'env-effort';
      expect(resolveTocReviewModelOptions()).toEqual({ model: 'env-model', effort: 'env-effort' });
      expect(resolveTocReviewModelOptions({ model: 'm1' })).toEqual({ model: 'm1', effort: 'env-effort' });
    } finally {
      if (savedModel === undefined) delete process.env[TOC_REVIEW_MODEL_ENV];
      else process.env[TOC_REVIEW_MODEL_ENV] = savedModel;
      if (savedEffort === undefined) delete process.env[TOC_REVIEW_EFFORT_ENV];
      else process.env[TOC_REVIEW_EFFORT_ENV] = savedEffort;
    }
    // 透传：createSession model + send turnOptions
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      reviewDeps(inspectorCalls, agentCalls, [{ kind: 'tool', input: GOOD_TOOL_INPUT }], {
        modelOptions: { model: 'toc-model', effort: 'high' },
      }),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('ok');
    expect(agentCalls.sessionModels).toEqual(['toc-model']);
    const sent = agentCalls.inputs[0] as { turnOptions?: unknown } | undefined;
    expect(sent?.turnOptions).toEqual({ model: 'toc-model', effort: 'high' });
  });

  it('缺席模型配置：createSession 无 model，send 无 turnOptions', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      reviewDeps(inspectorCalls, agentCalls, [{ kind: 'tool', input: GOOD_TOOL_INPUT }]),
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(agentCalls.sessionModels).toEqual([undefined]);
    const sent = agentCalls.inputs[0] as { turnOptions?: unknown } | undefined;
    expect(sent?.turnOptions).toBeUndefined();
  });

  it('buildTocReviewRetryMessage 纯函数：只含原因码，不含标题原文', () => {
    const empty = buildTocReviewRetryMessage([]);
    expect(empty).toContain('toc_draft_replace_all');
    expect(empty).toContain('未收到工具调用');
    const withCodes = buildTocReviewRetryMessage(['E_TOC_DRAFT_ORDER']);
    expect(withCodes).toContain('E_TOC_DRAFT_ORDER');
    expect(withCodes).not.toContain('第1課');
  });

  it('P3.4B-FIX4 首轮沉默 + 次轮工具调用 → 成功（两轮同会话，次轮无附件）', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const events: TocReviewToolEvent[] = [];
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
        },
        adapter: mockToolAdapter({
          calls: agentCalls,
          steps: [{ kind: 'text', text: '稍等，我看看' }],
          turns: [[{ kind: 'text', text: '稍等，我看看' }], [{ kind: 'tool', input: GOOD_TOOL_INPUT }]],
        }),
        toolObserver: { emit: (e: TocReviewToolEvent) => events.push(e) },
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('ok');
    expect(res.value.draft?.entries.length).toBe(2);
    expect(agentCalls.inputs.length).toBe(2);
    // 次轮消息点名工具且不带附件（图片已在 thread 内）
    const second = agentCalls.inputs[1] as { message?: unknown; attachments?: unknown[] } | undefined;
    expect(typeof second?.message === 'string' && second.message.includes('toc_draft_replace_all')).toBe(true);
    expect(second?.attachments).toEqual([]);
    expect(events.map((e) => e.type)).toEqual([
      'agent_session_ready',
      'tool_offered',
      'tool_call_received',
      'draft_ready',
    ]);
  });

  it('P3.4B-FIX4 首轮一次非法 + 次轮纠正 → 成功（预算跨轮累计）', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const badInput = {
      entries: [
        { title: '第1課 会話', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
        { title: '第2課 文法', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
      ],
      warnings: [],
    };
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
        },
        adapter: mockToolAdapter({
          calls: agentCalls,
          steps: [{ kind: 'tool', input: badInput }],
          turns: [[{ kind: 'tool', input: badInput }], [{ kind: 'tool', input: GOOD_TOOL_INPUT }]],
        }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('ok');
    expect(res.value.draft?.entries.length).toBe(2);
    expect(agentCalls.inputs.length).toBe(2);
  });

  it('P3.4B-FIX4 首轮已耗尽预算 → 不开第二轮（不浪费模型轮次）', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const badInput = {
      entries: [
        { title: '   ', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
        { title: '第2課 文法', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
      ],
      warnings: [],
    };
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
        },
        adapter: mockToolAdapter({
          calls: agentCalls,
          steps: [{ kind: 'tool', input: badInput }],
          turns: [[{ kind: 'tool', input: badInput }, { kind: 'tool', input: badInput }]],
        }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.reviewStatus).toBe('unavailable');
    expect(res.value.reviewError?.code).toBe('E_TOC_REVIEW_TOOL_INVALID');
    expect(agentCalls.inputs.length).toBe(1);
  });
});

describe('P3.2 reviewable 门与证据格式化', () => {
  it('assessReviewableEvidence：空/无信号/超范围拒绝，信号齐放行', () => {
    expect(assessReviewableEvidence([], 1, 2)).toMatchObject({ reviewable: false, reason: 'empty-evidence' });
    // 有文字但无目录信号（普通正文再长也不放行）
    const prose = assessReviewableEvidence(
      [{ page: 1, excerpt: '本文です。これはテストです。よろしくおねがいします。' }],
      1,
      1
    );
    expect(prose).toMatchObject({ reviewable: false, reason: 'no-toc-signal' });
    expect(prose.hasTocTitle).toBe(false);
    expect(prose.lessonTokenLines).toBe(0);
    // 缺课号 pillar
    const noLessons = assessReviewableEvidence([{ page: 1, excerpt: '目次\nはじめに\nおわりに' }], 1, 1);
    expect(noLessons).toMatchObject({ reviewable: false, reason: 'no-toc-signal' });
    expect(assessReviewableEvidence([{ page: 1, excerpt: 'x'.repeat(100) }], 1, 9).reason).toBe(
      'range-too-large'
    );
    const ok = assessReviewableEvidence(
      [{ page: 1, excerpt: '目次\n第1課 はじめまして\n第2課 これは本です' }],
      1,
      1
    );
    expect(ok).toMatchObject({ reviewable: true, reason: 'ok', hasTocTitle: true });
    expect(ok.lessonTokenLines).toBe(2);
    expect(ok.titleLines).toBeGreaterThanOrEqual(3);
  });

  it('formatReviewEvidence：逐页标记 + 总量截断', () => {
    expect(formatReviewEvidence([])).toBe('');
    expect(formatReviewEvidence([{ page: 2, excerpt: '  第1課 12  ' }])).toContain('--- PDF第2页 ---');
    const big = formatReviewEvidence([{ page: 1, excerpt: 'あ'.repeat(20000) }]);
    expect(big.length).toBeLessThanOrEqual(12000 + 20);
    expect(big.endsWith('…(证据过长已截断)')).toBe(true);
  });

  it('thin + 有效证据 → 工具重建 ≥2 条草稿（证据进输入，无新增 OCR）', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          // 第2課 无同行页码 → 不成条目（thin），但仍是证据信号
          return agentMock({
            pageCount: 371,
            calls: inspectorCalls,
            ocrMarkdown: new Map([[1, '目次\n第1課 はじめまして 3\n第2課']]),
          });
        },
        adapter: mockToolAdapter({ calls: agentCalls, steps: [{ kind: 'tool', input: GOOD_TOOL_INPUT }] }),
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
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          // 有 1 条有效但无目录信号 → 门禁拦截
          return agentMock({
            pageCount: 371,
            calls: inspectorCalls,
            ocrMarkdown: new Map([[1, '第1課 3']]),
          });
        },
        adapter: mockToolAdapter({ calls: agentCalls, steps: [{ kind: 'tool', input: GOOD_TOOL_INPUT }] }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 1 }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_TOC_EVIDENCE_INSUFFICIENT');
    expect(agentCalls.create).toBe(0);
  });

  it('工具参数两次非法 → unavailable E_TOC_REVIEW_TOOL_INVALID（倒退/空标题/纯数字）', async () => {
    const cases: Array<{ input: unknown; code: string }> = [
      {
        input: {
          entries: [
            { title: '第1課', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
            { title: '第2課', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
          ],
          warnings: [],
        },
        code: 'E_TOC_DRAFT_ORDER',
      },
      {
        input: {
          entries: [
            { title: '   ', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
            { title: '第2課', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
          ],
          warnings: [],
        },
        code: 'E_TOC_DRAFT_TITLE',
      },
      {
        input: {
          entries: [
            { title: '123', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' },
            { title: '456', printedPage: 30, level: 1, kind: 'lesson', confidence: 'high' },
          ],
          warnings: [],
        },
        code: 'E_TOC_DRAFT_TITLE',
      },
    ];
    for (const item of cases) {
      const inspectorCalls = newCalls();
      const agentCalls = newAgentCalls();
      const events: TocReviewToolEvent[] = [];
      const res = await reviewTocWithAgent(
        {
          loadInspector: async () => {
            inspectorCalls.load++;
            return agentMock({ pageCount: 371, calls: inspectorCalls, ocrMarkdown: twoPageOcr() });
          },
          adapter: mockToolAdapter({ calls: agentCalls, steps: [{ kind: 'tool', input: item.input }, { kind: 'tool', input: item.input }] }),
          toolObserver: { emit: (e: TocReviewToolEvent) => events.push(e) },
        },
        { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
      );
      expect(isOk(res)).toBe(true);
      if (!isOk(res)) continue;
      expect(res.value.reviewStatus).toBe('unavailable');
      expect(res.value.reviewError?.code).toBe('E_TOC_REVIEW_TOOL_INVALID');
      expect(res.value.draft).toBeNull();
      expect(res.value.baseline.verdict).toBe('usable');
      expect(events.filter((e) => e.type === 'tool_validation_failed').length).toBe(2);
    }
  });

  it('P3.2A empty 但证据有目录信号 → 工具重建 ≥2 条（无同行页码行）', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          // 有目次/课号/标题但无同行末页码 → baseline empty，证据可重建
          return agentMock({
            pageCount: 371,
            calls: inspectorCalls,
            ocrMarkdown: new Map([[1, '目次\n第1課 はじめまして\n第2課 これは本です']]),
          });
        },
        adapter: mockToolAdapter({ calls: agentCalls, steps: [{ kind: 'tool', input: GOOD_TOOL_INPUT }] }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 1 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.baseline.verdict).toBe('empty');
    expect(res.value.baseline.entries).toEqual([]);
    expect(res.value.reviewStatus).toBe('ok');
    expect(res.value.draft?.entries.length).toBe(2);
    expect(agentCalls.create).toBe(1);
    expect(agentCalls.inputs.length).toBe(1);
  });

  it('P3.2A 普通正文 → empty 且无信号，零 Agent 调用', async () => {
    const inspectorCalls = newCalls();
    const agentCalls = newAgentCalls();
    const res = await reviewTocWithAgent(
      {
        loadInspector: async () => {
          inspectorCalls.load++;
          return agentMock({
            pageCount: 371,
            calls: inspectorCalls,
            ocrMarkdown: new Map([[1, '本文です。これはテストです。よろしくおねがいします。']]),
          });
        },
        adapter: mockToolAdapter({ calls: agentCalls, steps: [{ kind: 'tool', input: GOOD_TOOL_INPUT }] }),
      },
      { userId: 'u1', filename: 'toc.pdf', bytes: mockBytes(), fromPage: 1, toPage: 1 }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_TOC_EVIDENCE_INSUFFICIENT');
    expect(agentCalls.create).toBe(0);
  });
});
