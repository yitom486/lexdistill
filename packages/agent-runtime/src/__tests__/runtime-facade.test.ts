import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runtime from '@study-studio/agent-runtime';
import { CodexAdapter, ResponsesAdapter, type AgentAdapter } from '@study-studio/agent-runtime';

/**
 * M2-1 agent-runtime 外观自检（所属包内断言，无反向边）。
 *
 * - 顶层出口透出两适配器；契约类型编译期贯通；
 * - Codex 专有动态工具桥禁上浮到根入口（toolsToDynamicSpecs /
 *   sanitizeToolName / resolveToolName / zodToJsonSchema / DynamicToolsBridge
 *   只能留在 adapters/codex 或旧 agent-codex 包内）；
 * - Gateway manifest 必须声明 agent-runtime（装配经统一入口）。
 */
const FORBIDDEN_ROOT_BRIDGE = [
  'toolsToDynamicSpecs',
  'sanitizeToolName',
  'resolveToolName',
  'zodToJsonSchema',
  'DynamicToolsBridge',
] as const;

function repoRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
}

describe('M2-1 agent-runtime facade', () => {
  it('顶层出口透出适配器（含契约类型编译期贯通）', () => {
    expect(typeof CodexAdapter).toBe('function');
    expect(typeof ResponsesAdapter).toBe('function');
    const adapter: AgentAdapter | null = null;
    expect(adapter).toBeNull();
  });

  it('根入口不暴露 Codex 专有工具桥符号', () => {
    const keys = new Set(Object.keys(runtime));
    for (const name of FORBIDDEN_ROOT_BRIDGE) {
      expect(keys.has(name)).toBe(false);
    }
  });

  it('Gateway manifest 声明 agent-runtime', async () => {
    const text = await readFile(join(repoRoot(), 'apps', 'gateway', 'package.json'), 'utf-8');
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('malformed apps/gateway/package.json');
    }
    const deps = (raw as { dependencies?: unknown }).dependencies;
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
      throw new Error('apps/gateway/package.json missing dependencies');
    }
    const table = deps as Record<string, unknown>;
    expect(table['@study-studio/agent-runtime']).toBe('workspace:*');
  });
});
