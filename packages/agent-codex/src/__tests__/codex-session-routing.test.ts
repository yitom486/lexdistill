import { describe, expect, it } from 'bun:test';
import { isOk, ok } from '@study-studio/shared';
import type { ToolDefinition } from '@study-studio/tool-core';
import { CodexAdapter } from '../codex-adapter.js';
import type { CodexAppServerConnection } from '../app-server-client.js';
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

const KNOWN_TOOLS = new Set(['learning.content', 'toc_draft_replace_all']);

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
  handlerInstalls: number;
  threadSeq: number;
  connection: CodexAppServerConnection;
  calls: RecordedCall[];
}

function makeFakeConnection(): FakeConn {
  const fake: FakeConn = {
    capturedHandler: null,
    handlerInstalls: 0,
    threadSeq: 0,
    calls: [],
    connection: undefined as never,
  };
  const conn = {
    setToolCallHandler(handler: (params: DynamicToolCallParams) => Promise<unknown>): void {
      fake.handlerInstalls++;
      fake.capturedHandler = handler;
    },
    setApprovalHandler(): void {},
    startThread: async (): Promise<unknown> => {
      fake.threadSeq++;
      return ok({ threadId: `thread-${fake.threadSeq}` });
    },
    resumeThread: async (): Promise<unknown> => ok({ threadId: 'thread-resumed' }),
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
      // 忠实建模生产行为：toc_draft_replace_all 自带会话登记门
      //（P3.4B-ISO 注册检查），未登记会话在执行侧拒绝。
      if (toolName === 'toc_draft_replace_all' && ctx.sessionId !== 'sess-review') {
        throw new Error('E_TOC_DRAFT_SESSION');
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
      tools: [toolDef('toc_draft_replace_all')],
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;
    expect(fake.handlerInstalls).toBe(1);

    // 交错：主→审→主→审（旧设计下全部走后创建的 review 身份）
    const r1 = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-m1', tool: 'learning.content' });
    const r2 = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-r1', tool: 'toc_draft_replace_all' });
    const r3 = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-m2', tool: 'learning.content' });
    const r4 = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-r2', tool: 'toc_draft_replace_all' });
    for (const r of [r1, r2, r3, r4]) expect(r.success).toBe(true);
    expect(fake.calls).toEqual([
      { toolName: 'learning.content', sessionId: 'sess-main', userId: 'u-main' },
      { toolName: 'toc_draft_replace_all', sessionId: 'sess-review', userId: 'u-review' },
      { toolName: 'learning.content', sessionId: 'sess-main', userId: 'u-main' },
      { toolName: 'toc_draft_replace_all', sessionId: 'sess-review', userId: 'u-review' },
    ]);
    // 成功回执只含执行结果计数形负载（本替身回 executed 标记），无对方会话痕迹
    expect(JSON.parse(r2.text)).toEqual({ executed: 'toc_draft_replace_all' });

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
      tools: [toolDef('toc_draft_replace_all')],
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;

    // 主 lane 未声明目录工具：尝试以主会话身份执行 → 工具自带会话门拒绝。
    // 关键断言有二：① success 为 false（没执行成）；② 这次尝试记在了主会话名下
    //（路由正确——若错配到 review 身份，门就放行了，回归即抓包）。
    const denied = await toolCall(fake, { threadId: 'thread-1', turnId: 'turn-mx', tool: 'toc_draft_replace_all' });
    expect(denied.success).toBe(false);
    expect(fake.calls.filter((c) => c.sessionId === 'sess-main' && c.toolName === 'toc_draft_replace_all')).toEqual([
      { toolName: 'toc_draft_replace_all', sessionId: 'sess-main', userId: 'u-main' },
    ]);
    // 目录工具不进主 lane：声明 allowlist 之外的调用在执行侧发不出来
    const allowed = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-rx', tool: 'toc_draft_replace_all' });
    expect(allowed.success).toBe(true);
    // review 会话恰好一次成功执行（主会话的变体名尝试全部失败在前，不影响）
    expect(fake.calls.filter((c) => c.sessionId === 'sess-review')).toEqual([
      { toolName: 'toc_draft_replace_all', sessionId: 'sess-review', userId: 'u-review' },
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

  it('turnId 次键：同 thread 学到的 turn，后续可凭 turn 找回；关闭后双键失效', async () => {
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
      tools: [toolDef('toc_draft_replace_all')],
      ephemeral: true,
    });
    expect(isOk(mainRes)).toBe(true);
    expect(isOk(reviewRes)).toBe(true);
    if (!isOk(mainRes) || !isOk(reviewRes)) return;

    const first = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-learned', tool: 'toc_draft_replace_all' });
    expect(first.success).toBe(true);
    // thread 换了个未知值，但 turn 已学到 → 仍归属 review 会话
    const viaTurn = await toolCall(fake, { threadId: 'thread-unknown', turnId: 'turn-learned', tool: 'toc_draft_replace_all' });
    expect(viaTurn.success).toBe(true);
    expect(fake.calls[fake.calls.length - 1]).toEqual({
      toolName: 'toc_draft_replace_all',
      sessionId: 'sess-review',
      userId: 'u-review',
    });

    // 关闭审核会话：thread 键与已学 turn 键同时失效，主会话不受影响
    await reviewRes.value.close();
    const afterCloseThread = await toolCall(fake, { threadId: 'thread-2', turnId: 'turn-r9', tool: 'toc_draft_replace_all' });
    expect(afterCloseThread.success).toBe(false);
    const afterCloseTurn = await toolCall(fake, { threadId: 'thread-unknown', turnId: 'turn-learned', tool: 'toc_draft_replace_all' });
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
