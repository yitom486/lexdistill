import { describe, expect, it } from 'bun:test';
import { ImportEventSchema } from '@lexdistill/document-model';
import { summarizeWorkers } from '../WorkerLiveStrip.js';

const base = {
  userId: 'owner', traceId: 'trace', documentId: 'book', jobId: null, threadId: null, callId: null,
};
const event = (sequence: number, extra: Record<string, unknown>) => ImportEventSchema.parse({
  ...base, sequence, nodeId: null, sessionId: null, attemptId: null,
  category: 'model', name: 'input', occurredAt: '2026-10-05T00:00:00Z', ...extra,
});

describe('WorkerLiveStrip 聚合', () => {
  it('按会话分组：章节、调用数、结束与失败态', () => {
    const events = [
      event(1, { sessionId: 'pool-worker-0', nodeId: 'a', attemptId: 'x', name: 'bound', category: 'session' }),
      event(2, { sessionId: 'pool-worker-0', nodeId: 'a', attemptId: 'x', name: 'requested', category: 'tool', callId: 'c1' }),
      event(3, { sessionId: 'pool-worker-0', nodeId: 'a', attemptId: 'x', name: 'content_staged', category: 'storage', callId: 'c1' }),
      event(4, { sessionId: 'pool-worker-0', nodeId: 'a', attemptId: 'x', name: 'unbound', category: 'session' }),
      event(5, { sessionId: 'pool-worker-1', nodeId: 'b', attemptId: 'y', name: 'requested', category: 'tool', callId: 'c2' }),
      event(6, { nodeId: 'b', name: 'failed', category: 'task' }),
    ];
    const [first, second] = summarizeWorkers(events, 120_000, Date.parse('2026-10-05T00:01:00Z'));
    expect(first).toMatchObject({ sessionId: 'pool-worker-0', chapterId: 'a', state: 'done', toolCalls: 1, staged: 1 });
    expect(second).toMatchObject({ sessionId: 'pool-worker-1', chapterId: 'b', state: 'failed', toolCalls: 1 });
  });

  it('运行中超过 stall 才标黄，无会话事件时不渲染', () => {
    const running = [event(1, { sessionId: 'w', nodeId: 'a', attemptId: 'x', name: 'input' })];
    expect(summarizeWorkers(running, 120_000, Date.parse('2026-10-05T00:01:00Z'))[0]?.state).toBe('running');
    expect(summarizeWorkers(running, 120_000, Date.parse('2026-10-05T00:05:00Z'))[0]?.state).toBe('stalled');
    expect(summarizeWorkers([event(1, {})], 120_000)).toEqual([]);
  });
});
