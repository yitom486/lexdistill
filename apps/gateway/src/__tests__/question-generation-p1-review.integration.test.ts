import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initSchema, SqliteQuestionGenerationRepository } from '@study-studio/storage-sqlite';
import { BusinessError, ok, err, type Result } from '@study-studio/shared';
import { ToolRegistry } from '@study-studio/tool-core';
import type { AgentAdapter, AgentEvent, AgentInput, AgentSession, CreateSessionOptions } from '@study-studio/agent-runtime';
import type { ExternalToolExecutor } from '@study-studio/agent-runtime';
import type { BankPaperReceipt, BankSubmitReceipt } from '@study-studio/protocol';
import { GENERATION_TOOL_NAMES, createQuestionGenerationTools } from '../modules/question-generation/public.js';
import { GenerationTaskService } from '../modules/question-generation/service.js';
import { GenerationRunManager } from '../modules/question-generation/run-manager.js';
import { runGenerationTask } from '../modules/question-generation/runner.js';
import { createGenerationRoutes } from '../modules/question-generation/http/generation-routes.js';
import type { GatewayDeps } from '../composition/gateway-deps.js';
import { binding, config, listening, question } from './question-generation.fixtures.js';

type Script = (call: ExternalToolExecutor, ctx: { sessionId: string; userId: string }, message: string, signal: AbortSignal) => Promise<string>;

interface AcpSeen {
  options?: CreateSessionOptions;
  message?: string;
}

class FakeSession implements AgentSession {
  readonly threadId = 'fake-acp-thread';
  readonly toolSpecs: Array<{ name: string; businessName: string; description: string; inputSchema: Record<string, unknown> }> = [];
  private readonly abort = new AbortController();
  approvals: Array<{ approvalId: string; decision: unknown }> = [];
  interrupts = 0;
  constructor(readonly sessionId: string, readonly userId: string,
    private readonly call: ExternalToolExecutor, private readonly script: Script,
    readonly seen: AcpSeen) {}
  async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    this.seen.message = input.message;
    try {
      const out = await this.script(this.call, { sessionId: this.sessionId, userId: this.userId }, input.message, this.abort.signal);
      yield { type: 'COMPLETED', finalOutput: out };
    } catch (raw) {
      yield { type: 'ERROR', error: raw instanceof BusinessError ? raw : new BusinessError('E_GENERATION_FAILED', '受控模型失败', 'TOOL_EXECUTION') };
    }
  }
  async submitToolResult(): Promise<Result<void, BusinessError>> { return ok(undefined); }
  async submitApproval(approvalId: string, decision: boolean | 'accept' | 'acceptForSession' | 'decline' | 'cancel'): Promise<Result<void, BusinessError>> {
    this.approvals.push({ approvalId, decision });
    return ok(undefined);
  }
  async steer(): Promise<Result<void, BusinessError>> { return ok(undefined); }
  async interrupt(): Promise<Result<void, BusinessError>> { this.interrupts++; this.abort.abort(); return ok(undefined); }
  async close(): Promise<Result<void, BusinessError>> { this.abort.abort(); return ok(undefined); }
}

class FakeAdapter implements AgentAdapter {
  readonly id = 'fake-acp-generation';
  readonly name = 'Fake Acp Generation Adapter';
  sessions: FakeSession[] = [];
  constructor(private readonly toolRegistry: ToolRegistry, private readonly script: Script,
    private readonly seen: AcpSeen) {}
  async createSession(options: CreateSessionOptions): Promise<Result<AgentSession, BusinessError>> {
    this.seen.options = options;
    const clones = (options.tools ?? []).map(tool => tool.name);
    const byOriginal = (name: string): string => {
      const found = clones.find(n => n === name || n.startsWith(`${name}.`));
      if (!found) throw new Error(`clone missing for ${name}`);
      return found;
    };
    const registry = this.toolRegistry;
    const call: ExternalToolExecutor = async (name, args, ctx) => {
      const res = await registry.execute(byOriginal(name), args, { userId: ctx.userId, sessionId: 'gateway-session' });
      if (!res.ok) throw res.error;
      return res.value;
    };
    const session = new FakeSession(options.sessionId, options.userId, call, this.script, this.seen);
    this.sessions.push(session);
    return ok(session);
  }
  async resumeSession(): Promise<Result<AgentSession, BusinessError>> {
    return err(new BusinessError('E_NOT_FOUND', 'no resume', 'VALIDATION'));
  }
}

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys=ON');
  initSchema(sqlite);
  const repository = new SqliteQuestionGenerationRepository(sqlite);
  const service = new GenerationTaskService({ repository });
  const renderer = { async render() { return { bytes: new Uint8Array([9, 9]), mimeType: 'audio/wav' }; } };
  return { sqlite, repository, service, renderer };
}

