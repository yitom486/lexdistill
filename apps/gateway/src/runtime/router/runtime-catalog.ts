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
 * 按运行时能力开关（单一事实源，前端据此禁用模型/思考深度控件，禁止按 id 硬编码特例）。
 * codex-acp 沿用 Codex 旧链路故全开；ACP 侧模型/思考深度映射未验证前一律关闭，
 * 由 Agent 用自带默认（而非前端瞎传 codex 专属值）。
 */
export interface AgentRuntimeCapabilities {
  supportsModelPicker: boolean;
  supportsEffort: boolean;
}

const FULL_CAPABILITIES: AgentRuntimeCapabilities = { supportsModelPicker: true, supportsEffort: true };
const AGENT_DEFAULT_CAPABILITIES: AgentRuntimeCapabilities = { supportsModelPicker: false, supportsEffort: false };

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
    capabilities: entry.id === 'codex-acp' ? FULL_CAPABILITIES : AGENT_DEFAULT_CAPABILITIES,
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
