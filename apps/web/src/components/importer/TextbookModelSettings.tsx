import { useAgentModelsQuery, useAgentRuntimeOptionsQuery } from '../../queries/useAgentQueries.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { useSelectedRuntimeCaps } from '../../hooks/useSelectedRuntimeCaps.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { AgentRuntimeSelect } from '../AgentRuntimeSelect.js';
import { ImportOptions } from './ImportOptions.js';

export interface TextbookModelSettingsProps {
  runtimeId?: string | undefined;
  onRuntime?: ((value: string) => void) | undefined;
  model: string;
  effort: string;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  pending: boolean;
  purpose?: string | undefined;
}

export function TextbookModelSettings({
  runtimeId,
  onRuntime,
  model,
  effort,
  onModel,
  onEffort,
  pending,
  purpose = '教材提取',
}: TextbookModelSettingsProps) {
  const globalRuntimeId = usePreferencesStore(state => state.agentRuntimeId);
  const effectiveRuntimeId = runtimeId || globalRuntimeId || 'codex-acp';
  const runtimeCaps = useSelectedRuntimeCaps(effectiveRuntimeId);

  // Codex 通路沿用 App Server 目录；ACP 通路走运行时探针（与聊天下拉同一口径，档位按模型级联）。
  const useProbe = !!effectiveRuntimeId && !runtimeCaps.supportsModelPicker;
  const models = useAgentModelsQuery(!useProbe);
  const probe = useAgentRuntimeOptionsQuery(effectiveRuntimeId, useProbe, model || undefined);
  const choices = useProbe
    ? (probe.data?.models ?? []).map(item => ({ id: item.value, model: item.value, displayName: item.label }))
    : (models.data ?? []);
  const selected = choices.find(item => (item.id || item.model) === model);
  const efforts = useProbe
    ? (probe.data?.efforts ?? [])
    : (selected as { supportedReasoningEfforts?: string[] } | undefined)?.supportedReasoningEfforts ?? [];
  const listError = useProbe ? probe.data?.error : (models.isError ? 'error' : undefined);

  const handleRuntimeChange = (nextRuntime: string) => {
    onRuntime?.(nextRuntime);
    const store = usePreferencesStore.getState();
    const savedModel = store.runtimeModels[nextRuntime] ?? '';
    const savedEffort = store.runtimeEfforts[nextRuntime] ?? '';
    onModel(savedModel);
    onEffort(savedEffort);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <span className="text-xs font-medium text-ink">Agent 运行时</span>
          <AgentRuntimeSelect
            value={effectiveRuntimeId}
            onValueChange={handleRuntimeChange}
            disabled={pending}
            triggerClassName="w-full justify-between"
          />
        </div>

        <label className="space-y-2">
          <span className="text-xs font-medium text-ink">{purpose}模型</span>
          <Select
            value={selected ? (selected.id || selected.model) : '__default__'}
            onValueChange={value => {
              const next = value === '__default__' ? '' : (value || '');
              onModel(next);
              usePreferencesStore.getState().setRuntimeModel(effectiveRuntimeId, next);
            }}
            disabled={pending}
          >
            <SelectTrigger aria-label={`${purpose}模型`}>
              <SelectValue>{selected?.displayName || selected?.model || '跟随运行时默认'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">跟随运行时默认</SelectItem>
              {choices.map(item => (
                <SelectItem key={item.id || item.model} value={item.id || item.model}>
                  {item.displayName || item.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-ink">思考等级</span>
          {efforts.length ? (
            <Select
              value={efforts.includes(effort) ? effort : '__default__'}
              onValueChange={value => {
                const next = value === '__default__' ? '' : (value || '');
                onEffort(next);
                usePreferencesStore.getState().setRuntimeEffort(effectiveRuntimeId, next);
              }}
              disabled={pending}
            >
              <SelectTrigger aria-label={`${purpose}思考等级`}>
                <SelectValue>{efforts.includes(effort) ? effort : '跟随本机配置'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">跟随本机配置</SelectItem>
                {efforts.map(value => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <input
              aria-label={`${purpose}思考等级`}
              value={effort}
              onChange={event => {
                const next = event.target.value.trim();
                onEffort(next);
                usePreferencesStore.getState().setRuntimeEffort(effectiveRuntimeId, next);
              }}
              disabled={pending}
              placeholder="跟随本机配置"
              className="block w-full rounded-lg border border-line bg-surface p-2 text-ink text-sm"
            />
          )}
        </label>
      </div>

      {listError && (
        <p className="text-xs text-ink-muted">暂时无法读取模型列表，可使用已保存的模型或填写自定义模型标识。</p>
      )}

      <ImportOptions title="自定义模型标识">
        <input
          aria-label={`自定义${purpose}模型`}
          value={model}
          onChange={event => onModel(event.target.value.trim())}
          disabled={pending}
          placeholder="留空跟随运行时配置"
          className="w-full rounded-lg border border-line bg-surface p-2 text-ink text-sm"
        />
      </ImportOptions>

      <p className="text-xs leading-5 text-ink-muted">
        支持自由选择各 Agent 运行时（ChatGPT、Claude、Gemini、OpenCode、Copilot、Cursor 等），并按模型配置专属思考深度。
      </p>
    </div>
  );
}
