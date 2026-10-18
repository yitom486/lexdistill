import { describe, expect, it } from 'bun:test';
import { adaptLexMessagesToYitom } from '../chat-message-adapter.js';
import type { ChatMessage as LexChatMessage } from '../chat-shared.js';

describe('adaptLexMessagesToYitom', () => {
  it('converts user and system messages properly', () => {
    const lexMessages: LexChatMessage[] = [
      { id: '1', role: 'user', text: '你好\n\n[StudyStudio Context]\n - track: ja' },
      { id: '2', role: 'system', text: '已清屏' },
    ];

    const result = adaptLexMessagesToYitom(lexMessages);
    expect(result.messages.length).toBe(2);
    const first = result.messages[0]!;
    const second = result.messages[1]!;
    expect(first.role).toBe('user');
    expect(first.text).toBe('你好');
    expect(second.role).toBe('system');
    expect(second.text).toBe('已清屏');
    expect(result.pendingPermission).toBeNull();
  });

  it('decouples assistant reasoning and toolCalls into thought, tool, and agent messages', () => {
    const lexMessages: LexChatMessage[] = [
      {
        id: 'ai-1',
        role: 'assistant',
        text: '这是最终回复',
        reasoning: '让我想想怎么回答',
        streaming: false,
        toolCalls: [
          {
            id: 'call-1',
            toolName: 'search_dictionary',
            status: 'done',
            arguments: { word: '勉強' },
          },
        ],
      },
    ];

    const result = adaptLexMessagesToYitom(lexMessages);
    expect(result.messages.length).toBe(3);
    const [thoughtMsg, toolMsg, agentMsg] = result.messages;

    // 1. thought
    expect(thoughtMsg!.id).toBe('ai-1_thought');
    expect(thoughtMsg!.role).toBe('thought');
    expect(thoughtMsg!.text).toBe('让我想想怎么回答');

    // 2. tool
    expect(toolMsg!.id).toBe('call-1');
    expect(toolMsg!.role).toBe('tool');
    expect(toolMsg!.toolName).toBe('search_dictionary');
    expect(toolMsg!.toolStatus).toBe('completed');
    expect(toolMsg!.toolContentText).toContain('勉強');

    // 3. agent
    expect(agentMsg!.id).toBe('ai-1');
    expect(agentMsg!.role).toBe('agent');
    expect(agentMsg!.text).toBe('这是最终回复');
    expect(agentMsg!.streaming).toBe(false);
  });

  it('extracts pending approval to pendingPermission', () => {
    const lexMessages: LexChatMessage[] = [
      {
        id: 'appr-1',
        role: 'approval',
        text: '',
        approval: {
          approvalId: 'auth_123',
          action: 'write_file',
          description: '写入测试文档',
          riskLevel: 'medium',
          status: 'pending',
        },
      },
    ];

    const result = adaptLexMessagesToYitom(lexMessages);
    expect(result.pendingPermission).not.toBeNull();
    expect(result.pendingPermission?.summary).toContain('write_file');
    expect(result.pendingPermission?.options.length).toBe(3);
  });
});
