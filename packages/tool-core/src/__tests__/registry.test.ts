import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import type { ToolDefinition } from '../tool.js';
import { ok, isOk, isErr } from '@study-studio/shared';

describe('Tool Core - ToolRegistry & Execution', () => {
  const dummyTool: ToolDefinition<{ word: string }, { definition: string }> = {
    name: 'dictionary.lookup',
    description: '查询词典释义',
    location: 'SERVER',
    permission: 'READ',
    schema: z.object({
      word: z.string().min(1),
    }),
    execute: async (input) => {
      return ok({ definition: `释义: ${input.word}` });
    },
  };

  it('should register and retrieve tools', () => {
    const registry = new ToolRegistry();
    registry.register(dummyTool);

    expect(registry.get('dictionary.lookup')).toBe(dummyTool);
    expect(registry.list().length).toBe(1);
  });

  it('unregister 按次工具：命中返回 true 并消失；未知名返回 false', () => {
    const registry = new ToolRegistry();
    registry.register(dummyTool);
    expect(registry.unregister('nope')).toBe(false);
    expect(registry.unregister('dictionary.lookup')).toBe(true);
    expect(registry.get('dictionary.lookup')).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it('should execute successfully with valid input', async () => {
    const registry = new ToolRegistry();
    registry.register(dummyTool);

    const res = await registry.execute(
      'dictionary.lookup',
      { word: 'りんご' },
      { userId: 'u1', sessionId: 's1' }
    );

    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value).toEqual({ definition: '释义: りんご' });
    }
  });

  it('should return validation error for invalid input', async () => {
    const registry = new ToolRegistry();
    registry.register(dummyTool);

    const res = await registry.execute(
      'dictionary.lookup',
      { word: '' }, // empty word violates min(1)
      { userId: 'u1', sessionId: 's1' }
    );

    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_TOOL_ARGS_INVALID');
      expect(res.error.userMessage).toContain('不符合规范');
    }
  });

  it('should return not found error for unregistered tool', async () => {
    const registry = new ToolRegistry();
    const res = await registry.execute(
      'unknown.tool',
      {},
      { userId: 'u1', sessionId: 's1' }
    );

    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_TOOL_NOT_FOUND');
      expect(res.error.userMessage).toContain('未找到指定工具');
    }
  });
});
