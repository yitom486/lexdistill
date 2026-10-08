import { useAgentRuntimesQuery } from '../queries/useAgentQueries.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';

/**
 * 当前选中运行时的能力开关（模型/思考深度控件据此禁用，禁止按 id 硬编码特例）。
 * 后端未返回或查询未就绪时全开（= 当前 Codex 默认行为，fail-open）。
 */
export function useSelectedRuntimeCaps(): {
  supportsModelPicker: boolean; supportsEffort: boolean; supportsThreads: boolean; supportsUsage: boolean;
} {
  const agentRuntimeId = usePreferencesStore(state => state.agentRuntimeId);
  const { data: statuses = [] } = useAgentRuntimesQuery(true);
  const caps = statuses.find(entry => entry.id === (agentRuntimeId || 'codex-acp'))?.capabilities;
  return {
    supportsModelPicker: caps?.supportsModelPicker ?? true,
    supportsEffort: caps?.supportsEffort ?? true,
    supportsThreads: caps?.supportsThreads ?? true,
    supportsUsage: caps?.supportsUsage ?? true,
  };
}
