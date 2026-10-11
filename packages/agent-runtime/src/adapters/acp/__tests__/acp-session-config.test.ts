import { describe, expect, it } from 'bun:test';
import { AcpAdapter, AcpAgentSession, promptImagesFromAttachments, resolveAgentFirstMessage } from '../acp-adapter.js';
import type { AcpClientLike, AcpSessionHandleLike } from '../acp-adapter.js';

function trackHandle(configOptions: unknown, failIds: string[] = []): AcpSessionHandleLike & { calls: Array<{ id: string; value: string | boolean }> } {
  const calls: Array<{ id: string; value: string | boolean }> = [];
  return {
    sessionId: 'acp-sess-cfg',
    configOptions,
    prompt: async () => ({ ok: true as const, value: 'DONE' }),
    setConfigOption: async (id: string, value: string | boolean) => {
      calls.push({ id, value });
      if (failIds.includes(id)) return { ok: false as const, error: { code: 'E_UNKNOWN_OPTION', message: `unknown config option: ${id}` } };
      return { ok: true as const, value: 'ok' };
    },
    calls,
  };
}

function makeAdapter(handle: AcpSessionHandleLike, describeConfigIds?: (configOptions: unknown) => { model: string | null; effort: string | null }, resolveThinkingModelId?: (configOptions: unknown, effort: string, modelHint?: string) => { configId: string; value: string } | null): AcpAdapter {
  const client: AcpClientLike = {
    connect: async () => ({ ok: true as const, value: {} }),
    createSession: async () => ({ ok: true as const, value: handle }),
    disconnect: async () => undefined,
  };
  return new AcpAdapter({
    createClient: () => client,
    buildMcpServers: () => [],
    ...(describeConfigIds ? { describeConfigIds } : {}),
    ...(resolveThinkingModelId ? { resolveThinkingModelId } : {}),
  });
}

const SESSION_OPTS = { sessionId: 's1', userId: 'u1', model: 'm-x', effort: 'high' };

describe('resolveAgentFirstMessage（ACP 首消息前置唯一口径）', () => {
  it('非 ACP 会话原样返回（具原生 systemPrompt 能力的通路走原生通道）', () => {
    const session = { sessionId: 's' } as never;
    expect(resolveAgentFirstMessage(session, '你是批改员', '开始')).toBe('开始');
  });

  it('ACP 会话前置非空身份；空身份不加料', () => {
    const handle = { sessionId: 'a', prompt: async () => ({ ok: true as const, value: '' }) };
    const session = new AcpAgentSession('s', 'acp-1', handle as never, [], undefined, undefined);
    expect(resolveAgentFirstMessage(session, '你是批改员', '开始')).toBe('你是批改员\n\n开始');
    expect(resolveAgentFirstMessage(session, '  ', '开始')).toBe('开始');
  });
});

describe('promptImagesFromAttachments（扫描页 → ACP 图片块）', () => {
  it('PNG 字节转 base64＋image/png；空附件丢弃', () => {
    const images = promptImagesFromAttachments([
      { png: new Uint8Array([137, 80, 78, 71]) },
      { png: new Uint8Array(0) },
    ]);
    expect(images).toEqual([
      { data: Buffer.from([137, 80, 78, 71]).toString('base64'), mimeType: 'image/png' },
    ]);
  });

  it('缺席/空数组回空（纯文字轮不带图片块）', () => {
    expect(promptImagesFromAttachments(undefined)).toEqual([]);
    expect(promptImagesFromAttachments([])).toEqual([]);
  });
});

