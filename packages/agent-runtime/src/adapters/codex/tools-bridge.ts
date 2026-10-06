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
    description?: unknown;
    shape?: () => Record<string, z.ZodTypeAny>;
    type?: z.ZodTypeAny;
    values?: unknown;
    value?: unknown;
    innerType?: z.ZodTypeAny;
    schema?: z.ZodTypeAny;
    options?: z.ZodTypeAny[];
    checks?: unknown;
    minLength?: unknown;
    maxLength?: unknown;
  };
  const typeName = typeof def.typeName === 'string' ? def.typeName : undefined;
  // .describe() 说明透传：模型在注册时看到字段用途（如层级约定），不只看到裸类型。
  const description = typeof def.description === 'string' && def.description ? { description: def.description } : {};
  const withDescription = (node: Record<string, unknown>): Record<string, unknown> =>
    description.description ? { ...node, ...description } : node;

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
      return withDescription({
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      });
    }
    case 'ZodString': {
      const node: Record<string, unknown> = { type: 'string' };
      for (const check of asChecks(def.checks)) {
        if (check.kind === 'min') node.minLength = check.value;
        if (check.kind === 'max') node.maxLength = check.value;
      }
      return withDescription(node);
    }
    case 'ZodNumber': {
      const node: Record<string, unknown> = { type: 'number' };
      for (const check of asChecks(def.checks)) {
        if (check.kind === 'min') node.minimum = check.value;
        if (check.kind === 'max') node.maximum = check.value;
        if (check.kind === 'int') node.multipleOf = 1;
      }
      return withDescription(node);
    }
    case 'ZodBoolean':
      return withDescription({ type: 'boolean' });
    case 'ZodArray': {
      const node: Record<string, unknown> = { type: 'array', items: convertZod(def.type as z.ZodTypeAny) };
      const min = asBound(def.minLength);
      const max = asBound(def.maxLength);
      if (min !== null) node.minItems = min;
      if (max !== null) node.maxItems = max;
      return withDescription(node);
    }
    case 'ZodEnum':
      return withDescription({ type: 'string', enum: def.values });
    case 'ZodLiteral':
      return withDescription({ const: def.value });
    case 'ZodOptional':
    case 'ZodDefault': {
      const inner = convertZod(def.innerType as z.ZodTypeAny);
      // .optional().describe() 把说明挂在外层：内层无说明时用外层的。
      if (!('description' in inner)) return withDescription(inner);
      return inner;
    }
    case 'ZodNullable':
      return withDescription({ anyOf: [convertZod(def.innerType as z.ZodTypeAny), { type: 'null' }] });
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return withDescription({ anyOf: (def.options as z.ZodTypeAny[] | undefined)?.map(convertZod) ?? [] });
    case 'ZodRecord':
      return withDescription({ type: 'object', additionalProperties: true });
    case 'ZodEffects':
      // Refinement checks run at the tool boundary; expose their underlying fields to the engine.
      return withDescription(def.schema ? convertZod(def.schema) : {});
    default:
      return withDescription({});
  }
}

/** ZodString/ZodNumber checks 收窄（int 无 value；min/max 带 value；其余忽略）。 */
function asChecks(raw: unknown): Array<{ kind: string; value: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ kind: string; value: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.kind !== 'string') continue;
    if (rec.kind === 'int') {
      out.push({ kind: 'int', value: 0 });
      continue;
    }
    if (typeof rec.value !== 'number') continue;
    out.push({ kind: rec.kind, value: rec.value });
  }
  return out;
}

/** ZodArray minLength/maxLength 收窄（{ value: number } 形）。 */
function asBound(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>).value;
  return typeof value === 'number' ? value : null;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const def = schema._def as { typeName?: unknown } | undefined;
  const typeName = def?.typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}
