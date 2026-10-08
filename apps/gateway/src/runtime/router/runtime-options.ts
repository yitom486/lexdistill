import { AcpClient } from '@yitom/acp-client';

/**
 * 运行时选项探测（模型/思考深度真实列表，非硬编码）。
 *
 * - codex 主链路模型仍走 `/api/agent/models`（App Server 体系，不动）；
 * - ACP 运行时经“建会话读 configOptions”拿真实选项：model / reasoning_effort
 *   的 value 直接回填 setConfigOption，来回一致；
 * - 10 分钟缓存；无凭证/建会话失败如实返回空＋error（前端禁用并明示，不编默认值）。
 */
export interface AgentRuntimeOptionItem {
  value: string;
  label: string;
}

export interface AgentRuntimeOptions {
  models: AgentRuntimeOptionItem[];
  efforts: string[];
  error?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: AgentRuntimeOptions }>();

function pickEntry(
  options: unknown,
  id: string,
): { options?: Array<{ value?: unknown; name?: unknown }> } | null {
  const list = (options as { configOptions?: unknown })?.configOptions;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    if (item && typeof item === 'object' && (item as Record<string, unknown>)['id'] === id) {
      return item as { options?: Array<{ value?: unknown; name?: unknown }> };
    }
  }
  return null;
}

export async function getAgentRuntimeOptions(
  runtimeId: string,
  deps: {
    createClient: (runtimeId: string) => AcpClient;
    disconnectClient?: ((client: AcpClient) => Promise<void>) | undefined;
  },
): Promise<AgentRuntimeOptions> {
  const cached = cache.get(runtimeId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value: AgentRuntimeOptions;
  let client: AcpClient | null = null;
  try {
    client = deps.createClient(runtimeId);
    const connected = await client.connect();
    if (!connected.ok) throw new Error(connected.error.message);
    const opened = await client.createSession({ mcpServers: [] });
    if (!opened.ok) throw new Error(opened.error.message);
    const handle = opened.value as unknown as { sessionId: string; configOptions?: unknown };
    const modelEntry = pickEntry(handle.configOptions, 'model');
    const effortEntry = pickEntry(handle.configOptions, 'reasoning_effort');
    const models = (modelEntry?.options ?? [])
      .filter(option => typeof option.value === 'string' && option.value)
      .map(option => ({
        value: option.value as string,
        label: typeof option.name === 'string' && option.name ? option.name : (option.value as string),
      }));
    const efforts = (effortEntry?.options ?? [])
      .filter(option => typeof option.value === 'string' && option.value)
      .map(option => option.value as string);
    value = { models, efforts };
  } catch (error) {
    value = { models: [], efforts: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (client) {
      if (deps.disconnectClient) await deps.disconnectClient(client);
      else await client.disconnect('runtime options probed').catch(() => undefined);
    }
  }
  cache.set(runtimeId, { at: Date.now(), value });
  return value;
}

/** 仅测试使用。 */
export function clearRuntimeOptionsCacheForTest(): void {
  cache.clear();
}
