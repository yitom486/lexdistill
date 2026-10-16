import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { ok, err, BusinessError } from '@lexdistill/shared';
import { SessionToolBridge } from '../runtime/mcp/session-tool-bridge.js';
import {
  ACP_BATCH_LANE_PREFIX,
  batchLane,
  buildAcpBatchFirstMessage,
  isBatchLane,
} from '../runtime/acp-batch/acp-batch-support.js';

async function rpc(bridge: SessionToolBridge, token: string, method: string, params: unknown, sessionId?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await bridge.handleRequest(token, new Request('http://127.0.0.1/mcp', {
    method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  const text = await res.text();
  const payload = text.startsWith('event:') && text.includes('data: ')
    ? JSON.parse(text.split('data: ')[1]!.split('\n')[0]!)
    : JSON.parse(text || '{}');
  return { res, payload, sessionId: res.headers.get('mcp-session-id') ?? sessionId };
}

describe('ACP 批支撑原语', () => {
  it('lane 命名：batch: 前缀识别；空名回落 job', () => {
    expect(batchLane('toc')).toBe('batch:toc');
    expect(batchLane('  ')).toBe('batch:job');
    expect(isBatchLane('batch:toc')).toBe(true);
    expect(isBatchLane('coach')).toBe(false);
    expect(ACP_BATCH_LANE_PREFIX).toBe('batch:');
  });

  it('首消息组装：systemPrompt 前置，空则原样', () => {
    expect(buildAcpBatchFirstMessage('读 PDF 提目录', '开始')).toBe('读 PDF 提目录\n\n开始');
    expect(buildAcpBatchFirstMessage('  ', '开始')).toBe('开始');
  });
});

describe('SessionToolBridge 调用记录（批收割）', () => {
  const echoTool = {
    name: 't.echo',
    description: 'echo',
    schema: z.object({ text: z.string() }),
  } as never;
  const failTool = {
    name: 't.fail',
    description: 'fail',
    schema: z.object({}),
  } as never;

  it('成功/失败调用均记录参数与结果；take 清空；revoke 连带清', async () => {
    const bridge = new SessionToolBridge({
      execute: async (toolName) => toolName === 't.echo'
        ? ok({ echo: 'hi' })
        : err(new BusinessError('E_NO_TOOL', '无此工具', 'VALIDATION')),
      resolveBaseUrl: () => 'http://127.0.0.1:9',
    });
    const created = bridge.create('u1', 'sess-1', [echoTool, failTool]);
    const init = await rpc(bridge, created.token, 'initialize',
      { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    await rpc(bridge, created.token, 'tools/call',
      { name: 't.echo', arguments: { text: 'hi' } }, init.sessionId);
    await rpc(bridge, created.token, 'tools/call',
      { name: 't.fail', arguments: {} }, init.sessionId);
    const peeked = bridge.peekRecords(created.token);
    expect(peeked.length).toBe(2);
    expect(peeked[0]).toMatchObject({ toolName: 't.echo', ok: true });
    expect(JSON.stringify(peeked[0])).toContain('hi');
    expect(peeked[1]).toMatchObject({ toolName: 't.fail', ok: false });
    // take 清空并返回
    expect(bridge.takeRecords(created.token).length).toBe(2);
    expect(bridge.peekRecords(created.token)).toEqual([]);
    // 未知 token 空收割，不抛
    expect(bridge.takeRecords('st-nope')).toEqual([]);
    // revoke 连带清记录
    await rpc(bridge, created.token, 'tools/call',
      { name: 't.echo', arguments: { text: 'x' } }, init.sessionId);
    expect(bridge.peekRecords(created.token).length).toBe(1);
    expect(bridge.revoke(created.token)).toBe(true);
    expect(bridge.peekRecords(created.token)).toEqual([]);
  });
});
