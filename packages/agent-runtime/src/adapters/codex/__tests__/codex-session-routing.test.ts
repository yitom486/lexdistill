import { describe, expect, it } from 'bun:test';
import { isOk, ok } from '@study-studio/shared';
import type { AgentEvent } from '@study-studio/agent-runtime';
import type { ToolDefinition } from '@study-studio/tool-core';
import { CodexAdapter } from '../codex-adapter.js';
import type { CodexAppServerConnection } from '../app-server-client.js';
import type { CodexApprovalRequest } from '../app-server-protocol.js';
import type { DynamicToolCallParams } from '../app-server-protocol.js';

/**
 * CMD-LINGUA-P3.4B-FIX 并发会话工具路由测试。
 *
 * 用单一连接级测试替身（与真实 server 同一回调形状）：两个并发 session
 *（主 lane + 目录审核）共享一个 CodexAppServerConnection；直接调用连接层
 * 捕获到的唯一 handler，模拟 App Server 的 item/tool/call 回调。
 * 不用两个独立 fake adapter 替代——回归目标正是“后创建覆盖先创建”的单例槽。
 */

interface RecordedCall {
  toolName: string;
  sessionId: string;
  userId: string;
}

const KNOWN_TOOLS = new Set(['learning.content', 'session_review.synthetic_tool']);

function toolDef(name: string): ToolDefinition {
  return {
    name,
    description: `test tool ${name}`,
    location: 'SERVER',
    permission: 'READ',
    // 路由只读 name（bridge 读 _def.shape），从不执行 safeParse；
    // 具体结构化断言见注释：空对象形，调用方保证 toolsToDynamicSpecs 可读。
    schema: { _def: { typeName: 'ZodObject', shape: () => ({}) } } as unknown as ToolDefinition['schema'],
    execute: async () => ok(undefined),
  };
}

interface FakeConn {
  capturedHandler: ((params: DynamicToolCallParams) => Promise<unknown>) | null;
  capturedApprovalHandler: ((req: CodexApprovalRequest) => Promise<unknown>) | null;
  handlerInstalls: number;
  threadSeq: number;
  connection: CodexAppServerConnection;
  calls: RecordedCall[];
  approvalPolicyDefault: string;
  turnGates: Map<string, () => void>;
}

function makeFakeConnection(approvalPolicyDefault = 'never'): FakeConn {
  const fake: FakeConn = {
    capturedHandler: null,
    capturedApprovalHandler: null,
    handlerInstalls: 0,
    threadSeq: 0,
    calls: [],
    approvalPolicyDefault,
    turnGates: new Map(),
    connection: undefined as never,
  };
  const conn = {
    setToolCallHandler(handler: (params: DynamicToolCallParams) => Promise<unknown>): void {
      fake.handlerInstalls++;
      fake.capturedHandler = handler;
    },
    setApprovalHandler(handler: (req: CodexApprovalRequest) => Promise<unknown>): void {
      fake.capturedApprovalHandler = handler;
    },
    getConfiguredApprovalPolicy(): string {
      return fake.approvalPolicyDefault;
    },
    startThread: async (): Promise<unknown> => {
      fake.threadSeq++;
      return ok({ threadId: `thread-${fake.threadSeq}` });
    },
    resumeThread: async (): Promise<unknown> => ok({ threadId: 'thread-resumed' }),
    runTurn: async function* (params: { threadId: string }): AsyncGenerator<AgentEvent, void, unknown> {
      yield { type: 'TEXT_DELTA', delta: 'partial' };
      await new Promise<void>((resolve) => {
        fake.turnGates.set(params.threadId, resolve);
      });
    },
  };
  // 与 image-attachments.test.ts 同口径：结构替身 + 精确类型断言（非 as any）。
  fake.connection = conn as unknown as CodexAppServerConnection;
  return fake;
}

