import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useAgentContextUsageStore } from '../stores/useAgentContextUsageStore.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { AGENT_RUNTIME_OPTIONS, agentRuntimeLabel } from '../config/agent-runtimes.js';
import { useAgentRuntimesQuery } from '../queries/useAgentQueries.js';
import { chatMenuItem, compactSelect } from './agent-chat/chat-shared.js';

interface AgentRuntimeSelectProps {
  disabled?: boolean;
  onCustomApi?: () => void;
  /** 运行时真正切换时触发（custom 入口不触发）：调用方据此重置会话。 */
  onRuntimeChange?: (previous: string, next: string) => void;
}

/**
 * Agent 运行时下拉（自读写偏好）：ChatGPT 默认；自定义 API 默认进设置页（可被覆盖）。
 * 模型 id 不跨运行时通用：切换时存档当前选择并恢复目标槽位（空=运行时默认），互不串味。
 */
export function AgentRuntimeSelect({ disabled, onCustomApi, onRuntimeChange }: AgentRuntimeSelectProps) {
  const agentRuntimeId = usePreferencesStore(state => state.agentRuntimeId);
  const setAgentRuntimeId = usePreferencesStore(state => state.setAgentRuntimeId);
  const setActiveTab = useStudySessionStore(state => state.setActiveTab);
  const { data: statuses = [] } = useAgentRuntimesQuery(true);
  const statusOf = (id: string) => statuses.find(entry => entry.id === id)?.configured ?? null;
  const goCustomApi = onCustomApi ?? (() => setActiveTab('SETTINGS'));

  const switchRuntime = (value: string) => {
    const prev = agentRuntimeId || 'codex-acp';
    if (!value || value === prev) return;
    const state = usePreferencesStore.getState();
    state.setRuntimeModel(prev, state.coachModelId);
    state.setRuntimeEffort(prev, state.coachEffort);
    state.setCoachModelId(state.runtimeModels[value] ?? '');
    state.setCoachEffort(state.runtimeEfforts[value] ?? '');
    // 上下文用量是按会话的：切运行时即失效，不拿别家的数字充数。
    useAgentContextUsageStore.getState().setUsage(null);
    setAgentRuntimeId(value);
    setAgentRuntimeId(value);
    onRuntimeChange?.(prev, value);
  };

  return (
    <Select
      value={agentRuntimeId || 'codex-acp'}
      onValueChange={(value) => {
        if (value === '__custom__') {
          goCustomApi();
          return;
        }
        if (value) switchRuntime(String(value));
      }}
      {...(disabled ? { disabled: true as const } : {})}
    >
      <SelectTrigger className={`${compactSelect} max-w-[10rem]`} aria-label="选择 Agent 运行时">
        <SelectValue>{agentRuntimeLabel(agentRuntimeId)}</SelectValue>
      </SelectTrigger>
      <SelectContent className="border-line bg-paper-soft text-ink">
        <div className="px-2 py-1 text-[10px] text-ink-ghost">切换 Agent 运行时</div>
        {AGENT_RUNTIME_OPTIONS.map(option => {
          const configured = statusOf(option.id);
          return (
            <SelectItem key={option.id} value={option.id} className={chatMenuItem}>
              {option.label}{configured === false ? '（未配置）' : ''}
            </SelectItem>
          );
        })}
        <div className="px-2 py-1 text-[10px] text-ink-ghost">认证 / 供应商</div>
        <SelectItem value="__custom__" className={chatMenuItem}>
          自定义 API…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