function acpHarness(script: Script, seen: AcpSeen): { adapter: AgentAdapter; toolRegistry: ToolRegistry } {
  const toolRegistry = new ToolRegistry();
  return { adapter: new FakeAdapter(toolRegistry, script, seen), toolRegistry };
}

function acpRunRequest(harness: { adapter: AgentAdapter; toolRegistry: ToolRegistry }, userId: string, taskId: string) {
  return { userId, taskId, acp: { adapter: harness.adapter, toolRegistry: harness.toolRegistry } };
}

async function happyPaperId(s: ReturnType<typeof setup>, taskId: string): Promise<string> {
  const script: Script = async (call, ctx) => {
    const saved = await call('generation.submit', { requestKey: 'b', questions: [question(), listening()] }, { sessionId: ctx.sessionId, userId: ctx.userId }) as BankSubmitReceipt;
    await call('generation.audio', { materialId: saved.materialIds[1]! }, { sessionId: ctx.sessionId, userId: ctx.userId });
    const paper = await call('generation.paper', { requestKey: 'p', title: 'T', questionIds: saved.questionIds }, { sessionId: ctx.sessionId, userId: ctx.userId }) as BankPaperReceipt;
    return paper.paperId;
  };
  const result = await runGenerationTask(s.service, s.repository, s.renderer,
    acpRunRequest(acpHarness(script, {}), binding.userId, taskId));
  return result.paperId;
}

