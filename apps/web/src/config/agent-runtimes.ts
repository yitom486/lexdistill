/**
 * Agent 运行时选项（UI 侧静态目录；id 与 @yitom/acp-client BUILTIN 运行时对齐）。
 * 后端 `GET /api/agent/runtimes` 上线后由其补充认证状态；选择只做持久化，
 * 经 agentOptions.runtimeId 下发，网关按 runtime 选适配器（Phase 1b）。
 */
export const DEFAULT_AGENT_RUNTIME_ID = 'codex-acp';

export interface AgentRuntimeOption {
  id: string;
  label: string;
  hint: string;
}

export const AGENT_RUNTIME_OPTIONS: readonly AgentRuntimeOption[] = [
  { id: 'codex-acp', label: 'ChatGPT', hint: '复用本机 Codex 登录' },
  { id: 'claude', label: 'Claude', hint: 'Claude Code 登录或 Key' },
  { id: 'gemini', label: 'Gemini', hint: 'OAuth 或 API Key' },
  { id: 'copilot', label: 'Copilot', hint: 'GitHub 登录' },
  { id: 'opencode', label: 'OpenCode', hint: 'opencode 登录' },
  { id: 'cursor-cli', label: 'Cursor', hint: 'Cursor 登录或 Key' },
  { id: 'deepseek', label: 'DeepSeek', hint: 'DEEPSEEK_API_KEY' },
  { id: 'agy', label: 'agy', hint: '官方桥接免密' },
] as const;

export function agentRuntimeLabel(id: string | undefined): string {
  if (!id) return 'ChatGPT';
  return AGENT_RUNTIME_OPTIONS.find(option => option.id === id)?.label ?? 'ChatGPT';
}
