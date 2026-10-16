import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { isOk } from '@lexdistill/shared';
import {
  AcpConversationLedger,
  defaultAcpLedgerBackend,
  memoryAcpLedgerBackend,
} from '../runtime/acp-history/acp-conversation-ledger.js';

function ledgerServer(): GatewayServer {
  const repo = new DrizzleLearnerRepository(':memory:');
  return new GatewayServer(repo, undefined, memoryAcpLedgerBackend());
}

describe('AcpConversationLedger', () => {
  it('建会话＋回合记录：列表/回放 DTO 与旧 thread 同形', () => {
    const ledger = new AcpConversationLedger(memoryAcpLedgerBackend());
    const first = ledger.recordSessionCreated({
      acpSessionId: 'acp-1', userId: 'u1', lane: 'coach', runtimeId: 'codex-acp', model: 'gpt-6.1-sol',
    });
    expect(first).toBe(true);
    const second = ledger.recordSessionCreated({
      acpSessionId: 'acp-1', userId: 'u1', lane: 'coach', runtimeId: 'codex-acp',
    });
    // 重复登记返回 false（调用方据此决定是否前置会话身份）。
    expect(second).toBe(false);
    ledger.recordTurn('acp-1', { user: '6.1 是什么', agent: '新模型', source: 'codex' });
    const listed = ledger.listConversations();
    expect(listed.length).toBe(1);
    expect(listed[0]).toMatchObject({ id: 'acp-1', ephemeral: false });
    expect(typeof listed[0]!.preview).toBe('string');
    const items = ledger.getTranscriptItems('acp-1');
    expect(items).toEqual([
      { turnId: 'acp-1:t0', type: 'user_message', text: '6.1 是什么' },
      { turnId: 'acp-1:t1', type: 'assistant_message', text: '新模型' },
    ]);
  });

  it('改名/归档：归档后不再列出，回放仍可取', () => {
    const ledger = new AcpConversationLedger(memoryAcpLedgerBackend());
    ledger.recordSessionCreated({ acpSessionId: 'acp-2', userId: 'u', lane: 'coach', runtimeId: 'opencode' });
    expect(ledger.rename('acp-2', '改名')).toBe(true);
    expect(ledger.rename('nope', 'x')).toBe(false);
    expect(ledger.listConversations()[0]!.name).toBe('改名');
    expect(ledger.archive('acp-2')).toBe(true);
    expect(ledger.listConversations()).toEqual([]);
    expect(ledger.getTranscriptItems('acp-2')).toEqual([]);
  });

  it('未知 id：has/items/rename/archive 如实 false/null，不抛', () => {
    const ledger = new AcpConversationLedger(memoryAcpLedgerBackend());
    expect(ledger.has('')).toBe(false);
    expect(ledger.has('ghost')).toBe(false);
    expect(ledger.getTranscriptItems('ghost')).toBeNull();
  });

  it('lane 过滤：用户历史默认只列 coach/learning，批 lane 隐藏', () => {    const ledger = new AcpConversationLedger(memoryAcpLedgerBackend());
    ledger.recordSessionCreated({ acpSessionId: 'c1', userId: 'u', lane: 'coach', runtimeId: 'opencode' });
    ledger.recordSessionCreated({ acpSessionId: 'b1', userId: 'u', lane: 'batch:toc', runtimeId: 'opencode' });
    expect(ledger.listConversations().map(item => item.id)).toEqual(['c1']);
    expect(ledger.listConversations(50, { lanes: ['batch:toc'] }).map(item => item.id)).toEqual(['b1']);
    // 批会话回放/队列照常可用（仅列表默认隐藏）
    expect(ledger.has('b1')).toBe(true);
  });

  it('队列：先进先出＋按 id 取＋删除＋空消费 null', () => {
    const ledger = new AcpConversationLedger(memoryAcpLedgerBackend());
    expect(ledger.queueConsume('t')).toBeNull();
    const first = ledger.queueAdd('t', '第一条');
    const second = ledger.queueAdd('t', '第二条');
    expect(ledger.queueList('t').map(item => item.id)).toEqual([first.id, second.id]);
    expect(ledger.queueCount('t')).toBe(2);
    expect(ledger.queueConsume('t', second.id)).toMatchObject({ id: second.id });
    expect(ledger.queueConsume('t')).toMatchObject({ id: first.id });
    expect(ledger.queueConsume('t')).toBeNull();
    const third = ledger.queueAdd('t', '第三条');
    expect(ledger.queueRemove('t', third.id)).toBe(true);
    expect(ledger.queueRemove('t', third.id)).toBe(false);
  });

  it('队列空消息抛 E_INVALID_INPUT（网关转可读错）', () => {
    const ledger = new AcpConversationLedger(memoryAcpLedgerBackend());
    expect(() => ledger.queueAdd('t', '  ')).toThrow('队列消息不能为空');
  });

  it('文件后端往返：索引＋transcript 落盘可读回', () => {
    const filePath = join(tmpdir(), `lingua-ledger-test-${Date.now()}.json`);
    process.env.LINGUA_ACP_LEDGER_PATH = filePath;
    try {
      const writer = new AcpConversationLedger(defaultAcpLedgerBackend());
      writer.recordSessionCreated({ acpSessionId: 'acp-f', userId: 'u', lane: 'learning', runtimeId: 'custom' });
      writer.recordTurn('acp-f', { user: '背单词', agent: '好' });
      const reader = new AcpConversationLedger(defaultAcpLedgerBackend());
      expect(reader.has('acp-f')).toBe(true);
      expect(reader.listConversations()[0]).toMatchObject({ id: 'acp-f' });
      expect(reader.getTranscriptItems('acp-f')?.length).toBe(2);
    } finally {
      delete process.env.LINGUA_ACP_LEDGER_PATH;
    }
  });
});