function makeAdapter(fake: FakeConn): CodexAdapter {
  return new CodexAdapter({
    connection: fake.connection,
    executeTool: async (toolName: string, _input: Record<string, unknown>, ctx: { sessionId: string; userId: string }) => {
      fake.calls.push({ toolName, sessionId: ctx.sessionId, userId: ctx.userId });
      if (!KNOWN_TOOLS.has(toolName)) throw new Error(`tool not found: ${toolName}`);
      // 忠实建模审核工具自带会话登记门
      //（P3.4B-ISO 注册检查），未登记会话在执行侧拒绝。
      if (toolName === 'session_review.synthetic_tool' && ctx.sessionId !== 'sess-review') {
        throw new Error('E_SYNTHETIC_TOOL_SESSION');
      }
      return { executed: toolName };
    },
  });
}

async function toolCall(
  fake: FakeConn,
  params: { threadId: string; turnId: string; tool: string }
): Promise<{ success: boolean; text: string }> {
  if (!fake.capturedHandler) throw new Error('router handler not installed');
  const res = (await fake.capturedHandler({
    ...params,
    itemId: `item-${params.turnId}`,
    arguments: {},
    namespace: null,
  })) as { success: boolean; contentItems: Array<{ text: string }> };
  return { success: res.success, text: res.contentItems[0]?.text ?? '' };
}

