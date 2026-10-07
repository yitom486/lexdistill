import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { AgentRuntimeSelect } from '../AgentRuntimeSelect.js';
import { AGENT_RUNTIME_OPTIONS, agentRuntimeLabel, DEFAULT_AGENT_RUNTIME_ID } from '../../config/agent-runtimes.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;
afterEach(() => {
  dom?.teardown(); dom = undefined;
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
  await act(async () => dom!.root.render(<AgentRuntimeSelect />));
  expect(doc.querySelector('[aria-label="选择 Agent 运行时"]')?.textContent).toContain('ChatGPT');
  act(() => { usePreferencesStore.getState().setAgentRuntimeId('deepseek'); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(doc.querySelector('[aria-label="选择 Agent 运行时"]')?.textContent).toContain('DeepSeek');
  expect(usePreferencesStore.getState().agentRuntimeId).toBe('deepseek');
});
