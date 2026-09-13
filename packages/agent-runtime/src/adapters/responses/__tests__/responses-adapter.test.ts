import { describe, expect, it } from 'bun:test';
import { ResponsesAdapter } from '../index.js';

describe('ResponsesAdapter stub', () => {
  it('creates a session and yields a lightweight completed reply', async () => {
    const adapter = new ResponsesAdapter();
    const sessionRes = await adapter.createSession({
      sessionId: 's_resp_1',
      userId: 'u1',
    });
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;

    const events = [];
    for await (const ev of sessionRes.value.send({ message: '「で」和「に」怎么区分？' })) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === 'TEXT_DELTA')).toBe(true);
    expect(events.some((e) => e.type === 'COMPLETED')).toBe(true);
  });

  it('biases lightweight reply by ContextSnapshot.targetLanguage', async () => {
    const adapter = new ResponsesAdapter();
    const sessionRes = await adapter.createSession({
      sessionId: 's_resp_en',
      userId: 'u1',
    });
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;

    let final = '';
    for await (const ev of sessionRes.value.send({
      message: '这个词怎么读？',
      contextSnapshot: {
        targetLanguage: 'en',
        learnerLevel: 'B1',
      },
    })) {
      if (ev.type === 'COMPLETED' && ev.finalOutput) final = ev.finalOutput;
    }
    expect(final).toContain('英语');
  });

  it('includes focus and weakness hints from ContextSnapshot', async () => {
    const { buildLightweightReply } = await import('../index.js');
    const reply = buildLightweightReply('这个词怎么读？', {
      targetLanguage: 'ja',
      learnerLevel: 'N3',
      focus: { kind: 'CARD', surface: '橋', skillTag: 'jp.pitch' },
      learnerDigest: {
        topWeaknesses: [{ skillId: 'jp.particle.ni_vs_de', name: 'に/で', proficiency: 42 }],
      },
    });
    expect(reply).toContain('橋');
    expect(reply).toContain('に/で');
  });
});
