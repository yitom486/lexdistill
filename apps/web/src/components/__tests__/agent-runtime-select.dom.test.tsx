import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentRuntimeSelect } from '../AgentRuntimeSelect.js';
import { WordChatConfig } from '../WordChatConfig.js';
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

it('运行时目录与默认：8 运行时候选，缺席回落 ChatGPT', () => {
  expect(DEFAULT_AGENT_RUNTIME_ID).toBe('codex-acp');
  expect(AGENT_RUNTIME_OPTIONS.map(option => option.id)).toEqual(
    ['codex-acp', 'claude', 'gemini', 'copilot', 'opencode', 'cursor-cli', 'deepseek', 'agy']);
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

it('非 Codex 运行时：模型与思考深度禁用（能力开关驱动）', async () => {
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
