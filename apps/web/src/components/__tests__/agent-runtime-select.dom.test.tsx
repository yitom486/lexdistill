import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentRuntimeSelect } from '../AgentRuntimeSelect.js';
import { ChatComposer } from '../agent-chat/ChatComposer.js';
import { WordChatConfig } from '../WordChatConfig.js';
import { useSelectedRuntimeCaps } from '../../hooks/useSelectedRuntimeCaps.js';
import { AGENT_RUNTIME_OPTIONS, agentRuntimeLabel, DEFAULT_AGENT_RUNTIME_ID } from '../../config/agent-runtimes.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => {
  dom?.teardown(); dom = undefined;
  globalThis.fetch = originalFetch;
  usePreferencesStore.setState({ agentRuntimeId: '' });
});

it('运行时目录与默认：9 运行时候选，缺席回落 ChatGPT', () => {
  expect(DEFAULT_AGENT_RUNTIME_ID).toBe('codex-acp');
  expect(AGENT_RUNTIME_OPTIONS.map(option => option.id)).toEqual(
    ['codex-acp', 'claude', 'gemini', 'copilot', 'opencode', 'opencode-v2', 'cursor-cli', 'deepseek', 'agy']);
  expect(agentRuntimeLabel('')).toBe('ChatGPT');
  expect(agentRuntimeLabel('deepseek')).toBe('DeepSeek');
  expect(agentRuntimeLabel('nope')).toBe('ChatGPT');
});

it('下拉默认选中 ChatGPT；切换写偏好', async () => {
  dom = await setupDom(true);
  const doc = dom.dom.window.document;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  globalThis.fetch = (async () => Response.json({ runtimes: [] })) as unknown as typeof fetch;
  await act(async () => dom!.root.render(
    <QueryClientProvider client={client}>
      <AgentRuntimeSelect />
    </QueryClientProvider>,
  ));
  client.clear();
  expect(doc.querySelector('[aria-label="选择 Agent 运行时"]')?.textContent).toContain('ChatGPT');
  act(() => { usePreferencesStore.getState().setAgentRuntimeId('deepseek'); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(doc.querySelector('[aria-label="选择 Agent 运行时"]')?.textContent).toContain('DeepSeek');
  expect(usePreferencesStore.getState().agentRuntimeId).toBe('deepseek');
});

it('非默认运行时：模型与思考深度禁用（能力开关驱动）', async () => {
  const runtimes = [
    { id: 'codex-acp', label: 'ChatGPT', hint: '', configured: true,
      capabilities: { supportsModelPicker: true, supportsEffort: true } },
    { id: 'deepseek', label: 'DeepSeek', hint: '', configured: true,
      capabilities: { supportsModelPicker: false, supportsEffort: false } },
  ];
  globalThis.fetch = (async () => Response.json({ runtimes })) as unknown as typeof fetch;
  usePreferencesStore.setState({ agentRuntimeId: 'deepseek' });
  dom = await setupDom(true);
  const doc = dom.dom.window.document;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => dom!.root.render(
    <QueryClientProvider client={client}><WordChatConfig /></QueryClientProvider>,
  ));
  const toggle = doc.querySelector('[aria-label="单词会话配置"]') as HTMLButtonElement | null;
  expect(toggle).toBeTruthy();
  await act(async () => toggle!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(doc.querySelector('[aria-label="选择模型"]')?.getAttribute('data-disabled')).not.toBeNull();
  client.clear();
});

it('非默认运行时：模型标签显示运行时默认（不残留旧模型名）', async () => {
  globalThis.fetch = (async () => Response.json({ runtimes: [
    { id: 'codex-acp', label: 'ChatGPT', hint: '', configured: true,
      capabilities: { supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false, supportsHistory: true } },
    { id: 'opencode', label: 'OpenCode', hint: '', configured: true,
      capabilities: { supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false, supportsHistory: true } },
  ] })) as unknown as typeof fetch;
  usePreferencesStore.setState({ agentRuntimeId: 'opencode', coachModelId: 'GPT-6-Luna' });
  dom = await setupDom(true);
  const doc = dom.dom.window.document;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => dom!.root.render(
    <QueryClientProvider client={client}><WordChatConfig /></QueryClientProvider>,
  ));
  const toggle = doc.querySelector('[aria-label="单词会话配置"]') as HTMLButtonElement | null;
  await act(async () => toggle!.click());
  for (let i = 0; i < 50; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    if (doc.body.textContent?.includes('运行时默认')) break;
  }
  expect(doc.body.textContent).toContain('运行时默认');
  client.clear();
  usePreferencesStore.setState({ coachModelId: '' });
});

it('能力开关 fail-open：后端未返回时全开（= 现状）', async () => {
  globalThis.fetch = (async () => Response.json({ runtimes: [] })) as unknown as typeof fetch;
  usePreferencesStore.setState({ agentRuntimeId: 'deepseek' });
  dom = await setupDom(true);
  const doc = dom.dom.window.document;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let caps: { supportsModelPicker: boolean; supportsEffort: boolean; supportsThreads: boolean; supportsUsage: boolean; supportsHistory: boolean } | null = null;
  const Probe = () => {
    caps = useSelectedRuntimeCaps();
    return null;
  };
  await act(async () => dom!.root.render(
    <QueryClientProvider client={client}><Probe /><WordChatConfig /></QueryClientProvider>,
  ));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(caps ?? {}).toEqual({
    supportsModelPicker: true, supportsEffort: true, supportsThreads: true, supportsUsage: true, supportsHistory: true,
  });
  client.clear();
});

it('ACP 运行时：下拉显示已选模型名，脚注写历史/队列走台账', async () => {
  globalThis.fetch = (async (url: unknown) => {
    const target = String(url ?? '');
    if (target.includes('/runtimes/opencode/options')) {
      return Response.json({ models: [{ value: 'gpt-6.1-sol', label: '6.1 Sol' }], efforts: ['medium'] });
    }
    return Response.json({ runtimes: [
      { id: 'opencode', label: 'OpenCode', hint: '', configured: true,
        capabilities: { supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false, supportsHistory: true } },
    ] });
  }) as unknown as typeof fetch;
  usePreferencesStore.setState({ agentRuntimeId: 'opencode', coachModelId: 'gpt-6.1-sol', coachEffort: '' });
  dom = await setupDom(true);
  const doc = dom.dom.window.document;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const noop = () => undefined;
  await act(async () => dom!.root.render(
    <QueryClientProvider client={client}>
      <ChatComposer
        input="" setInput={noop} send={noop} busy={false}
        composerSettingsOpen={false} setComposerSettingsOpen={noop} composerSettingsNonDefault={false}
        coachApprovalPolicy="never" setCoachApprovalPolicy={noop}
        coachEffort="" setCoachEffort={noop}
        coachModelId="gpt-6.1-sol" setCoachModelId={noop}
        enqueueQueued={noop} interrupt={noop} queueMessage={{ isPending: false }}
        coachThreadId=""
        runtimeId="opencode"
      />
    </QueryClientProvider>,
  ));
  for (let i = 0; i < 50; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    if (doc.body.textContent?.includes('6.1 Sol')) break;
  }
  // 下拉显示用户真实选择，而非一律“运行时默认”
  expect(doc.body.textContent).toContain('6.1 Sol');
  // 脚注如实：历史与排队需在线，用量暂不可用（R07 去“网关台账”内部术语）
  expect(doc.body.textContent).toContain('历史与排队需在线连接');
  expect(doc.body.textContent).toContain('用量暂不可用');
  client.clear();
  usePreferencesStore.setState({ coachModelId: '', coachEffort: '' });
});