describe('P1 review regressions', () => {
  it('学生读口永不返回完整答案：任何 stage 参数都不能切换到宿主视图', async () => {
    const s = setup();
    try {
      const task = s.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId, config });
      const paperId = await happyPaperId(s, task.taskId);
      const app = createGenerationRoutes({ generation: { service: s.service } } as unknown as GatewayDeps);
      for (const query of ['', '?stage=host', '?stage=anything', '?transcript=1', '?stage=host&transcript=1']) {
        const res = await app.request(`/api/generation/tasks/${binding.userId}/${task.taskId}/papers/${paperId}${query}`);
        expect(res.status).toBe(200);
        const body = JSON.stringify(await res.json());
        expect(body).not.toContain('correctKey');
        expect(body).not.toContain('acceptedAnswers');
        expect(body).not.toContain('referenceAnswer');
        expect(body).not.toContain('Good morning.');
      }
      // 越权用户读试卷同样拒绝。
      const forbidden = await app.request(`/api/generation/tasks/other/${task.taskId}/papers/${paperId}?stage=host`);
      expect(forbidden.status).not.toBe(200);
    } finally { s.sqlite.close(); }
  });

  it('会话隔离使用最严档：按次克隆、审批 never、冻结模型、无工作目录', async () => {
    const s = setup();
    try {
      const task = s.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId, config });
      const seen: AcpSeen = {};
      const script: Script = async (call, ctx) => {
        const saved = await call('generation.submit', { requestKey: 'b', questions: [question()] }, { sessionId: ctx.sessionId, userId: ctx.userId }) as BankSubmitReceipt;
        await call('generation.paper', { requestKey: 'p', title: 'T', questionIds: saved.questionIds }, { sessionId: ctx.sessionId, userId: ctx.userId });
        return 'done';
      };
      await runGenerationTask(s.service, s.repository, s.renderer,
        acpRunRequest(acpHarness(script, seen), binding.userId, task.taskId));
      const mounted = (seen.options?.tools ?? []).map(tool => tool.name);
      expect(mounted).toHaveLength(6);
      for (const original of [...GENERATION_TOOL_NAMES]) {
        expect(mounted.filter(name => name.startsWith(`${original}.`))).toHaveLength(1);
      }
      expect(seen.options).not.toHaveProperty('sandboxMode');
      // 自有预授权工具直行（never）；引擎原生动作无 ACP 沙箱对应。
      expect(seen.options?.approvalPolicy).toBe('never');
      expect(seen.options?.ephemeral).toBe(true);
      // 冻结模型来自任务配置，调用方无法覆盖。
      expect(seen.options?.model).toBe(config.modelId);
      expect((seen.options as unknown as Record<string, unknown>)?.['workingDirectory']).toBeUndefined();
    } finally { s.sqlite.close(); }
  });

  it('审批请求一律被拒绝，不挂起等待用户', async () => {
    const s = setup();
    try {
      const task = s.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId, config });
      const declines: Array<{ approvalId: string; decision: unknown }> = [];
      const approvalSession: AgentSession = {
        sessionId: `gen:${task.taskId}`,
        toolSpecs: [],
        async *send(): AsyncIterable<AgentEvent> {
          yield { type: 'APPROVAL_REQUESTED', approvalId: 'appr1', action: 'exec', description: 'run rm -rf', riskLevel: 'high' };
          yield { type: 'COMPLETED', finalOutput: 'no paper' };
        },
        async submitToolResult() { return ok(undefined); },
        async submitApproval(approvalId: string, decision: boolean | 'accept' | 'acceptForSession' | 'decline' | 'cancel') {
          declines.push({ approvalId, decision });
          return ok(undefined);
        },
        async steer() { return ok(undefined); },
        async interrupt() { return ok(undefined); },
        async close() { return ok(undefined); },
      };
      const approvalAdapter: AgentAdapter = {
        id: 'approval-probe', name: 'approval-probe',
        async createSession() { return ok(approvalSession); },
        async resumeSession() { return err(new BusinessError('E_X', 'x', 'VALIDATION')); },
      };
      const toolRegistry = new ToolRegistry();
      await expect(runGenerationTask(s.service, s.repository, s.renderer, {
        userId: binding.userId, taskId: task.taskId,
        acp: { adapter: approvalAdapter, toolRegistry },
      })).rejects.toThrow();
      // 高风险审批被直接拒绝，且任务因无资产而不成功。
      expect(declines).toEqual([{ approvalId: 'appr1', decision: 'decline' }]);
      expect(s.service.queryTask(binding.userId, task.taskId).status).toBe('CANCELLED');
    } finally { s.sqlite.close(); }
  });

  it('取消直达听力服务：渲染器收到中止且无音频落库', async () => {
    const s = setup();
    try {
      const task = s.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId, config });
      let rendererAborted = false;
      const slowAudio = { async render({ signal }: { signal: AbortSignal }) {
        await new Promise((_res, rej) => {
          if (signal.aborted) { rendererAborted = true; rej(signal.reason); return; }
          signal.addEventListener('abort', () => { rendererAborted = true; rej(signal.reason); }, { once: true });
        });
        return { bytes: new Uint8Array([1]), mimeType: 'audio/wav' };
      } };
      const script: Script = async (call, ctx) => {
        const saved = await call('generation.submit', { requestKey: 'b', questions: [listening()] }, { sessionId: ctx.sessionId, userId: ctx.userId }) as BankSubmitReceipt;
        await call('generation.audio', { materialId: saved.materialIds[0]! }, { sessionId: ctx.sessionId, userId: ctx.userId });
        return 'never';
      };
      let settled: string | undefined;
      const running = runGenerationTask(s.service, s.repository, slowAudio,
        acpRunRequest(acpHarness(script, {}), binding.userId, task.taskId),
      ).then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });
      await new Promise(r => setTimeout(r, 100));
      await s.service.cancelTask(binding.userId, task.taskId);
      await running;
      expect(settled).toBe('rejected');
      expect(rendererAborted).toBe(true);
      expect(s.service.queryTask(binding.userId, task.taskId).status).toBe('CANCELLED');
      expect(s.service.queryTask(binding.userId, task.taskId).usage.usedAudio).toBe(0);
      expect(s.sqlite.query("SELECT count(*) AS n FROM bank_audio_assets WHERE task_id=?").get(task.taskId)).toEqual({ n: 0 });
    } finally { s.sqlite.close(); }
  });

  it('后台调度真实调用运行器：启动、运行态、完成态与并发拒绝', async () => {
    const s = setup();
    try {
      const task = s.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId, config });
      const script: Script = async (call, ctx) => {
        await new Promise(r => setTimeout(r, 150));
        const saved = await call('generation.submit', { requestKey: 'b', questions: [question()] }, { sessionId: ctx.sessionId, userId: ctx.userId }) as BankSubmitReceipt;
        await call('generation.paper', { requestKey: 'p', title: 'T', questionIds: saved.questionIds }, { sessionId: ctx.sessionId, userId: ctx.userId });
        return 'done';
      };
      const toolRegistry = new ToolRegistry();
      const runs = new GenerationRunManager({ service: s.service, repository: s.repository,
        resolveRunAdapter: () => ({ adapter: new FakeAdapter(toolRegistry, script, {}), acp: true }),
        toolRegistry });
      expect(await runs.start(binding.userId, task.taskId)).toEqual({ started: true });
      expect(runs.runState(binding.userId, task.taskId).running).toBe(true);
      expect(await runs.start(binding.userId, task.taskId)).toEqual({ started: false, reason: 'RUNNING' });
      for (let i = 0; i < 100 && runs.runState(binding.userId, task.taskId).running; i++) await new Promise(r => setTimeout(r, 50));
      const state = runs.runState(binding.userId, task.taskId);
      expect(state.running).toBe(false);
      expect(state.last).toMatchObject({ status: 'COMPLETED' });
      expect(await runs.start(binding.userId, task.taskId)).toEqual({ started: false, reason: 'CLOSED' });
      // HTTP 层同样走后台调度。
      const app = createGenerationRoutes({ generation: { service: s.service, runs } } as unknown as GatewayDeps);
      const foreign = await app.request(`/api/generation/tasks/other/${task.taskId}/run`, { method: 'POST' });
      expect(foreign.status).not.toBe(202);
    } finally { s.sqlite.close(); }
  });

  it('运行预算覆盖会话建立：1 秒预算下 1.3 秒建连仍失败', async () => {
    const s = setup();
    try {
      const task = s.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId,
        config, runLimits: { maxModelRounds: 20, maxRepairAttempts: 5, maxDurationMs: 1000 } });
      const script: Script = async () => 'too late';
      const toolRegistry = new ToolRegistry();
      const inner = new FakeAdapter(toolRegistry, script, {});
      const orig = inner.createSession.bind(inner);
      const slow = {
        id: 'slow', name: 'slow',
        async createSession(options: CreateSessionOptions) {
          await new Promise(r => setTimeout(r, 1300));
          return orig(options);
        },
        async resumeSession() { return err(new BusinessError('E_X', 'x', 'VALIDATION')); },
      } satisfies AgentAdapter;
      await expect(runGenerationTask(s.service, s.repository, s.renderer, {
        userId: binding.userId, taskId: task.taskId,
        acp: { adapter: slow, toolRegistry },
      })).rejects.toThrow();
      expect(s.service.queryTask(binding.userId, task.taskId).status).toBe('CANCELLED');
    } finally { s.sqlite.close(); }
  });

  it('轮次耗尽即终止模型：保留配额错误且中断会话', async () => {
    const s = setup();
    try {
      const task = s.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId,
        config, runLimits: { maxModelRounds: 3, maxRepairAttempts: 5, maxDurationMs: 120000 } });
      let attempts = 0;
      let admissions = 0;
      const toolRegistry = new ToolRegistry();
      const adapter = new FakeAdapter(toolRegistry, async (call, ctx, message, signal) => {        const countingCall: ExternalToolExecutor = async (name, input, c) => {
          attempts++;
          const value = await call(name, input, c);
          admissions++;
          return value;
        };
        for (let i = 0; i < 10; i++) {
          try { await countingCall('generation.config', {}, { sessionId: ctx.sessionId, userId: ctx.userId }); }
          catch { /* 超限后继续尝试应同样被拒绝 */ }
        }
        return 'done';
      }, {});
      const error = await runGenerationTask(s.service, s.repository, s.renderer, {
        userId: binding.userId, taskId: task.taskId,
        acp: { adapter, toolRegistry },
      }).then(() => null, e => e as BusinessError);
      expect(error?.code).toBe('E_GENERATION_QUOTA');
      expect((adapter.sessions[0]?.interrupts ?? 0)).toBeGreaterThan(0);
      // 仅前 3 次调用被接纳执行，其余 7 次在预算耗尽后被拒绝，模型会话随即中断。
      expect(attempts).toBe(10);
      expect(admissions).toBe(3);
      expect(s.service.queryTask(binding.userId, task.taskId).status).toBe('CANCELLED');
    } finally { s.sqlite.close(); }
  });

  it('蓝图与预算进入模型视野：动态提示词与配置工具均携带', async () => {
    const s = setup();
    try {
      const task = s.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId,
        config, blueprint: { totalItems: 2, categoryCounts: { GRAMMAR: 1, LISTENING: 1 } as never } });
      const snapshot = s.repository.describeTask(binding.userId, task.taskId);
      const tools = createQuestionGenerationTools({ repository: s.repository, audio: s.renderer },
        snapshot.binding, snapshot.config, snapshot.expiresAt,
        { blueprint: snapshot.blueprint, runLimits: snapshot.runLimits });
      try {
        expect(tools.dynamicPrompt()).toContain('totalItems=2');
        expect(tools.dynamicPrompt()).toContain('GRAMMAR=1');
        const res = await tools.registry.execute('generation.config', {}, snapshot.binding);
        expect(JSON.stringify(res)).toContain('totalItems');
        expect(JSON.stringify(res)).toContain('maxModelRounds');
      } finally { await tools.dispose(); }
    } finally { s.sqlite.close(); }
  });
});