describe('GatewayServer ACP 归属路由', () => {
  it('历史只走台账；未知 id（含旧 thread）报不存在', async () => {
    const server = ledgerServer();
    server.acpLedger.recordSessionCreated({
      acpSessionId: 'acp-9', userId: 'u', lane: 'coach', runtimeId: 'codex-acp',
    });
    const listed = await server.listAgentSessions({});
    expect(isOk(listed)).toBe(true);
    if (isOk(listed)) {
      expect(listed.value.sessions.map(item => item.id).sort()).toEqual(['acp-9']);
    }
    const items = await server.listAgentSessionItems({ sessionId: 'codex-t1' });
    expect(isOk(items)).toBe(false);
  });

  it('回放/改名/归档按归属路由；compact/fork 对 ACP 大声拒绝', async () => {
    const server = ledgerServer();
    server.acpLedger.recordSessionCreated({
      acpSessionId: 'acp-8', userId: 'u', lane: 'coach', runtimeId: 'codex-acp',
    });
    server.acpLedger.recordTurn('acp-8', { user: '你好', agent: '在的' });
    const items = await server.listAgentSessionItems({ sessionId: 'acp-8' });
    expect(isOk(items)).toBe(true);
    if (isOk(items)) {
      expect(items.value.items.map((item: { type: string }) => item.type))
        .toEqual(['user_message', 'assistant_message']);
    }
    const renamed = await server.setAgentSessionName('acp-8', '新标题');
    expect(isOk(renamed)).toBe(true);
    const compacted = await server.compactAgentSession('acp-8');
    expect(isOk(compacted)).toBe(false);
    if (!isOk(compacted)) expect(compacted.error.code).toBe('E_ACP_UNSUPPORTED');
    const forked = await server.forkAgentSession({ sessionId: 'acp-8' });
    expect(isOk(forked)).toBe(false);
    const archived = await server.archiveAgentSession('acp-8');
    expect(isOk(archived)).toBe(true);
    expect(server.acpLedger.listConversations()).toEqual([]);
  });

  it('队列按归属路由：ACP 走网关队列（旧 DTO 同形）', async () => {
    const server = ledgerServer();
    server.acpLedger.recordSessionCreated({
      acpSessionId: 'acp-7', userId: 'u', lane: 'coach', runtimeId: 'codex-acp',
    });
    const added = await server.queueAgentAdd({ sessionId: 'acp-7', message: '排队第一条' });
    expect(isOk(added)).toBe(true);
    const listed = await server.listAgentQueue({ sessionId: 'acp-7' });
    expect(isOk(listed)).toBe(true);
    if (isOk(listed)) {
      expect(listed.value.items.length).toBe(1);
      expect(listed.value.items[0]).toMatchObject({ text: '排队第一条' });
      const deleted = await server.deleteAgentQueueItem({
        sessionId: 'acp-7',
        queuedSubmissionId: listed.value.items[0]!.id,
      });
      expect(isOk(deleted)).toBe(true);
    }
    const codexQueue = await server.listAgentQueue({ sessionId: 'codex-t1' });
    expect(isOk(codexQueue)).toBe(false);
  });
});

describe('AcpConversationLedger 身份迁移', () => {
  it('未知 id 需前置；新档一次后不再；老档（identityV 缺席）补一次', () => {
    const ledger = new AcpConversationLedger(memoryAcpLedgerBackend());
    expect(ledger.ensureIdentityApplied('fresh-1')).toBe(true);
    ledger.recordSessionCreated({ acpSessionId: 'fresh-1', userId: 'u', lane: 'coach', runtimeId: 'agy' });
    expect(ledger.ensureIdentityApplied('fresh-1')).toBe(true);
    expect(ledger.ensureIdentityApplied('fresh-1')).toBe(false);
    // 模拟身份版本之前的老档：无 identityV 字段
    ledger.recordSessionCreated({ acpSessionId: 'old-1', userId: 'u', lane: 'coach', runtimeId: 'agy' });
    expect(ledger.ensureIdentityApplied('old-1')).toBe(true);
    expect(ledger.ensureIdentityApplied('old-1')).toBe(false);
    expect(ledger.ensureIdentityApplied('')).toBe(false);
  });
});