describe('AcpAdapter 建会话 configId 发现＋偏好降级', () => {
  it('用发现的真实 id 设置（连字符方言），成功无警告', async () => {
    const handle = trackHandle([{ configId: 'reasoning-effort', options: [{ value: 'high' }] }]);
    const adapter = makeAdapter(handle, () => ({ model: 'model', effort: 'reasoning-effort' }));
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    expect(handle.calls).toEqual([
      { id: 'model', value: 'm-x' },
      { id: 'reasoning-effort', value: 'high' },
    ]);
    if (res.ok) {
      expect((res.value as AcpAgentSession).drainSetupWarnings()).toEqual([]);
    }
    await adapter.shutdown('test');
  });

  it('无 effort 选项：跳过设置＋警告，会话照常建成（OpenCode 案）', async () => {
    const handle = trackHandle([{ configId: 'model', options: [{ value: 'm-x' }] }]);
    const adapter = makeAdapter(handle, () => ({ model: 'model', effort: null }));
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    expect(handle.calls).toEqual([{ id: 'model', value: 'm-x' }]);
    if (res.ok) {
      const warnings = (res.value as AcpAgentSession).drainSetupWarnings();
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('high');
      expect((res.value as AcpAgentSession).drainSetupWarnings()).toEqual([]);
    }
    await adapter.shutdown('test');
  });

  it('设置被拒：降级警告，会话照常建成（不炸整轮）', async () => {
    const handle = trackHandle([], ['model', 'reasoning_effort']);
    const adapter = makeAdapter(handle);
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const warnings = (res.value as AcpAgentSession).drainSetupWarnings();
      expect(warnings.length).toBe(2);
      expect(warnings.some(w => w.includes('m-x'))).toBe(true);
      expect(warnings.some(w => w.includes('high'))).toBe(true);
    }
    await adapter.shutdown('test');
  });

  it('无注入器：回落 legacy id（model/reasoning_effort，旧单测行为不变）', async () => {
    const handle = trackHandle([]);
    const adapter = makeAdapter(handle);
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    expect(handle.calls).toEqual([
      { id: 'model', value: 'm-x' },
      { id: 'reasoning_effort', value: 'high' },
    ]);
    await adapter.shutdown('test');
  });

  it('变体路：档位改写模型 id，跳过独立设置（如下游同款）', async () => {
    const handle = trackHandle([{ configId: 'model' }]);
    const adapter = makeAdapter(
      handle,
      () => ({ model: 'model', effort: null }),
      () => ({ configId: 'model', value: 'm[reasoning_effort=high]' }),
    );
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    // 模型先行（刷新级联表），再以变体 id 改写（档位编码进模型设置）
    expect(handle.calls).toEqual([
      { id: 'model', value: 'm-x' },
      { id: 'model', value: 'm[reasoning_effort=high]' },
    ]);
    if (res.ok) {
      expect((res.value as AcpAgentSession).drainSetupWarnings()).toEqual([]);
    }
    await adapter.shutdown('test');
  });

  it('变体不可解析：警告跳过，会话照常建成', async () => {
    const handle = trackHandle([{ configId: 'model' }]);
    const adapter = makeAdapter(
      handle,
      () => ({ model: 'model', effort: null }),
      () => null,
    );
    const res = await adapter.createSession({ sessionId: 's1', userId: 'u1', effort: 'high' });
    expect(res.ok).toBe(true);
    expect(handle.calls).toEqual([]);
    if (res.ok) {
      const warnings = (res.value as AcpAgentSession).drainSetupWarnings();
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('high');
    }
    await adapter.shutdown('test');
  });

  it('级联刷新：模型设置回执带出 effort 表，档位随新表直设（OpenCode 案）', async () => {
    const refreshed = [
      { configId: 'model', category: 'model', currentValue: 'm-spark', options: [{ value: 'm-spark' }] },
      { configId: 'effort', category: 'thought_level', options: [{ value: 'minimal' }, { value: 'xhigh' }] },
    ];
    const base = trackHandle([{ configId: 'model', category: 'model', options: [{ value: 'm-spark' }] }]);
    const cascadeCalls = base.calls;
    const originalSet = base.setConfigOption;
    const handle: AcpSessionHandleLike = {
      ...base,
      setConfigOption: async (id: string, value: string | boolean) => {
        const res = await originalSet(id, value);
        if (id === 'model' && res.ok) {
          return { ok: true as const, value: { configOptions: refreshed } };
        }
        return res;
      },
    };
    const adapter = makeAdapter(
      handle,
      (configOptions) => {
        const table = Array.isArray((configOptions as { configOptions?: unknown })?.configOptions)
          ? (configOptions as { configOptions?: unknown }).configOptions
          : configOptions;
        const list = table as Array<{ configId?: string; category?: string }>;
        const effort = Array.isArray(list)
          ? list.find(item => item?.configId === 'effort' || item?.category === 'thought_level')
          : undefined;
        return { model: 'model', effort: effort ? 'effort' : null };
      },
    );
    const res = await adapter.createSession({ sessionId: 's1', userId: 'u1', model: 'm-spark', effort: 'xhigh' });
    expect(res.ok).toBe(true);
    // 模型先行，档位按刷新后表的 effort id 直设
    expect(cascadeCalls).toEqual([
      { id: 'model', value: 'm-spark' },
      { id: 'effort', value: 'xhigh' },
    ]);
    if (res.ok) {
      expect((res.value as AcpAgentSession).drainSetupWarnings()).toEqual([]);
    }
    await adapter.shutdown('test');
  });
});
