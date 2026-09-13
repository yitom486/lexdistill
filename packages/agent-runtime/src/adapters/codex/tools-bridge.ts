import type { ToolDefinition } from '@study-studio/tool-core';
import type { DynamicToolSpec } from './app-server-protocol.js';
import type { z } from 'zod';

export interface DynamicToolsBridge {
  specs: DynamicToolSpec[];
  /** sanitize 后的名字 → 原始 tool-core 名 */
  nameMap: Map<string, string>;
}

/** 将 tool-core 定义转为 Codex dynamicTools（Responses function schema） */
export function toolsToDynamicSpecs(tools: ToolDefinition[]): DynamicToolsBridge {
  const nameMap = new Map<string, string>();
  const specs = tools.map((tool) => {
    const sanitized = sanitizeToolName(tool.name);
    nameMap.set(sanitized, tool.name);
    // 也登记常见下划线变体，便于回填
    nameMap.set(tool.name, tool.name);
    return {
      type: 'function' as const,
      name: sanitized,
      description: tool.description.slice(0, 1024),
      inputSchema: zodToJsonSchema(tool.schema),
    };
  });
  return { specs, nameMap };
}

export function sanitizeToolName(name: string): string {
  // Responses API 工具名约束：字母数字下划线为主
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '').slice(0, 64) || 'tool';
}

export function resolveToolName(
  reported: string,
  nameMap?: Map<string, string>
): string[] {
  const candidates = new Set<string>();
  if (nameMap?.has(reported)) candidates.add(nameMap.get(reported)!);
  candidates.add(reported);
  candidates.add(reported.replace(/_/g, '.'));
  candidates.add(sanitizeToolName(reported));
  return [...candidates];
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convertZod(schema);
}

function convertZod(schema: z.ZodTypeAny): Record<string, unknown> {
  // zod 内部 _def 为弱结构；此处一次性收窄为本文件实际读取的子集。
  const def = schema._def as {
    typeName?: unknown;
    shape?: () => Record<string, z.ZodTypeAny>;
    type?: z.ZodTypeAny;
    values?: unknown;
    value?: unknown;
    innerType?: z.ZodTypeAny;
    options?: z.ZodTypeAny[];
  };
  const typeName = typeof def.typeName === 'string' ? def.typeName : undefined;

  switch (typeName) {
    case 'ZodObject': {
      const shape = def.shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const key of Object.keys(shape)) {
        const child = shape[key] as z.ZodTypeAny;
        properties[key] = convertZod(child);
        if (!isOptional(child)) required.push(key);
      }
      return {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };
    }
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return { type: 'array', items: convertZod(def.type as z.ZodTypeAny) };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodLiteral':
      return { const: def.value };
    case 'ZodOptional':
    case 'ZodDefault':
      return convertZod(def.innerType as z.ZodTypeAny);
    case 'ZodNullable':
      return { anyOf: [convertZod(def.innerType as z.ZodTypeAny), { type: 'null' }] };
    case 'ZodUnion':
      return { anyOf: (def.options as z.ZodTypeAny[] | undefined)?.map(convertZod) ?? [] };
    case 'ZodRecord':
      return { type: 'object', additionalProperties: true };
    default:
      return {};
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const def = schema._def as { typeName?: unknown } | undefined;
  const typeName = def?.typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}
