import { describe, expect, it } from 'bun:test';
import { mapCodexItemToAgentEvent } from '../mapper.js';
import {
  mapAppServerNotificationToEvents,
  CodexAdapter,
  buildLearnerContextEntry,
} from '../index.js';
import {
  loadCodexConfigFromEnv,
  normalizeSandboxMode,
  normalizeApprovalPolicy,
} from '../app-server-protocol.js';
import { isErr } from '@study-studio/shared';

describe('Agent Codex - Mapper & Adapter', () => {
  it('normalizes sandbox and approval kebab-case enums', () => {
    expect(normalizeSandboxMode('readOnly')).toBe('read-only');
    expect(normalizeSandboxMode('workspaceWrite')).toBe('workspace-write');
    expect(normalizeSandboxMode('danger-full-access')).toBe('danger-full-access');
    expect(normalizeApprovalPolicy('onRequest')).toBe('on-request');
    expect(normalizeApprovalPolicy('never')).toBe('never');
  });

  it('maps approval policy never vs on-request intent', () => {
    expect(normalizeApprovalPolicy('Ask for approval')).toBe('Ask for approval');
    expect(normalizeApprovalPolicy('on-request')).toBe('on-request');
  });
  it('should map message_delta correctly', () => {
    const event = mapCodexItemToAgentEvent({
      type: 'message_delta',
      delta: 'おはよう',
    });
    expect(event).toEqual({ type: 'TEXT_DELTA', delta: 'おはよう' });
  });

  it('should map dynamic tool call correctly', () => {
    const event = mapCodexItemToAgentEvent({
      type: 'dynamic_tool_call',
      toolCall: {
        callId: 'c1',
        toolName: 'dictionary.lookup',
        arguments: { word: '猫' },
      },
    });
    expect(event).toEqual({
      type: 'TOOL_CALL_REQUESTED',
      callId: 'c1',
      toolName: 'dictionary.lookup',
      input: { word: '猫' },
    });
  });

  it('should map raw error to friendly BusinessError', () => {
    const event = mapCodexItemToAgentEvent({
      type: 'error',
      error: new Error('connect ECONNREFUSED 127.0.0.1:4000'),
    });
    expect(event?.type).toBe('ERROR');
    if (event && event.type === 'ERROR') {
      expect(event.error.code).toBe('E_NETWORK_DISCONNECTED');
      expect(event.error.userMessage).toContain('无法连接到学习助手服务');
    }
  });

  it('maps App Server agentMessage delta notifications', () => {
    const events = mapAppServerNotificationToEvents('item/agentMessage/delta', {
      delta: 'こんにちは',
    });
    expect(events).toEqual([{ type: 'TEXT_DELTA', delta: 'こんにちは' }]);
  });

  it('builds learner context as additionalContext, not user text', () => {
    const ctx = buildLearnerContextEntry({
      targetLanguage: 'en',
      learnerLevel: 'B2',
    });
    expect(ctx?.kind).toBe('application');
    expect(ctx?.value).toContain('targetLanguage: en');
    expect(ctx?.value).not.toContain('[StudyStudio Context]');
  });

  it('maps App Server reasoning text deltas', () => {
    const events = mapAppServerNotificationToEvents('item/reasoning/summaryTextDelta', {
      delta: 'think…',
    });
    expect(events).toEqual([{ type: 'REASONING_DELTA', delta: 'think…' }]);
  });

  it('maps structured TurnError instead of swallowing it as unknown internal', () => {
    const events = mapAppServerNotificationToEvents('error', {
      threadId: 't1',
      turnId: 'turn_1',
      willRetry: false,
      error: {
        message: 'model stream aborted after retry',
        codexErrorInfo: null,
        additionalDetails: 'upstream reset',
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('ERROR');
    if (events[0]?.type === 'ERROR') {
      expect(events[0].error.code).toBe('E_CODEX_TURN');
      expect(events[0].error.userMessage).toContain('model stream aborted after retry');
      expect(events[0].error.userMessage).toContain('upstream reset');
      expect(events[0].error.userMessage).not.toContain('一点小问题');
      expect(events[0].error.userMessage).not.toContain('[object Object]');
    }
  });

  it('maps Codex retry notifications as nonterminal runtime diagnostics', () => {
    const events = mapAppServerNotificationToEvents('error', {
      threadId: 't1',
      turnId: 'turn_1',
      willRetry: true,
      error: {
        message: 'temporary overload',
        codexErrorInfo: 'serverOverloaded',
        additionalDetails: null,
      },
    });
    expect(events).toEqual([expect.objectContaining({ type: 'RUNTIME_RETRY', code: 'E_CODEX_OVERLOADED' })]);
  });

  it('maps usageLimitExceeded to a specific quota message', () => {
    const events = mapAppServerNotificationToEvents('error', {
      threadId: 't1',
      turnId: 'turn_1',
      willRetry: false,
      error: {
        message: 'usage limit',
        codexErrorInfo: 'usageLimitExceeded',
        additionalDetails: null,
      },
    });
    expect(events[0]?.type).toBe('ERROR');
    if (events[0]?.type === 'ERROR') {
      expect(events[0].error.code).toBe('E_CODEX_USAGE_LIMIT');
      expect(events[0].error.userMessage).toContain('额度');
      expect(events[0].error.userMessage).toContain('官方');
    }
  });

  it('maps failed turn/completed to ERROR instead of success', () => {
    const events = mapAppServerNotificationToEvents('turn/completed', {
      threadId: 't1',
      turn: {
        id: 'turn_1',
        status: 'failed',
        error: {
          message: 'active turn is not steerable',
          codexErrorInfo: { activeTurnNotSteerable: { turnKind: 'compact' } },
          additionalDetails: null,
        },
      },
    });
    expect(events[0]?.type).toBe('ERROR');
    if (events[0]?.type === 'ERROR') {
      expect(events[0].error.code).toBe('E_CODEX_NOT_STEERABLE');
      expect(events[0].error.userMessage).toContain('追问');
    }
  });

  it('maps dynamicToolCall started to TOOL_CALL_REQUESTED', () => {
    const events = mapAppServerNotificationToEvents('item/started', {
      item: {
        type: 'dynamicToolCall',
        id: 'item_1',
        tool: 'learning.content',
        arguments: { action: 'explain' },
      },
    });
    expect(events[0]).toEqual({
      type: 'TOOL_CALL_REQUESTED',
      callId: 'item_1',
      toolName: 'learning.content',
      input: { action: 'explain' },
    });
  });

  it('respects STUDY_STUDIO_CODEX=0 without spawning process', async () => {
    const prev = process.env.STUDY_STUDIO_CODEX;
    process.env.STUDY_STUDIO_CODEX = '0';
    try {
      const cfg = loadCodexConfigFromEnv();
      expect(cfg.enabled).toBe(false);
      const adapter = new CodexAdapter({ config: cfg });
      const sessionRes = await adapter.createSession({
        sessionId: 'test_sess',
        userId: 'u1',
      });
      expect(isErr(sessionRes)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.STUDY_STUDIO_CODEX;
      else process.env.STUDY_STUDIO_CODEX = prev;
    }
  });
});

it('传给模型的上下文保留证据与不确定性', () => {
  const ctx = buildLearnerContextEntry({ targetLanguage: 'ja', learnerLevel: 'NOVICE', learnerDigest: { topWeaknesses: [], recordedStage: 'NOVICE', studyGoal: 'JLPT_N5', practiceEvidence: { status: 'unassessed', attempts: 0, correct: 0, accuracy: null, observedSkillCount: 0, skills: [], limitation: '未测能力未知' } } });
  expect(ctx?.value).toContain('"accuracy":null');
  expect(ctx?.value).toContain('Study goal is a target');
  expect(ctx?.value).toContain('NOVICE');
});
