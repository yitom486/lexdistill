import { useAgentModelsQuery, useAgentRuntimeOptionsQuery } from '../../queries/useAgentQueries.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { useSelectedRuntimeCaps } from '../../hooks/useSelectedRuntimeCaps.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { ImportOptions } from './ImportOptions.js';

export function TextbookModelSettings({ model, effort, onModel, onEffort, pending, purpose = '教材提取' }: {
  model: string; effort: string; onModel: (value: string) => void; onEffort: (value: string) => void; pending: boolean;
  purpose?: string;
}) {
  const agentRuntimeId = usePreferencesStore(state => state.agentRuntimeId);
  const runtimeCaps = useSelectedRuntimeCaps();
  // Codex 通路沿用 App Server 目录；ACP 通路走运行时探针（与聊天下拉同一口径，档位按模型级联）。
  const useProbe = !!agentRuntimeId && !runtimeCaps.supportsModelPicker;
  const models = useAgentModelsQuery(!useProbe);
  const probe = useAgentRuntimeOptionsQuery(agentRuntimeId || 'codex-acp', useProbe, model || undefined);
  const choices = useProbe
    ? (probe.data?.models ?? []).map(item => ({ id: item.value, model: item.value, displayName: item.label }))
    : (models.data ?? []);
  const selected = choices.find(item => (item.id || item.model) === model);
  const efforts = useProbe
    ? (probe.data?.efforts ?? [])
    : (selected as { supportedReasoningEfforts?: string[] } | undefined)?.supportedReasoningEfforts ?? [];
  const listError = useProbe ? probe.data?.error : (models.isError ? 'error' : undefined);
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2">整理模型
        <Select value={model || '__default__'} onValueChange={value => value && onModel(value === '__default__' ? '' : value)} disabled={pending}>
          <SelectTrigger aria-label={`${purpose}模型`}><SelectValue>{selected?.displayName || model || '跟随本机配置'}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="__default__">跟随本机配置</SelectItem>
            {model && !selected && <SelectItem value={model}>{model}</SelectItem>}
            {choices.map(item => <SelectItem key={item.id || item.model} value={item.id || item.model}>{item.displayName || item.model}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-2">思考等级
        {efforts.length ? <Select value={effort || '__default__'} onValueChange={value => value && onEffort(value === '__default__' ? '' : value)} disabled={pending}>
          <SelectTrigger aria-label={`${purpose}思考等级`}><SelectValue>{effort || '跟随本机配置'}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="__default__">跟随本机配置</SelectItem>
            {effort && !efforts.includes(effort) && <SelectItem value={effort}>{effort}</SelectItem>}
            {efforts.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent>
        </Select> : <input aria-label={`${purpose}思考等级`} value={effort} onChange={event => onEffort(event.target.value.trim())} disabled={pending} placeholder="跟随本机配置" className="block w-full rounded-lg border border-line bg-surface p-2 text-ink" />}
      </label>
    </div>
    {listError && <p className="text-xs text-ink-muted">暂时无法读取模型列表，可使用已保存的模型或填写本机模型标识。</p>}
    <ImportOptions title="自定义模型标识">
      <input aria-label="自定义教材提取模型" value={model} onChange={event => onModel(event.target.value.trim())} disabled={pending} placeholder="留空跟随本机配置" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
    </ImportOptions>
    <p className="text-xs leading-5 text-ink-muted">可优先使用轻量模型。模型和思考等级会记住你的选择。</p>
  </div>;
}
