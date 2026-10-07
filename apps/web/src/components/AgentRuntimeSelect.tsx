import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { AGENT_RUNTIME_OPTIONS, agentRuntimeLabel } from '../config/agent-runtimes.js';
import { chatMenuItem, compactSelect } from './agent-chat/chat-shared.js';

interface AgentRuntimeSelectProps {
  disabled?: boolean;
  onCustomApi?: () => void;
}

/** Agent 运行时下拉（自读写偏好）：ChatGPT 默认；自定义 API 走 onCustomApi（未传则隐藏入口）。 */
export function AgentRuntimeSelect({ disabled, onCustomApi }: AgentRuntimeSelectProps) {
  const agentRuntimeId = usePreferencesStore(state => state.agentRuntimeId);
  const setAgentRuntimeId = usePreferencesStore(state => state.setAgentRuntimeId);
  return (
    <Select
      value={agentRuntimeId || 'codex-acp'}
      onValueChange={(value) => {
        if (value === '__custom__') {
          onCustomApi?.();
          return;
        }
        if (value) setAgentRuntimeId(String(value));
      }}
      {...(disabled ? { disabled: true as const } : {})}
    >
      <SelectTrigger className={`${compactSelect} max-w-[10rem]`} aria-label="选择 Agent 运行时">
        <SelectValue>{agentRuntimeLabel(agentRuntimeId)}</SelectValue>
      </SelectTrigger>
      <SelectContent className="border-line bg-paper-soft text-ink">
        <div className="px-2 py-1 text-[10px] text-ink-ghost">切换 Agent 运行时</div>
        {AGENT_RUNTIME_OPTIONS.map(option => (
          <SelectItem key={option.id} value={option.id} className={chatMenuItem}>
            {option.label}
          </SelectItem>
        ))}
        {onCustomApi && (
          <>
            <div className="px-2 py-1 text-[10px] text-ink-ghost">认证 / 供应商</div>
            <SelectItem value="__custom__" className={chatMenuItem}>
              自定义 API…
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
