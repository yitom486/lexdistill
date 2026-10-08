import { BUILTIN_ACP_RUNTIMES, getAcpProviderStatus, probeCodexAuth } from '@yitom/acp-client';

/**
 * Agent 运行时目录（网关侧唯一 owner：可用性事实）。
 * id 与前端 `apps/web/src/config/agent-runtimes.ts` 对齐（codex-acp 默认）；
 * 展示文案直接取 acp-client 内置模板，不另起一份映射。
 */
export interface AgentRuntimeStatus {
  id: string;
  label: string;
  hint: string;
  /** true=可连；false=缺凭证；null=无法判定（前端显示未验证）。 */
  configured: boolean | null;
  capabilities: AgentRuntimeCapabilities;
}

/**
 * 按运行时能力开关（单一事实源，前端据此选择模型/思考深度的数据源，禁止按 id 硬编码特例）。
 * codex-acp 的会话跑在 ACP 上（App Server 的 model/list 是另一套旧目录，两边曾不一致：
 * ACP 侧有 gpt-6.1-sol 而 App Server 侧没有），故模型/思考深度必须走 ACP 探针，
 * 与 setConfigOption 同一口径；线程/用量面板沿用旧链路查询，保持不动。
 */
export interface AgentRuntimeCapabilities {
  /** true=模型下拉走 App Server model/list；false=走 ACP 探针（运行时真实目录）。 */
  supportsModelPicker: boolean;
  /** true=思考深度走前端常量；false=走 ACP 探针。 */
  supportsEffort: boolean;
  /** Codex thread 历史/压缩/队列/用量/技能/MCP 状态（ACP 会话无此体系）。 */
  supportsThreads: boolean;
  supportsUsage: boolean;
  /**
   * 网关台账历史/队列可用（sessions/items/改名/归档/队列按归属路由）。
   * ACP 运行时全开（台账以 ACP 会话 id 为键）；与 supportsThreads 正交。
   */
  supportsHistory: boolean;
}

/** codex-acp：会话走 ACP，模型/思考深度取 ACP 探针（与会话同口径）；线程/用量面板不动。 */
const CODEX_ACP_CAPABILITIES: AgentRuntimeCapabilities = {
  supportsModelPicker: false, supportsEffort: false, supportsThreads: true, supportsUsage: true,
  supportsHistory: true,
};
const AGENT_DEFAULT_CAPABILITIES: AgentRuntimeCapabilities = {
  supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false,
  supportsHistory: true,
};

function envConfigured(requiredEnvKeys: readonly string[] | undefined, runtimeId: string): boolean | null {
  if (runtimeId === 'agy') return true;
  if (!requiredEnvKeys || requiredEnvKeys.length === 0) return null;
  return requiredEnvKeys.some(key => Boolean(process.env[key]?.trim()));
}

export function listAgentRuntimes(): AgentRuntimeStatus[] {
  return BUILTIN_ACP_RUNTIMES.map(entry => ({
    id: entry.id,
    label: entry.name,
    hint: entry.authHint || entry.description,
    configured: entry.id === 'codex-acp' ? probeCodexAuth().looksLoggedIn : envConfigured(entry.requiredEnvKeys, entry.id),
    capabilities: entry.id === 'codex-acp' ? CODEX_ACP_CAPABILITIES : AGENT_DEFAULT_CAPABILITIES,
  }));
}

/** 自定义供应商伪条目（id 固定 'custom'，与前端 __custom__ 入口对应）。 */
export async function customRuntimeStatus(): Promise<AgentRuntimeStatus> {
  const status = await getAcpProviderStatus();
  return {
    id: 'custom',
    label: '自定义 API',
    hint: status.configured ? `${status.name || '已配置'} · ${status.model || ''}`.trim() : '自备兼容端点（OpenAI 兼容）',
    configured: status.configured,
    capabilities: AGENT_DEFAULT_CAPABILITIES,
  };
}

/**
 * 会话适配器选型：codex-acp 已走 ACP（模型 gpt-6-luna＋reasoning_effort 实跑验证通过，
 * resume 带工具亦证）；其余已知运行时走 ACP。
 * 空/未知 runtimeId 回落 codex（旧网关/旧前端兼容，绝不因拼写漂到新链路）。
 */
const ACP_RUNTIME_IDS: ReadonlySet<string> = new Set(
  [...BUILTIN_ACP_RUNTIMES.map(entry => entry.id), 'custom'].filter(id => id !== 'codex-appserver'),
);

export function resolveSessionAdapterId(runtimeId?: string | undefined): 'codex' | 'acp' {
  if (!runtimeId) return 'codex';
  if (runtimeId === 'codex-appserver') return 'codex';
  return ACP_RUNTIME_IDS.has(runtimeId) ? 'acp' : 'codex';
}
