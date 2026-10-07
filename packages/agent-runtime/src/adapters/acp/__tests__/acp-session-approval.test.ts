import { describe, expect, it } from 'bun:test';
import { AcpAgentSession } from '../acp-adapter.js';
import type { AgentEvent } from '../../../contracts/event.js';

const HANDLE = {
  sessionId: 'acp-sess-1',
  prompt: async () => ({ ok: true as const, value: 'DONE' }),
};

const PERMISSION = {
  sessionId: 'acp-sess-1',
  toolCall: { title: 'dictionary.lookup' },
  params: { options: [{ optionId: 'allow-once', kind: 'allow_once' }] },
};

function makeSession(approvalPolicy?: string) {
  return new AcpAgentSession('s1', 'acp-sess-1', HANDLE, [], approvalPolicy);
}

describe('AcpAgentSession approval', () => {
  it('never/缺席自动放行，不产生 APPROVAL_REQUESTED', async () => {
    for (const policy of [undefined, 'never'] as const) {
      const session = makeSession(policy);
      const decided = await session.requestPermission(PERMISSION);
      expect(decided).toEqual({ outcome: 'selected', optionId: 'allow-once' });
    }
  });

  it('显式策略挂起等决策：REQUESTED→submit→RESOLVED', async () => {
    const session = makeSession('on-request');
    const pending = session.requestPermission(PERMISSION);
    const events: AgentEvent[] = [];
    const consumer = (async () => {
      for await (const event of session.send({ message: 'hi' })) {
        events.push(event);
        if (event.type === 'APPROVAL_REQUESTED') {
          const res = await session.submitApproval(event.approvalId, 'accept');
          expect(res.ok).toBe(true);
        }
        if (event.type === 'COMPLETED') break;
      }
    })();
    const decided = await pending;
    await consumer;
    expect(decided).toEqual({ outcome: 'selected', optionId: 'allow-once' });
    expect(events.some(e => e.type === 'APPROVAL_REQUESTED')).toBe(true);
    expect(events.some(e => e.type === 'APPROVAL_RESOLVED' && e.decision === 'accept')).toBe(true);
    expect(events.some(e => e.type === 'COMPLETED')).toBe(true);
  });

  it('未知审批 id 明确拒绝；无允许项自动 cancelled', async () => {
    const session = makeSession('on-request');
    const unknown = await session.submitApproval('nope', 'accept');
    expect(unknown.ok).toBe(false);
    const auto = makeSession(undefined);
    const decided = await auto.requestPermission({ ...PERMISSION, params: {} });
    expect(decided).toEqual({ outcome: 'cancelled' });
  });
});
