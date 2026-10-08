import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { useAgentModelsQuery, useAgentRuntimeOptionsQuery } from '../queries/useAgentQueries.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { FALLBACK_EFFORTS, chatMenuItem, compactSelect, effortLabel } from './agent-chat/chat-shared.js';
import { AgentRuntimeSelect } from './AgentRuntimeSelect.js';
import { useSelectedRuntimeCaps } from '../hooks/useSelectedRuntimeCaps.js';

/** 单词面板精简配置（折叠）：运行时＋模型＋思考深度，读写与主聊同一份偏好。 */
export function WordChatConfig() {
  const [open, setOpen] = useState(false);
  const coachModelId = usePreferencesStore(state => state.coachModelId);
  const setCoachModelId = usePreferencesStore(state => state.setCoachModelId);
  const coachEffort = usePreferencesStore(state => state.coachEffort);
  const setCoachEffort = usePreferencesStore(state => state.setCoachEffort);
  const setLearningThreadId = usePreferencesStore(state => state.setLearningThreadId);
  const runtimeCaps = useSelectedRuntimeCaps();
  const agentRuntimeId = usePreferencesStore(state => state.agentRuntimeId);
  const modelsQuery = useAgentModelsQuery(open && runtimeCaps.supportsModelPicker);
  const models = modelsQuery.data ?? [];
  const runtimeOptions = useAgentRuntimeOptionsQuery(
    agentRuntimeId || 'codex-acp',
    open && !!agentRuntimeId,
  );
  const modelChoices = runtimeCaps.supportsModelPicker
    ? models.map(m => ({ value: m.id || m.model, label: m.displayName || m.model }))
    : (runtimeOptions.data?.models ?? []);
  const modelValue = modelChoices.some(m => m.value === coachModelId) ? coachModelId : '__auto__';
  const modelLabel = modelValue === '__auto__' ? '运行时默认' : (modelChoices.find(m => m.value === coachModelId)?.label || coachModelId || '本机默认');
  const effortChoices = runtimeCaps.supportsEffort ? [...FALLBACK_EFFORTS] : (runtimeOptions.data?.efforts ?? []);
  const effortValue = effortChoices.includes(coachEffort) ? coachEffort : '__auto__';
  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        aria-label="单词会话配置"
        onClick={() => setOpen(value => !value)}
        className="text-xs text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? '收起配置' : `模型 · ${modelLabel} · ${effortValue === '__auto__' ? '运行时默认' : effortLabel(effortValue)}`}
      </button>
      {open && (
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <label className="block col-span-2">
            <span className="mb-0.5 block text-[10px] text-ink-ghost">Agent 运行时</span>
            <AgentRuntimeSelect onRuntimeChange={() => setLearningThreadId('')} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-ink-ghost">
              模型{modelValue === '__auto__' ? '（运行时默认）' : ''}
            </span>
            <Select value={modelValue} onValueChange={value => setCoachModelId(value === '__auto__' ? '' : String(value ?? ''))} disabled={modelValue === '__auto__' && modelChoices.length === 0}>
              <SelectTrigger className={compactSelect} aria-label="选择模型">
                <SelectValue>{modelLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-line bg-paper-soft text-ink">
                <SelectItem value="__auto__" className={chatMenuItem}>运行时默认</SelectItem>
                {modelChoices.map(model => (
                  <SelectItem key={model.value} value={model.value} className={chatMenuItem}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-ink-ghost">
              思考深度{effortValue === '__auto__' ? '（运行时默认）' : ''}
            </span>
            <Select value={effortValue} onValueChange={value => value && setCoachEffort(value === '__auto__' ? '' : String(value))} disabled={effortValue === '__auto__' && effortChoices.length === 0}>
              <SelectTrigger className={compactSelect} aria-label="选择思考深度">
                <SelectValue>{effortValue === '__auto__' ? '运行时默认' : effortLabel(effortValue)}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-line bg-paper-soft text-ink">
                <SelectItem value="__auto__" className={chatMenuItem}>运行时默认</SelectItem>
                {effortChoices.map(effort => (
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
