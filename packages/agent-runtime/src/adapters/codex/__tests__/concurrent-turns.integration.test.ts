import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { BusinessError, ok, type Result } from '@study-studio/shared';
import type { AgentEvent } from '../../../contracts/index.js';
import { CodexAdapter } from '../codex-adapter.js';
import { CodexAppServerConnection } from '../app-server-client.js';
import { JsonRpcStdioClient, type JsonRpcNotification, type JsonRpcRequest } from '../jsonrpc-stdio.js';

/** Only the process/JSON-RPC transport is controlled; both sessions share the real connection and Adapter. */
class InterleavedRpc extends JsonRpcStdioClient {
  private connected = false;
  private threadNumber = 0;
  private turnNumber = 0;
  private listeners = new Set<(note: JsonRpcNotification) => void>();
  private serverHandler: ((req: JsonRpcRequest) => unknown | Promise<unknown>) | undefined;
  readonly started = new Map<string, string>();
  override get isConnected() { return this.connected; }
  override async start() { this.connected = true; return ok(undefined); }
  override notify() { return ok(undefined); }
  override async close() { this.connected = false; return ok(undefined); }
  override async request<T = unknown>(method: string, params?: unknown): Promise<Result<T, BusinessError>> {
    let result: unknown = {};
    if (method === 'thread/start') result = { thread: { id: `thread-${++this.threadNumber}` } };
    if (method === 'turn/start') {
      const value = z.object({ threadId: z.string() }).parse(params);
      const turnId = `turn-${++this.turnNumber}`;
      this.started.set(value.threadId, turnId); result = { turn: { id: turnId } };
    }
    // Controlled response shapes match each production RPC method above; no untrusted response is accepted.
    return ok(result as T);
  }
  override onNotification(listener: (note: JsonRpcNotification) => void) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  override onServerRequest(handler: (req: JsonRpcRequest) => unknown | Promise<unknown>) {
    this.serverHandler = handler; return () => { this.serverHandler = undefined; };
  }
  emit(method: string, params: unknown) { for (const listener of this.listeners) listener({ method, params }); }
  async call(params: unknown) { return this.serverHandler?.({ id: 1, method: 'item/tool/call', params }); }
}
async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('受控通知测试超时'); await Bun.sleep(2); }
}
describe('共享 Codex 连接的并行模型交互', () => {
  it('线程与旧轮次隔离、B 结束不结束 A；原生 callId 和合法枚举到达工具与模型', async () => {
    const rpc = new InterleavedRpc();
    const connection = new CodexAppServerConnection({ command: 'controlled-codex', enabled: true });
    Object.defineProperty(connection, 'rpc', { value: rpc });
    const calls: Array<{ sessionId: string; callId?: string }> = [];
    const adapter = new CodexAdapter({ connection, executeTool: async (_name, _input, context) => {
      calls.push({ sessionId: context.sessionId, ...(context.callId ? { callId: context.callId } : {}) });
      throw new BusinessError('E_LLM_SCHEMA_INVALID', '目录覆盖状态不符合要求', 'VALIDATION', true,
        [{ path: ['content', 'coverage', 0, 'status'], received: 'OK', options: ['EXTRACTED', 'UNREADABLE'] }]);
    } });
    const tool = { name: 'test.commit', description: '提交', location: 'SERVER' as const, permission: 'WRITE' as const,
      schema: z.object({ status: z.enum(['EXTRACTED', 'UNREADABLE']) }), execute: async () => ok(undefined) };
    const createdA = await adapter.createSession({ sessionId: 'A', userId: 'owner', tools: [tool] });
    const createdB = await adapter.createSession({ sessionId: 'B', userId: 'owner', tools: [tool] });
    if (!createdA.ok || !createdB.ok) throw new Error('测试会话创建失败');
    const a = createdA.value, b = createdB.value;
    const seenA: AgentEvent[] = [], seenB: AgentEvent[] = [];
    let endedA = false;
    const drainA = (async () => { for await (const event of a.send({ message: '章 A' })) seenA.push(event); endedA = true; })();
    const drainB = (async () => { for await (const event of b.send({ message: '章 B' })) seenB.push(event); })();
    try {
      await waitFor(() => rpc.started.size === 2); await Bun.sleep(5);
      const turnA = rpc.started.get(a.threadId!)!, turnB = rpc.started.get(b.threadId!)!;
      rpc.emit('item/agentMessage/delta', { threadId: a.threadId, turnId: turnA, delta: 'A 正文' });
      rpc.emit('item/agentMessage/delta', { threadId: b.threadId, turnId: turnB, delta: 'B 正文' });
      rpc.emit('turn/completed', { threadId: a.threadId, turn: { id: 'stale-A', status: 'completed' } });
      rpc.emit('turn/completed', { threadId: b.threadId, turn: { id: turnB, status: 'completed' } });
      await drainB; expect(endedA).toBe(false);
      const reply = await rpc.call({ threadId: a.threadId, turnId: turnA, callId: 'native-call-A', tool: 'test_commit', arguments: { status: 'OK' } });
      const parsed = z.object({ success: z.boolean(), contentItems: z.array(z.object({ text: z.string() })) }).parse(reply);
      expect(parsed.success).toBe(false);
      expect(JSON.parse(parsed.contentItems[0]!.text).issues[0].options).toEqual(['EXTRACTED', 'UNREADABLE']);
      expect(calls).toEqual([{ sessionId: 'A', callId: 'native-call-A' }]);
      rpc.emit('turn/completed', { threadId: a.threadId, turn: { id: turnA, status: 'completed' } });
      await drainA;
      expect(seenA.filter(e => e.type === 'TEXT_DELTA')).toEqual([{ type: 'TEXT_DELTA', delta: 'A 正文' }]);
      expect(seenB.filter(e => e.type === 'TEXT_DELTA')).toEqual([{ type: 'TEXT_DELTA', delta: 'B 正文' }]);
    } finally { await a.close(); await b.close(); await Promise.allSettled([drainA, drainB]); await connection.close(); }
  });
});
