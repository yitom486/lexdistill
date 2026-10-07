import { BUILTIN_ACP_RUNTIMES, probeCodexAuth } from '@yitom/acp-client';

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
  }));
}

/**
 * 会话适配器选型：codex-acp 在 ACP parity（模型/思考深度映射）验证前沿用
 * Codex App Server，默认行为零变；显式切其他已知运行时走 ACP。
 * 空/未知 runtimeId 回落 codex（旧网关/旧前端兼容，绝不因拼写漂到新链路）。
 */
const ACP_RUNTIME_IDS: ReadonlySet<string> = new Set(
  BUILTIN_ACP_RUNTIMES.map(entry => entry.id).filter(id => id !== 'codex-acp'),
);

export function resolveSessionAdapterId(runtimeId?: string | undefined): 'codex' | 'acp' {
  return !!runtimeId && ACP_RUNTIME_IDS.has(runtimeId) ? 'acp' : 'codex';
}
