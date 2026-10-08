import { create } from 'zustand';

export interface AgentContextUsage {
  used: number;
  size: number;
  at: number;
}

interface AgentContextUsageState {
  usage: AgentContextUsage | null;
  setUsage: (usage: { used: number; size: number } | null | undefined) => void;
}

/** ACP 上下文用量（usage_update 只读透传，会话级最新值；配额类无 ACP 对应物，不在此）。 */
export const useAgentContextUsageStore = create<AgentContextUsageState>()((set) => ({
  usage: null,
  setUsage: (usage) => set(usage ? { usage: { ...usage, at: Date.now() } } : { usage: null }),
}));
