import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { useAgentModelsQuery } from '../queries/useAgentQueries.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { FALLBACK_EFFORTS, chatMenuItem, compactSelect, effortLabel } from './agent-chat/chat-shared.js';
import { AgentRuntimeSelect } from './AgentRuntimeSelect.js';
import { useSelectedRuntimeCaps } from '../hooks/useSelectedRuntimeCaps.js';

/** 单词面板精简配置（折叠）：模型＋思考深度，读写与主聊同一份偏好，选 luna 全局生效。 */
export function WordChatConfig() {
  const [open, setOpen] = useState(false);
  const coachModelId = usePreferencesStore(state => state.coachModelId);
  const setCoachModelId = usePreferencesStore(state => state.setCoachModelId);
  const coachEffort = usePreferencesStore(state => state.coachEffort);
  const setCoachEffort = usePreferencesStore(state => state.setCoachEffort);
  const runtimeCaps = useSelectedRuntimeCaps();
  const modelsQuery = useAgentModelsQuery(open && runtimeCaps.supportsModelPicker);
  const models = modelsQuery.data ?? [];
  const modelLabel = !runtimeCaps.supportsModelPicker
    ? '运行时自带'
    : models.find(model => model.id === coachModelId || model.model === coachModelId)?.displayName
      || coachModelId || '本机默认';
  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        aria-label="单词会话配置"
        onClick={() => setOpen(value => !value)}
        className="text-xs text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? '收起配置' : `模型 · ${modelLabel} · ${effortLabel(coachEffort || 'medium')}`}
      </button>
      {open && (
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <label className="block col-span-2">
            <span className="mb-0.5 block text-[10px] text-ink-ghost">Agent 运行时</span>
            <AgentRuntimeSelect />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-ink-ghost">
              模型{runtimeCaps.supportsModelPicker ? '' : '（运行时自带）'}
            </span>
            <Select value={coachModelId || '__default__'} onValueChange={value => setCoachModelId(value === '__default__' ? '' : String(value ?? ''))} disabled={!runtimeCaps.supportsModelPicker}>
              <SelectTrigger className={compactSelect} aria-label="选择模型">
                <SelectValue>{modelLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-line bg-paper-soft text-ink">
                <SelectItem value="__default__" className={chatMenuItem}>本机默认</SelectItem>
                {models.map(model => (
                  <SelectItem key={model.id || model.model} value={model.id || model.model} className={chatMenuItem}>
                    {model.displayName || model.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-ink-ghost">
              思考深度{runtimeCaps.supportsEffort ? '' : '（运行时自带）'}
            </span>
            <Select value={coachEffort || 'medium'} onValueChange={value => value && setCoachEffort(String(value))} disabled={!runtimeCaps.supportsEffort}>
              <SelectTrigger className={compactSelect} aria-label="选择思考深度">
                <SelectValue>{effortLabel(coachEffort || 'medium')}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-line bg-paper-soft text-ink">
                {FALLBACK_EFFORTS.map(effort => (
                  <SelectItem key={effort} value={effort} className={chatMenuItem}>{effortLabel(effort)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      )}
    </div>
  );
}
