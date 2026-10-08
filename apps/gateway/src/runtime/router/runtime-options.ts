import { AcpClient, findModelConfigOption, parseAcpConfigOptions } from '@yitom/acp-client';
import { discoverThinking } from './model-thinking.js';

/**
 * 运行时选项探测（模型/思考深度真实列表，非硬编码）。
 *
 * - codex 主链路模型仍走 `/api/agent/models`（App Server 体系，不动）；
 * - ACP 运行时经“建会话读 configOptions”拿真实选项：解析与方言兼容全部委托
 *   acp-client（`parseAcpConfigOptions`＋`findModelConfigOption`：configId/id 双字段、
 *   category 定位、顶层 models 合成，由 SDK 在建会话时完成，网关不再手搓解析）；
 *   model / effort 的 value 直接回填 setConfigOption，来回一致；
 * - 思考档发现走网关 `model-thinking`（规则移植自下游 Inkdown：独立选项→直设，
 *   方括号变体→模型 id 改写，两者皆无→不可设；横杠 `-fast` 系速度/子型号，不算思考档）；
 * - 10 分钟缓存；无凭证/建会话失败如实返回空＋error（前端禁用并明示，不编默认值）。
 */
export interface AgentRuntimeOptionItem {
  value: string;
  label: string;
}

export interface AgentRuntimeOptions {
  models: AgentRuntimeOptionItem[];
  efforts: string[];
  /**
   * true=档位来自变体候选（仅对探针时刻的当前模型背书；换 base 后由建会话 live 解析，
   * 发前证伪跳过 effort，避免误杀）。
   */
  effortsVariant?: boolean;
  error?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: AgentRuntimeOptions }>();

export async function getAgentRuntimeOptions(
  runtimeId: string,
  deps: {
    createClient: (runtimeId: string) => AcpClient;
    disconnectClient?: ((client: AcpClient) => Promise<void>) | undefined;
  },
  opts?: { model?: string },
): Promise<AgentRuntimeOptions> {
  // 档位是按模型的：opencode 类 Agent 在切模型后才动态下发 effort（级联），
  // 故缓存键带模型，探针按需先设模型再读刷新表（如下游 ACP Studio 同款）。
  const wantedModel = opts?.model?.trim() || '';
  const cacheKey = wantedModel ? `${runtimeId}\n${wantedModel}` : runtimeId;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value: AgentRuntimeOptions;
  let client: AcpClient | null = null;
  try {
    client = deps.createClient(runtimeId);
    const connected = await client.connect();
    if (!connected.ok) throw new Error(connected.error.message);
    const opened = await client.createSession({ mcpServers: [] });
    if (!opened.ok) throw new Error(opened.error.message);
    let liveConfigOptions: unknown = opened.value.configOptions;
    const parsed0 = parseAcpConfigOptions(liveConfigOptions);
    const modelEntry0 = findModelConfigOption(parsed0);
    const models = (modelEntry0?.options ?? [])
      .map(option => ({
        value: option.value,
        label: option.name || option.value,
      }));
    if (wantedModel) {
      const setRes = await opened.value.setConfigOption(modelEntry0?.configId ?? 'model', wantedModel);
      if (!setRes.ok) throw new Error(`模型 ${wantedModel} 设置失败：${setRes.error.message}`);
      const refreshed = (setRes.value as { configOptions?: unknown } | null)?.configOptions;
      if (refreshed !== undefined) liveConfigOptions = refreshed;
    }
    const parsed = parseAcpConfigOptions(liveConfigOptions);
    const modelEntry = findModelConfigOption(parsed);
    const thinking = discoverThinking(parsed, modelEntry);
    const efforts = thinking.efforts;
    value = { models, efforts, ...(thinking.variant ? { effortsVariant: true } : {}) };
  } catch (error) {
    value = { models: [], efforts: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (client) {
      if (deps.disconnectClient) await deps.disconnectClient(client);
      else await client.disconnect('runtime options probed').catch(() => undefined);
    }
  }
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** 仅测试使用。 */
export function clearRuntimeOptionsCacheForTest(): void {
  cache.clear();
}
