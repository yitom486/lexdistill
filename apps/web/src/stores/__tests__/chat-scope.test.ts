import { beforeEach, expect, it } from 'bun:test';
import { coachScopeOf, usePreferencesStore } from '../usePreferencesStore.js';

/** 旧版全局字段（升级前的单会话状态）。 */
const LEGACY = {
  agentRuntimeId: 'codex-acp',
  coachThreadId: 'legacy-thread',
  coachModelId: 'legacy-model',
  coachEffort: 'low',
  coachApprovalPolicy: 'on-request',
  coachCollaborationMode: '',
  coachPersistThread: true,
};

beforeEach(() => {
  usePreferencesStore.setState({ ...LEGACY, coachScopes: {} });
});

it('未建过的语言沿用旧版全局字段（升级兼容，不凭空丢会话）', () => {
  const scope = coachScopeOf(usePreferencesStore.getState(), 'ja');
  expect(scope.threadId).toBe('legacy-thread');
  expect(scope.modelId).toBe('legacy-model');
  expect(scope.runtimeId).toBe('codex-acp');
});

it('每种语言的会话与运行时互不影响', () => {
  const store = usePreferencesStore.getState();
  store.setCoachScope('ja', { threadId: 'ja-thread', runtimeId: 'claude' });
  store.setCoachScope('en', { threadId: 'en-thread', runtimeId: 'opencode' });

  const state = usePreferencesStore.getState();
  expect(coachScopeOf(state, 'ja').threadId).toBe('ja-thread');
  expect(coachScopeOf(state, 'en').threadId).toBe('en-thread');
  expect(coachScopeOf(state, 'ja').runtimeId).toBe('claude');
  expect(coachScopeOf(state, 'en').runtimeId).toBe('opencode');
  // 第三种语言还没建过：仍回落到全局字段，不会串用 ja/en 的会话
  expect(coachScopeOf(state, 'ko').threadId).toBe('legacy-thread');
});

it('setCoachScope 只改指定语言，其他字段保持', () => {
  const store = usePreferencesStore.getState();
  store.setCoachScope('ja', { threadId: 'ja-thread', effort: 'high' });
  store.setCoachScope('ja', { threadId: 'ja-thread-2' });
  const scope = coachScopeOf(usePreferencesStore.getState(), 'ja');
  expect(scope.threadId).toBe('ja-thread-2');
  expect(scope.effort).toBe('high');
});

it('ensureCoachScope 幂等：固化之后不再跟随全局字段变化', () => {
  const store = usePreferencesStore.getState();
  store.ensureCoachScope('ko');
  store.ensureCoachScope('ko');
  expect(coachScopeOf(usePreferencesStore.getState(), 'ko').threadId).toBe('legacy-thread');

  usePreferencesStore.setState({ coachThreadId: 'changed-globally' });
  expect(coachScopeOf(usePreferencesStore.getState(), 'ko').threadId).toBe('legacy-thread');
});
