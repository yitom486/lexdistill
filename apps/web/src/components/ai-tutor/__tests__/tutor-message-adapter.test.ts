import { expect, it } from 'bun:test';
import { adaptTutorMessages } from '../tutor-message-adapter.js';
import { extractPredictedFollowUps } from '../../../lib/followups.js';
import type { TutorStreamMessage } from '../useTutorStream.js';

it('用户/助手直转，思考独立成 thought 消息', () => {
  const messages: TutorStreamMessage[] = [
    { id: 'u1', timestamp: '2026-01-01T00:00:00Z', sender: 'user', text: '为什么用「に」' },
    {
      id: 'a1',
      timestamp: '2026-01-01T00:00:00Z',
      sender: 'ai',
      text: '因为这里表示归着点。',
      reasoning: '先判断助词类型',
      isStreaming: false,
      source: 'streamed',
    },
  ];

  const out = adaptTutorMessages(messages);
  expect(out.map((m) => `${m.id}:${m.role}`)).toEqual(['u1:user', 'a1_thought:thought', 'a1:agent']);
  expect(out[1]!.text).toBe('先判断助词类型');
  expect(out[2]!.streaming).toBe(false);
});

it('完成态正文用剥离预测块后的文本，流式保持原文', () => {
  const raw = '正文解释。\n【追问】\n- 「で」和「に」的区别？\n- 还有别的用法吗？';

  const settled = adaptTutorMessages([{ id: 'a2', timestamp: '2026-01-01T00:00:00Z', sender: 'ai', text: raw, isStreaming: false }]);
  expect(settled[0]!.text).toBe(extractPredictedFollowUps(raw).displayText);

  const streaming = adaptTutorMessages([{ id: 'a3', timestamp: '2026-01-01T00:00:00Z', sender: 'ai', text: raw, isStreaming: true }]);
  expect(streaming[0]!.text).toBe(raw);
  expect(streaming[0]!.streaming).toBe(true);
});

it('流式中的思考消息在正文出现前保持 streaming，正文到达后收束', () => {
  const reasoningOnly = adaptTutorMessages([
    { id: 'a4', timestamp: '2026-01-01T00:00:00Z', sender: 'ai', text: '', reasoning: '分析中', isStreaming: true },
  ]);
  expect(reasoningOnly.map((m) => m.role)).toEqual(['thought', 'agent']);
  expect(reasoningOnly[0]!.streaming).toBe(true);

  const withText = adaptTutorMessages([
    { id: 'a5', timestamp: '2026-01-01T00:00:00Z', sender: 'ai', text: '结论', reasoning: '分析完成', isStreaming: true },
  ]);
  expect(withText[0]!.streaming).toBe(false);
});
