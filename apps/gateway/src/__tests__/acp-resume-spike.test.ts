import { afterEach, describe, expect, it } from 'bun:test';
import { AcpClient, pickAllowOptionId } from '@yitom/acp-client';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { DictionaryLookupTool } from '../modules/dictionary/tools/dictionary-lookup-tool.js';
import { FlashcardsDueTool } from '../modules/flashcards/tools/flashcards-due-tool.js';
import { AcpAdapter } from '../../../../packages/agent-runtime/src/adapters/acp/acp-adapter.js';
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
    const adapter = new AcpAdapter({
      createClient: (callbacks) => new AcpClient({
        runtime: 'codex-acp',
        workspaceRoot: tmp,
        clientInfo: { name: 'lingua-spike', version: '0.0.0' },
        callbacks: {
          onSessionUpdate: callbacks.onSessionUpdate,
          onPermissionRequest: async ({ params }) => {
            const optionId = pickAllowOptionId((params ?? {}) as Record<string, unknown>);
            return optionId ? { outcome: 'selected' as const, optionId } : { outcome: 'cancelled' as const };
          },
        },
      }),
      buildMcpServers: () => [bridge.mcpServer],
    });
    try {
      const first = await adapter.createSession({ sessionId: 'spike-1', userId: 'spike', tools: toolDefs });
      if (!first.ok) throw first.error;
      const seen1: string[] = [];
      for await (const event of first.value.send({ message: 'Call the dictionary.lookup tool with {"language":"ja","word":"学校"} then reply DONE in one sentence.' })) {
        if (event.type === 'TEXT_DELTA') seen1.push(event.delta);
        if (event.type === 'ERROR') throw event.error;
        if (event.type === 'COMPLETED') break;
      }
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
