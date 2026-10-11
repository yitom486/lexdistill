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
 * 模型/思考深度一律走 ACP 探针（与 setConfigOption 同一口径）；历史/队列走网关台账。
 */
export interface AgentRuntimeCapabilities {
  /** 旧 App Server 模型下拉已退役，一律 false（走 ACP 探针，运行时真实目录）。 */
  supportsModelPicker: boolean;
  /** 前端常量思考深度已退役，一律 false（走 ACP 探针）。 */
  supportsEffort: boolean;
  /** 旧 thread 历史/压缩/队列/用量/技能/MCP 面板（ACP 会话无此体系，一律 false）。 */
  supportsThreads: boolean;
  supportsUsage: boolean;
  /**
   * 网关台账历史/队列可用（sessions/items/改名/归档/队列按归属路由）。
   * ACP 运行时全开（台账以 ACP 会话 id 为键）；与 supportsThreads 正交。
   */
  supportsHistory: boolean;
  /**
   * 会话 MCP 工具实测可用（模型能经 MCP 调回网关桥工具并完成多轮调用）。
   * 固定工具任务（vocabulary.explain）的唯一门禁，见下方 SESSION_TOOLS_VERIFIED。
   */
  supportsSessionTools: boolean;
}

/** codex-acp：会话走 ACP，模型/思考深度取 ACP 探针（与会话同口径）；
 * 历史/队列走网关台账；旧原生面板（Skills/MCP/用量）无 ACP 对应物，不开。
 * 配额类（额度）全协议无对应物，不开。 */
const CODEX_ACP_CAPABILITIES: AgentRuntimeCapabilities = {
  supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false,
  supportsHistory: true,
  // spike 带 luna＋medium 建会话＋两轮工具＋resume 全绿；词汇讲解端到端可用。
  supportsSessionTools: true,
};
const AGENT_DEFAULT_CAPABILITIES: AgentRuntimeCapabilities = {
  supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false,
  supportsHistory: true,
  // 未验证：agy 实测挂载 MCP 后无视网关工具、空转内置命令至 prompt 超时，先按不支持处理。
  supportsSessionTools: false,
};

/**
 * 会话 MCP 工具实测通过的运行时（网关唯一口径；固定工具任务门禁的事实源）：
 * - codex-acp：spike 建会话＋两轮工具＋resume 全绿，词汇讲解端到端可用；
 * - opencode：单工具＋先读后写两轮 MCP 调用实测通过；
 * - agy：实测无视 MCP、空转内置命令至 prompt 超时，未通过；
 * - 其余（含 custom）：未验证，按不支持处理（fail-fast 明示，不烧模型轮次）。
 */
const SESSION_TOOLS_VERIFIED: ReadonlySet<string> = new Set(['codex-acp', 'opencode']);

/** 能力集选型（唯一口径：codex-acp 走实测集，其余走默认集；custom 同默认）。 */
function capabilitiesFor(runtimeId: string): AgentRuntimeCapabilities {
  const base = runtimeId === 'codex-acp' ? CODEX_ACP_CAPABILITIES : AGENT_DEFAULT_CAPABILITIES;
  return { ...base, supportsSessionTools: SESSION_TOOLS_VERIFIED.has(runtimeId) };
}

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
    capabilities: capabilitiesFor(entry.id),
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
 * 固定工具任务的运行时门禁（网关唯一口径，供 turn-handlers 在建会话前 fail-fast）。
 * 未验证的运行时不建会话、不烧模型轮次；调用方负责把 false 翻译为可读指引。
 */
export function runtimeSupportsSessionTools(runtimeId?: string | undefined): boolean {
  if (!runtimeId) return false;
  return capabilitiesFor(runtimeId).supportsSessionTools;
}

/**
 * 运行时 id 归一（网关唯一口径）：已知 ACP 运行时（内置＋custom）原样，
 * 空/未知/`codex-appserver` 一律回落默认 `codex-acp`
 * （绝不因拼写或旧客户端漂到不可用的链路）。
 */
export function resolveAgentRuntimeId(runtimeId?: string | undefined): string {
  if (runtimeId === 'custom') return 'custom';
  if (runtimeId && BUILTIN_ACP_RUNTIMES.some(entry => entry.id === runtimeId)) return runtimeId;
  return 'codex-acp';
}