describe('P3.4B-FIX 单连接并发工具路由', () => {
  it('handler 只安装一次；交错调用各回各的 session 身份', async () => {
    const fake = makeFakeConnection();
    const adapter = makeAdapter(fake);
    const mainRes = await adapter.createSession({
      sessionId: 'sess-main',
      userId: 'u-main',
      tools: [toolDef('learning.content')],
      ephemeral: true,
    });
    const reviewRes = await adapter.createSession({
      sessionId: 'sess-review',
      userId: 'u-review',
      tools: [toolDef('session_review.synthetic_tool')],
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;
    expect(fake.handlerInstalls).toBe(1);
    expect(mainRes.value.toolSpecs).toEqual([{ name: 'learning_content', businessName: 'learning.content', description: 'test tool learning.content', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }]);

    // 交错：主→审→主→审（旧设计下全部走后创建的 review 身份）
    const r1 = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-m1', tool: 'learning.content' });
    const r2 = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-r1', tool: 'session_review.synthetic_tool' });
    const r3 = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-m2', tool: 'learning.content' });
    const r4 = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-r2', tool: 'session_review.synthetic_tool' });
    for (const r of [r1, r2, r3, r4]) expect(r.success).toBe(true);
    expect(fake.calls).toEqual([
      { toolName: 'learning.content', sessionId: 'sess-main', userId: 'u-main' },
      { toolName: 'session_review.synthetic_tool', sessionId: 'sess-review', userId: 'u-review' },
      { toolName: 'learning.content', sessionId: 'sess-main', userId: 'u-main' },
      { toolName: 'session_review.synthetic_tool', sessionId: 'sess-review', userId: 'u-review' },
    ]);
    // 成功回执只含执行结果计数形负载（本替身回 executed 标记），无对方会话痕迹
    expect(JSON.parse(r2.text)).toEqual({ executed: 'session_review.synthetic_tool' });

    await mainRes.value.close();
    await reviewRes.value.close();
  });

  it('主 lane 调目录工具被拒；审核会话调自有工具放行（allowlist 按会话）', async () => {
    const fake = makeFakeConnection();
    const adapter = makeAdapter(fake);
    const mainRes = await adapter.createSession({
      sessionId: 'sess-main',
      userId: 'u-main',
      tools: [toolDef('learning.content')],
      ephemeral: true,
    });
    const reviewRes = await adapter.createSession({
      sessionId: 'sess-review',
      userId: 'u-review',
      tools: [toolDef('session_review.synthetic_tool')],
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;

    // 主 lane 未声明目录工具：adapter 层直接拒绝，executeTool 零调用。
    //（旧设计会把候选名逐个送进全局执行；P3.4B-FIX2 起归一后必须命中声明集。）
    const denied = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-mx', tool: 'session_review.synthetic_tool' });
    expect(denied.success).toBe(false);
    expect(fake.calls.filter((c) => c.sessionId === 'sess-main' && c.toolName === 'session_review.synthetic_tool')).toEqual([]);
    // 主 lane 伪造调用任意未声明的全局 WRITE 工具：同样零调用
    const deniedGlobal = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-my', tool: 'flashcards.collect' });
    expect(deniedGlobal.success).toBe(false);
    expect(fake.calls.filter((c) => c.sessionId === 'sess-main')).toEqual([]);
    // 目录工具不进主 lane：声明 allowlist 之外的调用在执行侧发不出来
    const allowed = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-rx', tool: 'session_review.synthetic_tool' });
    expect(allowed.success).toBe(true);
    // review 会话恰好一次成功执行（主会话的变体名尝试全部失败在前，不影响）
    expect(fake.calls.filter((c) => c.sessionId === 'sess-review')).toEqual([
      { toolName: 'session_review.synthetic_tool', sessionId: 'sess-review', userId: 'u-review' },
    ]);

    await mainRes.value.close();
    await reviewRes.value.close();
  });

  it('未知 threadId/turnId fail-closed：静态安全文案，不猜身份', async () => {
    const fake = makeFakeConnection();
    const adapter = makeAdapter(fake);
    const mainRes = await adapter.createSession({
      sessionId: 'sess-main',
      userId: 'u-main',
      tools: [toolDef('learning.content')],
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    if (!isOk(mainRes)) return;

    const orphan = await toolCall(fake, { threadId: 'thread-ghost', turnId: 'turn-ghost', tool: 'learning.content' });
    expect(orphan.success).toBe(false);
    const payload = JSON.parse(orphan.text) as { error?: string };
    expect(payload.error).toBe('No owning session for this tool call (fail-closed)');
    // 失败不执行、不记调用、不回显任何 id
    expect(fake.calls).toEqual([]);
    expect(orphan.text).not.toContain('sess-main');
    expect(orphan.text).not.toContain('u-main');

    await mainRes.value.close();
  });

  it('turnId 次键：同 thread 学到的 turn，后续可凭 turn 找回；关闭后双键失效', async () => {    const fake = makeFakeConnection();
    const adapter = makeAdapter(fake);
    const mainRes = await adapter.createSession({
      sessionId: 'sess-main',
      userId: 'u-main',
      tools: [toolDef('learning.content')],
      ephemeral: true,
    });
    const reviewRes = await adapter.createSession({
      sessionId: 'sess-review',
      userId: 'u-review',
      tools: [toolDef('session_review.synthetic_tool')],
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;

    const first = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-learned', tool: 'session_review.synthetic_tool' });
    expect(first.success).toBe(true);
    // thread 换了个未知值，但 turn 已学到 → 仍归属 review 会话
    const viaTurn = await toolCall(fake, { threadId: 'thread-unknown', turnId: 'turn-learned', tool: 'session_review.synthetic_tool' });
    expect(viaTurn.success).toBe(true);
    expect(fake.calls[fake.calls.length - 1]).toEqual({
      toolName: 'session_review.synthetic_tool',
      sessionId: 'sess-review',
      userId: 'u-review',
    });

    // 关闭审核会话：thread 键与已学 turn 键同时失效，主会话不受影响
    await reviewRes.value.close();
    const afterCloseThread = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-r9', tool: 'session_review.synthetic_tool' });
    expect(afterCloseThread.success).toBe(false);
    const afterCloseTurn = await toolCall(fake, { threadId: 'thread-unknown', turnId: 'turn-learned', tool: 'session_review.synthetic_tool' });
    expect(afterCloseTurn.success).toBe(false);
    const mainStill = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-m9', tool: 'learning.content' });
    expect(mainStill.success).toBe(true);
    expect(fake.calls[fake.calls.length - 1]).toEqual({
      toolName: 'learning.content',
      sessionId: 'sess-main',
      userId: 'u-main',
    });

    await mainRes.value.close();
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor 超时：条件未成立');
    await tick();
  }
}

async function drain(session: { send(input: { message: string }): AsyncIterable<AgentEvent> }): Promise<{ seen: AgentEvent[]; done: Promise<void> }> {
  const seen: AgentEvent[] = [];
  const done = (async () => {
    for await (const ev of session.send({ message: 'hi' })) seen.push(ev);
  })();
  return { seen, done };
}

function approvalReq(over: Partial<CodexApprovalRequest> & { approvalId: string }): CodexApprovalRequest {
  return {
    method: 'item/permissions/requestApproval',
    threadId: undefined,
    turnId: undefined,
    itemId: undefined,
    action: 'read files',
    description: 'read-only probe',
    riskLevel: 'low',
    ...over,
  } as CodexApprovalRequest;
}

describe('P3.4B-FIX2 单连接审批路由', () => {
  it('两会话交错 approval：事件、submitApproval、最终 decision 全归正确会话', async () => {
    const fake = makeFakeConnection('never');
    const adapter = makeAdapter(fake);
    const mainRes = await adapter.createSession({
      sessionId: 'sess-main',
      userId: 'u-main',
      tools: [toolDef('learning.content')],
      approvalPolicy: 'on-request',
      ephemeral: true,
    });
    const reviewRes = await adapter.createSession({
      sessionId: 'sess-review',
      userId: 'u-review',
      tools: [toolDef('session_review.synthetic_tool')],
      approvalPolicy: 'on-request',
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;
    if (!fake.capturedApprovalHandler) throw new Error('approval router not installed');

    const mainDrain = await drain(mainRes.value);
    const reviewDrain = await drain(reviewRes.value);
    await tick();

    // 主会话审批：事件只进主会话流
    const pMain = fake.capturedApprovalHandler(
      approvalReq({ approvalId: 'appr-m1', threadId: 'thread-1', turnId: 'turn-m1' })
    );
    await waitFor(() => mainDrain.seen.some((e) => e.type === 'APPROVAL_REQUESTED'));
    expect(reviewDrain.seen.some((e) => e.type === 'APPROVAL_REQUESTED')).toBe(false);
    const mainEv = mainDrain.seen.find((e) => e.type === 'APPROVAL_REQUESTED');
    expect(mainEv).toMatchObject({ approvalId: 'appr-m1' });
    // 错会话 submit 不得解开：review 解 appr-m1 必须 NOT_FOUND
    const wrongRes = await reviewRes.value.submitApproval('appr-m1', 'accept');
    expect(isOk(wrongRes)).toBe(false);
    if (isOk(wrongRes)) throw new Error('wrong-session submit must fail');
    expect(wrongRes.error.code).toBe('E_APPROVAL_NOT_FOUND');
    // 正确会话 submit 生效，最终 decision 回到 server 侧
    const rightRes = await mainRes.value.submitApproval('appr-m1', 'accept');
    expect(isOk(rightRes)).toBe(true);
    expect(await pMain).toBe('accept');

    // 审核会话审批：镜像验证 decline 路径
    const pReview = fake.capturedApprovalHandler(
      approvalReq({ approvalId: 'appr-r1', threadId: 'thread-2', turnId: 'turn-r1' })
    );
    await waitFor(() => reviewDrain.seen.some((e) => e.type === 'APPROVAL_REQUESTED'));
    const reviewRight = await reviewRes.value.submitApproval('appr-r1', 'decline');
    expect(isOk(reviewRight)).toBe(true);
    expect(await pReview).toBe('decline');

    fake.turnGates.get('thread-1')?.();
    fake.turnGates.get('thread-2')?.();
    await mainDrain.done;
    await reviewDrain.done;
    await mainRes.value.close();
    await reviewRes.value.close();
  });

  it('未知 / 已关闭 / thread-turn 矛盾 approval 全部 decline，不注册不打扰', async () => {
    const fake = makeFakeConnection('never');
    const adapter = makeAdapter(fake);
    const mainRes = await adapter.createSession({
      sessionId: 'sess-main',
      userId: 'u-main',
      tools: [toolDef('learning.content')],
      approvalPolicy: 'on-request',
      ephemeral: true,
    });
    const reviewRes = await adapter.createSession({
      sessionId: 'sess-review',
      userId: 'u-review',
      tools: [toolDef('session_review.synthetic_tool')],
      approvalPolicy: 'on-request',
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;
    if (!fake.capturedApprovalHandler) throw new Error('approval router not installed');
    const handle = fake.capturedApprovalHandler;

    // 未知 thread+turn
    expect(await handle(approvalReq({ approvalId: 'a-u1', threadId: 'thread-ghost', turnId: 'turn-ghost' }))).toBe('decline');
    // 学一个 turn 给 review，再用主 thread 配 review turn → 矛盾
    const mainDrain = await drain(mainRes.value);
    const reviewDrain = await drain(reviewRes.value);
    await tick();
    const pLearn = handle(approvalReq({ approvalId: 'a-l1', threadId: 'thread-2', turnId: 'turn-shared' }));
    await waitFor(() => reviewDrain.seen.some((e) => e.type === 'APPROVAL_REQUESTED'));
    const contra = await handle(approvalReq({ approvalId: 'a-c1', threadId: 'thread-1', turnId: 'turn-shared' }));
    expect(contra).toBe('decline');
    // 矛盾请求不得在任何会话流里留下事件
    expect(mainDrain.seen.some((e) => e.type === 'APPROVAL_REQUESTED')).toBe(false);
    await reviewRes.value.submitApproval('a-l1', 'decline');
    expect(await pLearn).toBe('decline');
    // 关闭审核会话：其 thread 与已学 turn 同时失效
    await reviewRes.value.close();
    expect(await handle(approvalReq({ approvalId: 'a-c2', threadId: 'thread-2', turnId: 'turn-r9' }))).toBe('decline');
    expect(await handle(approvalReq({ approvalId: 'a-c3', threadId: 'thread-x', turnId: 'turn-shared' }))).toBe('decline');
    // 主会话不受影响
    const pOk = handle(approvalReq({ approvalId: 'a-ok', threadId: 'thread-1', turnId: 'turn-m9' }));
    await waitFor(() => mainDrain.seen.some((e) => e.type === 'APPROVAL_REQUESTED'));
    await mainRes.value.submitApproval('a-ok', 'accept');
    expect(await pOk).toBe('accept');

    fake.turnGates.get('thread-1')?.();
    fake.turnGates.get('thread-2')?.();
    await mainDrain.done;
    await reviewDrain.done;
    await mainRes.value.close();
  });

  it('策略分级：never 静默 accept；turn 覆盖优先于创建声明；连接默认兜底', async () => {
    // never 会话：无事件直接 accept（默认不打扰用户）
    const fakeNever = makeFakeConnection('never');
    const adapterNever = makeAdapter(fakeNever);
    const neverRes = await adapterNever.createSession({
      sessionId: 'sess-quiet',
      userId: 'u-quiet',
      tools: [],
      ephemeral: true,
    });
    expect(isOk(neverRes)).toBe(true);
    if (!isOk(neverRes)) return;
    if (!fakeNever.capturedApprovalHandler) throw new Error('approval router not installed');
    const quietDrain = await drain(neverRes.value);
    await tick();
    expect(await fakeNever.capturedApprovalHandler(approvalReq({ approvalId: 'a-q1', threadId: 'thread-1' }))).toBe('accept');
    await tick();
    expect(quietDrain.seen.some((e) => e.type === 'APPROVAL_REQUESTED')).toBe(false);
    fakeNever.turnGates.get('thread-1')?.();
    await quietDrain.done;
    await neverRes.value.close();

    // turn 覆盖：创建 never + 本轮 on-request → 走事件（turn 优先于创建声明）
    const fakeTurn = makeFakeConnection('never');
    const adapterTurn = makeAdapter(fakeTurn);
    const turnRes = await adapterTurn.createSession({
      sessionId: 'sess-turn',
      userId: 'u-turn',
      tools: [],
      ephemeral: true,
    });
    expect(isOk(turnRes)).toBe(true);
    if (!isOk(turnRes)) return;
    if (!fakeTurn.capturedApprovalHandler) throw new Error('approval router not installed');
    const seen: AgentEvent[] = [];
    const done = (async () => {
      for await (const ev of turnRes.value.send({ message: 'hi', turnOptions: { approvalPolicy: 'on-request' } })) seen.push(ev);
    })();
    await tick();
    const pTurn = fakeTurn.capturedApprovalHandler(approvalReq({ approvalId: 'a-t1', threadId: 'thread-1' }));
    await waitFor(() => seen.some((e) => e.type === 'APPROVAL_REQUESTED'));
    await turnRes.value.submitApproval('a-t1', 'accept');
    expect(await pTurn).toBe('accept');
    fakeTurn.turnGates.get('thread-1')?.();
    await done;
    await turnRes.value.close();

    // 连接默认 on-request：无声明会话同样走事件（env 默认不断链）
    const fakeConn = makeFakeConnection('on-request');
    const adapterConn = makeAdapter(fakeConn);
    const connRes = await adapterConn.createSession({
      sessionId: 'sess-conn',
      userId: 'u-conn',
      tools: [],
      ephemeral: true,
    });
    expect(isOk(connRes)).toBe(true);
    if (!isOk(connRes)) return;
    if (!fakeConn.capturedApprovalHandler) throw new Error('approval router not installed');
    const seenConn: AgentEvent[] = [];
    const doneConn = (async () => {
      for await (const ev of connRes.value.send({ message: 'hi' })) seenConn.push(ev);
    })();
    await tick();
    const pConn = fakeConn.capturedApprovalHandler(approvalReq({ approvalId: 'a-c1', threadId: 'thread-1' }));
    await waitFor(() => seenConn.some((e) => e.type === 'APPROVAL_REQUESTED'));
    await connRes.value.submitApproval('a-c1', 'decline');
    expect(await pConn).toBe('decline');
    fakeConn.turnGates.get('thread-1')?.();
    await doneConn;
    await connRes.value.close();
  });
});

describe('P3.4B-FIX3 工具 thread/turn 矛盾 fail-closed', () => {
  it('review 学到 turn 后，主 thread 配 review turn 的调用被拒且零副作用', async () => {
    const fake = makeFakeConnection('never');
    const adapter = makeAdapter(fake);
    const mainRes = await adapter.createSession({
      sessionId: 'sess-main',
      userId: 'u-main',
      tools: [toolDef('learning.content')],
      ephemeral: true,
    });
    const reviewRes = await adapter.createSession({
      sessionId: 'sess-review',
      userId: 'u-review',
      tools: [toolDef('session_review.synthetic_tool')],
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;

    // 先让 review 学到 turn-r7（合法调用，成功）
    const learned = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-r7', tool: 'session_review.synthetic_tool' });
    expect(learned.success).toBe(true);
    const callsBefore = fake.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    // 矛盾调用：main 的 thread + review 的 turn
    const conflict = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-r7', tool: 'learning.content' });
    expect(conflict.success).toBe(false);
    const payload = JSON.parse(conflict.text) as { error?: string };
    expect(payload.error).toBe('Conflicting thread/turn ownership for this tool call (fail-closed)');
    // 静态文案：不含任何 id 与参数内容
    for (const secret of ['thread-1', 'thread-2', 'turn-r7', 'sess-main', 'sess-review', 'u-main', 'u-review', 'learning.content']) {
      expect(conflict.text).not.toContain(secret);
    }
    // executeTool 零调用：两个会话的调用记录都未变化
    expect(fake.calls.length).toBe(callsBefore);

    // 双会话功能不受影响：之后各自合法调用依然成功
    const mainOk = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-m9', tool: 'learning.content' });
    expect(mainOk.success).toBe(true);
    const reviewOk = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-r7', tool: 'session_review.synthetic_tool' });
    expect(reviewOk.success).toBe(true);
    expect(fake.calls[fake.calls.length - 2]).toEqual({
      toolName: 'learning.content',
      sessionId: 'sess-main',
      userId: 'u-main',
    });
    expect(fake.calls[fake.calls.length - 1]).toEqual({
      toolName: 'session_review.synthetic_tool',
      sessionId: 'sess-review',
      userId: 'u-review',
    });

    await mainRes.value.close();
    await reviewRes.value.close();
  });
});
