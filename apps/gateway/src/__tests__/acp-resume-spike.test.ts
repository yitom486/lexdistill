import { afterEach, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { AcpClient, pickAllowOptionId } from '@yitom/acp-client';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { DictionaryLookupTool } from '../modules/dictionary/tools/dictionary-lookup-tool.js';
import { FlashcardsDueTool } from '../modules/flashcards/tools/flashcards-due-tool.js';
import { AcpAdapter } from '@study-studio/agent-runtime';
import { startSpikeToolBridge, type SpikeBridgeCall } from './acp-spike-bridge.js';

/**
 * Phase 0 spike：ACP 传输＋工具＋resume 带工具证明。
 *
 * 门禁：缺 LINGUA_ACP_SPIKE=1 直接跳过（不烧模型、不碰网）；实跑需 codex-acp
 * 可用登录（~/.codex 或 OPENAI_API_KEY/CODEX_API_KEY）＋用户每次显式批准。
 * 断言只认 MCP 桥收到的真实调用记录，不认模型嘴上说的话。
 */
describe('ACP resume spike (manual, LINGUA_ACP_SPIKE=1)', () => {
  it('建会话调工具 → resume 同工具集 → 工具仍可调（resume 带工具得证）', async () => {
    if (process.env['LINGUA_ACP_SPIKE'] !== '1') {
      console.log('SKIP acp-resume-spike：置 LINGUA_ACP_SPIKE=1 并备好 codex-acp 登录后实跑');
      return;
    }
    const repo = new DrizzleLearnerRepository(':memory:');
    const calls: SpikeBridgeCall[] = [];
    const toolDefs = [new DictionaryLookupTool(repo), new FlashcardsDueTool(repo)];
    const bridge = await startSpikeToolBridge(toolDefs, (call) => { calls.push(call); });
    const tmp = await import('node:os').then(os => os.tmpdir());
    // 本地优先（lumina 同款 fallback 链）：直调 lock 死的 codex-acp，不走 bunx @latest（抖）。
    const codexAcpEntry = join(dirname(createRequire(import.meta.url).resolve('@agentclientprotocol/codex-acp/package.json')), 'dist', 'index.js');
    const permissionRequests: unknown[] = [];
    const rawUpdates: string[] = [];
    const childLog: string[] = [];
    const adapter = new AcpAdapter({
      debugUpdates: (params) => {
        if (rawUpdates.length < 6) rawUpdates.push(JSON.stringify(params).slice(0, 400));
      },
      debugLog: (level, message) => {
        console.log(`[spike-child:${level}] ${message.slice(0, 300)}`);
        if (childLog.length < 15) childLog.push(`[${level}] ${message.slice(0, 300)}`);
      },
      createClient: (callbacks) => new AcpClient({
        runtime: {
          id: 'codex-acp-local',
          name: 'Codex ACP（本地 pin 版）',
          description: '直调本地 codex-acp，不走 bunx @latest',
          command: process.execPath,
          args: [codexAcpEntry],
          requiredEnvKeys: [],
        },
        workspaceRoot: tmp,
        clientInfo: { name: 'lingua-spike', version: '0.0.0' },
        callbacks: {
          onSessionUpdate: callbacks.onSessionUpdate,
          onLog: callbacks.onLog,
          onStderrLine: callbacks.onStderrLine,
          onPermissionRequest: async (payload) => {
            permissionRequests.push(payload);
            const optionId = pickAllowOptionId((payload.params ?? {}) as Record<string, unknown>);
            return optionId ? { outcome: 'selected' as const, optionId } : { outcome: 'cancelled' as const };
          },
        },
      }),
      buildMcpServers: () => [bridge.mcpServer],
    });
    try {
      const first = await adapter.createSession({ sessionId: 'spike-1', userId: 'spike', tools: toolDefs, model: 'gpt-6-luna', effort: 'medium' });
      if (!first.ok) throw first.error;
      const seen1: string[] = [];
      for await (const event of first.value.send({ message: 'First list all MCP tools you currently have available (names only). Then call the dictionary.lookup tool with {"language":"ja","word":"学校"} and reply DONE.' })) {
        if (event.type === 'TEXT_DELTA') seen1.push(event.delta);
        if (event.type === 'ERROR') { console.log('SPIKE-ROUND1 send error:', event.error.code, event.error.userMessage); throw event.error; }
        if (event.type === 'COMPLETED') break;
      }
      console.log('SPIKE-ROUND1 calls:', JSON.stringify(calls));
      console.log('SPIKE-ROUND1 permissions:', JSON.stringify(permissionRequests).slice(0, 800));
      console.log('SPIKE-ROUND1 text:', seen1.join('').slice(0, 500));
      console.log('SPIKE-RAW-UPDATES:', JSON.stringify(rawUpdates).slice(0, 2000));
      console.log('SPIKE-CHILD-LOG:', JSON.stringify(childLog).slice(0, 2000));
      expect(calls.some(call => call.tool === 'dictionary.lookup')).toBe(true);
      const threadId = first.value.threadId;
      expect(typeof threadId === 'string' && threadId.length > 0).toBe(true);

      const second = await adapter.createSession({
        sessionId: 'spike-2', userId: 'spike', tools: toolDefs,
        ...(threadId ? { resumeThreadId: threadId } : {}),
      });
      if (!second.ok) throw second.error;
      for await (const event of second.value.send({ message: 'Call the flashcards.due tool with {"userId":"spike","language":"ja"} then reply DONE in one sentence.' })) {
        if (event.type === 'ERROR') throw event.error;
        if (event.type === 'COMPLETED') break;
      }
      expect(calls.some(call => call.tool === 'flashcards.due')).toBe(true);
      expect(seen1.join('').length).toBeGreaterThan(0);
    } finally {
      await bridge.close();
      repo.getRawDb().close();
    }
  }, 600_000);
});
