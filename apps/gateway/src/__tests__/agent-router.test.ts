import { describe, expect, it } from 'bun:test';
import { selectAgentRoute } from '../runtime/router/agent-router.js';

describe('selectAgentRoute', () => {
  it('routes quiz / example intents to learning-loop', () => {
    expect(selectAgentRoute({ userPrompt: '请给我造三个例句' }).route).toBe('learning-loop');
    expect(selectAgentRoute({ userPrompt: '随便聊聊', intent: 'GENERATE_QUIZ' }).route).toBe(
      'learning-loop'
    );
    expect(selectAgentRoute({ userPrompt: '讲透这个考点' }).reason).toBe('content_or_quiz_intent');
  });

  it('routes FREE_COACH to Agent learning-loop', () => {
    expect(
      selectAgentRoute({ userPrompt: '你好，请问你是谁呢', intent: 'FREE_COACH' }).route
    ).toBe('learning-loop');
    expect(
      selectAgentRoute({ userPrompt: '你好，请问你是谁呢', intent: 'FREE_COACH' }).reason
    ).toBe('free_coach_agent');
  });

  it('routes pitch / particle hints to responses-lite', () => {
    expect(selectAgentRoute({ userPrompt: '「橋」的声调怎么读？' }).route).toBe('responses-lite');
    expect(selectAgentRoute({ userPrompt: '助词で怎么用' }).route).toBe('responses-lite');
    expect(selectAgentRoute({ userPrompt: 'drill', intent: 'DRILL_KANA' }).route).toBe(
      'responses-lite'
    );
    expect(selectAgentRoute({ userPrompt: 'drill', intent: 'DRILL_HANGUL' }).route).toBe(
      'responses-lite'
    );
    expect(
      selectAgentRoute({ userPrompt: 'drill', intent: 'DRILL_HANGUL' }).reason
    ).toBe('drill_hangul_intent');
  });

  it('routes track-aware lite hints', () => {
    expect(
      selectAgentRoute({
        userPrompt: 'How do you pronounce thorough?',
        targetLanguage: 'en',
      }).route
    ).toBe('responses-lite');
    expect(
      selectAgentRoute({ userPrompt: '에서와 에 차이', targetLanguage: 'ko' }).route
    ).toBe('responses-lite');
  });

  it('routes open chat / short greetings to learning-loop (Agent)', () => {
    expect(selectAgentRoute({ userPrompt: '这是什么意思？' }).route).toBe('learning-loop');
    expect(selectAgentRoute({ userPrompt: '你好' }).route).toBe('learning-loop');
  });

  it('defaults free coaching to learning-loop', () => {
    expect(
      selectAgentRoute({
        userPrompt:
          '请结合我最近的错题本，帮我制定一个为期一周的语法复盘计划，并说明每天侧重点。',
      }).route
    ).toBe('learning-loop');
  });
});
