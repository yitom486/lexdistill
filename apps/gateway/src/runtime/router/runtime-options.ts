import { AcpClient, findModelConfigOption, parseAcpConfigOptions } from '@yitom/acp-client';
import type { AcpConfigOption } from '@yitom/acp-client';

/**
 * 运行时选项探测（模型/思考深度真实列表，非硬编码）。
 *
 * - codex 主链路模型仍走 `/api/agent/models`（App Server 体系，不动）；
 * - ACP 运行时经“建会话读 configOptions”拿真实选项：解析与方言兼容全部委托
 *   acp-client（`parseAcpConfigOptions`＋`findModelConfigOption`：configId/id 双字段、
 *   category 定位、顶层 models 合成，由 SDK 在建会话时完成，网关不再手搓解析）；
 *   model / effort 的 value 直接回填 setConfigOption，来回一致；
 * - 思考深度暂无 SDK finder：以 SDK 同款哲学（configId 含 effort 即命中）匹配解析后选项；
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

/**
 * 思考深度选项定位（SDK 暂未提供 finder，网关只做最小匹配）：
 * 沿用 SDK `findModelConfigOption` 的同款哲学（configId 含关键字即命中），
 * 覆盖 reasoning_effort / reasoning-effort / effort 等方言。
 */
function findEffortConfigOption(options: AcpConfigOption[]): AcpConfigOption | undefined {
  return options.find((option) => option.configId.includes('effort'));
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
    const parsed = parseAcpConfigOptions(opened.value.configOptions);
    const modelEntry = findModelConfigOption(parsed);
    const effortEntry = findEffortConfigOption(parsed);
    const models = (modelEntry?.options ?? [])
      .map(option => ({
        value: option.value,
        label: option.name || option.value,
      }));
    const efforts = (effortEntry?.options ?? []).map(option => option.value);
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
