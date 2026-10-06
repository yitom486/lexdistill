import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { ok } from '@study-studio/shared';
import { toolsToDynamicSpecs, sanitizeToolName, resolveToolName } from '../tools-bridge.js';

/**
 * tools-bridge：zod → Codex dynamicTools JSON Schema。
 * 模型在注册时只看得到这里输出的东西——说明与约束必须透传，
 * 否则模型拿到的是裸类型（如层级约定丢失，目录 level 必错）。
 */
describe('tools-bridge schema 透传', () => {
  it('preserves nested discriminated question formats and their required answer fields', () => {
    const schema = z.object({ questions: z.array(z.object({ answer: z.discriminatedUnion('type', [
      z.object({ type: z.literal('CHOICE'), correctKey: z.string(), options: z.array(z.string()).min(2) }),
      z.object({ type: z.literal('WRITING'), rubric: z.string(), referenceAnswer: z.string() }),
    ]) }).superRefine(() => {})).min(1).max(20) });
    const { specs } = toolsToDynamicSpecs([{ name: 'generation.submit', description: 'Submit', location: 'SERVER', permission: 'WRITE', schema, execute: async () => ok(undefined) }]);
    const result = specs[0]!.inputSchema as { properties: { questions: { minItems: number; maxItems: number; items: { properties: { answer: { anyOf: { properties: Record<string, unknown>; required: string[] }[] } } } } } };
    expect(result.properties.questions.minItems).toBe(1); expect(result.properties.questions.maxItems).toBe(20);
    const variants = result.properties.questions.items.properties.answer.anyOf;
    expect(variants).toHaveLength(2);
    expect(variants[0]!.properties.type).toEqual({ const: 'CHOICE' });
    expect(variants[0]!.required).toEqual(['type', 'correctKey', 'options']);
    expect(variants[1]!.properties.type).toEqual({ const: 'WRITING' });
    expect(variants[1]!.required).toEqual(['type', 'rubric', 'referenceAnswer']);
  });
  it('.describe() 说明透传到模型可见 schema', () => {
    const schema = z.object({
      concept: z.string().min(1).max(200).describe('知识点概念'),
      kind: z.enum(['concept', 'rule']).optional().describe('点类型'),
    });
    const { specs } = toolsToDynamicSpecs([
      {
        name: 'library.save_knowledge_points',
        description: '保存知识点',
        location: 'SERVER',
        permission: 'WRITE',
        schema,
        execute: async () => ok(undefined),
      },
    ]);
    const spec = specs[0]!;
    const props = (spec.inputSchema as { properties: Record<string, unknown> }).properties;
    expect((props.concept as Record<string, unknown>).description).toBe('知识点概念');
    expect((props.kind as Record<string, unknown>).description).toBe('点类型');
  });

  it('字符串/数字/数组约束透传（min/max），optional 不进 required', () => {
    const schema = z.object({
      name: z.string().min(1).max(64),
      ord: z.number().int().min(0).optional(),
      tags: z.array(z.string()).max(32).optional(),
    });
    const { specs } = toolsToDynamicSpecs([
      {
        name: 't',
        description: 'd',
        location: 'SERVER',
        permission: 'READ',
        schema,
        execute: async () => ok(undefined),
      },
    ]);
    const input = specs[0]!.inputSchema as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(input.properties.name).toMatchObject({ type: 'string', minLength: 1, maxLength: 64 });
    expect(input.properties.ord).toMatchObject({ type: 'number', minimum: 0, multipleOf: 1 });
    expect(input.properties.tags).toMatchObject({ maxItems: 32 });
    expect(input.required).toEqual(['name']);
  });

  it('无说明时不加 description 键（保持旧输出干净）', () => {
    const schema = z.object({ q: z.string() });
    const { specs } = toolsToDynamicSpecs([
      {
        name: 't',
        description: 'd',
        location: 'SERVER',
        permission: 'READ',
        schema,
        execute: async () => ok(undefined),
      },
    ]);
    const props = (specs[0]!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect('description' in (props.q as Record<string, unknown>)).toBe(false);
  });

  it('工具名消毒与回填映射不变', () => {
    expect(sanitizeToolName('library.save_knowledge_points')).toBe('library_save_knowledge_points');
    const { nameMap } = toolsToDynamicSpecs([
      {
        name: 'library.save_knowledge_points',
        description: 'd',
        location: 'SERVER',
        permission: 'WRITE',
        schema: z.object({}),
        execute: async () => ok(undefined),
      },
    ]);
    expect(nameMap.get('library_save_knowledge_points')).toBe('library.save_knowledge_points');
    expect(resolveToolName('library_save_knowledge_points', nameMap)).toContain(
      'library.save_knowledge_points'
    );
  });
});
