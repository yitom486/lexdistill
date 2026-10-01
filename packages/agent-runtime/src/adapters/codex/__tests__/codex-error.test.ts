import { describe, expect, it } from 'bun:test';
import { mapAppServerNotificationToEvents } from '../index.js';
import {
  translateCodexNotificationParams,
  translateCodexTurnError,
} from '../codex-error.js';

function expectNotVague(text: string) {
  expect(text).not.toContain('[object Object]');
  expect(text).not.toContain('一点小问题');
  expect(text).not.toContain('检查 Gateway');
}

describe('Codex error pipeline (App Server notify → user copy)', () => {
  it('does not stringify a TurnError object into [object Object]', () => {
    const error = translateCodexTurnError({
      message: 'model stream aborted after retry',
      codexErrorInfo: null,
      additionalDetails: 'upstream reset',
    });
    expect(error.code).toBe('E_CODEX_TURN');
    expect(error.userMessage).toContain('model stream aborted after retry');
    expect(error.userMessage).toContain('upstream reset');
    expectNotVague(error.userMessage);
  });

  it('willRetry=true 给出非终止诊断，仍不翻译为终态错误', () => {
    expect(
      translateCodexNotificationParams({
        willRetry: true,
        threadId: 't1',
        turnId: 'turn_1',
        error: {
          message: 'temporary overload',
          codexErrorInfo: 'serverOverloaded',
          additionalDetails: null,
        },
      })
    ).toBeNull();
    expect(
      mapAppServerNotificationToEvents('error', {
        willRetry: true,
        error: { message: 'temporary overload', codexErrorInfo: 'serverOverloaded' },
      })
    ).toEqual([expect.objectContaining({ type: 'RUNTIME_RETRY', code: 'E_CODEX_OVERLOADED' })]);
  });

  it('emits ERROR once willRetry is false after a skipped retry notify', () => {
    const skipped = mapAppServerNotificationToEvents('error', {
      willRetry: true,
      error: { message: 'temporary overload', codexErrorInfo: 'serverOverloaded' },
    });
    const terminal = mapAppServerNotificationToEvents('error', {
      willRetry: false,
      error: { message: 'still overloaded', codexErrorInfo: 'serverOverloaded' },
    });
    expect(skipped[0]?.type).toBe('RUNTIME_RETRY');
    expect(terminal[0]?.type).toBe('ERROR');
    if (terminal[0]?.type === 'ERROR') {
      expect(terminal[0].error.code).toBe('E_CODEX_OVERLOADED');
      expectNotVague(terminal[0].error.userMessage);
    }
  });

  it('does not treat leftover quota as usageLimitExceeded unless Codex says so', () => {
    const events = mapAppServerNotificationToEvents('error', {
      willRetry: false,
      error: {
        message: 'stream disconnected',
        codexErrorInfo: null,
        additionalDetails: null,
      },
    });
    expect(events[0]?.type).toBe('ERROR');
    if (events[0]?.type === 'ERROR') {
      expect(events[0].error.code).not.toBe('E_CODEX_USAGE_LIMIT');
      expect(events[0].error.userMessage).toContain('stream disconnected');
      expectNotVague(events[0].error.userMessage);
    }
  });

  it('maps known CodexErrorInfo variants to specific codes', () => {
    const cases: Array<{ info: unknown; code: string; hint: string }> = [
      { info: 'usageLimitExceeded', code: 'E_CODEX_USAGE_LIMIT', hint: '额度' },
      { info: 'contextWindowExceeded', code: 'E_CODEX_CONTEXT_WINDOW', hint: '上下文' },
      { info: 'unauthorized', code: 'E_CODEX_UNAUTHORIZED', hint: 'login' },
      { info: 'serverOverloaded', code: 'E_CODEX_OVERLOADED', hint: '正忙' },
      { info: { httpConnectionFailed: { httpStatusCode: 503 } }, code: 'E_CODEX_HTTP', hint: '503' },
      {
        info: { activeTurnNotSteerable: { turnKind: 'compact' } },
        code: 'E_CODEX_NOT_STEERABLE',
        hint: '追问',
      },
    ];
    for (const item of cases) {
      const error = translateCodexTurnError({
        message: 'ignored-when-mapped',
        codexErrorInfo: item.info,
        additionalDetails: null,
      });
      expect(error.code).toBe(item.code);
      expect(error.userMessage).toContain(item.hint);
      expectNotVague(error.userMessage);
    }
  });

  it('maps failed turn/completed to ERROR, successful turn/completed to COMPLETED', () => {
    const failed = mapAppServerNotificationToEvents('turn/completed', {
      threadId: 't1',
      turn: {
        id: 'turn_1',
        status: 'failed',
        error: {
          message: 'bad request from client',
          codexErrorInfo: 'badRequest',
          additionalDetails: null,
        },
      },
    });
    const ok = mapAppServerNotificationToEvents('turn/completed', {
      threadId: 't1',
      turn: { id: 'turn_2', status: 'completed', error: null },
    });
    expect(failed[0]?.type).toBe('ERROR');
    if (failed[0]?.type === 'ERROR') {
      expect(failed[0].error.code).toBe('E_CODEX_BAD_REQUEST');
      expectNotVague(failed[0].error.userMessage);
    }
    expect(ok).toEqual([{ type: 'COMPLETED' }]);
  });
});
