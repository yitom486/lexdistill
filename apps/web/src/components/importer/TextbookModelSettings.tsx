import { useAgentModelsQuery } from '../../queries/useAgentQueries.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { ImportOptions } from './ImportOptions.js';

export function TextbookModelSettings({ model, effort, onModel, onEffort, pending }: {
  model: string; effort: string; onModel: (value: string) => void; onEffort: (value: string) => void; pending: boolean;
}) {
  const models = useAgentModelsQuery();
  const choices = models.data ?? [];
  const selected = choices.find(item => (item.id || item.model) === model);
  const efforts = selected?.supportedReasoningEfforts ?? [];
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2">整理模型
        <Select value={model || '__default__'} onValueChange={value => value && onModel(value === '__default__' ? '' : value)} disabled={pending}>
          <SelectTrigger aria-label="教材提取模型"><SelectValue>{selected?.displayName || model || '跟随本机配置'}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="__default__">跟随本机配置</SelectItem>
            {model && !selected && <SelectItem value={model}>{model}</SelectItem>}
            {choices.map(item => <SelectItem key={item.id || item.model} value={item.id || item.model}>{item.displayName || item.model}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-2">思考等级
        {efforts.length ? <Select value={effort || '__default__'} onValueChange={value => value && onEffort(value === '__default__' ? '' : value)} disabled={pending}>
          <SelectTrigger aria-label="教材提取思考等级"><SelectValue>{effort || '跟随本机配置'}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="__default__">跟随本机配置</SelectItem>
            {effort && !efforts.includes(effort) && <SelectItem value={effort}>{effort}</SelectItem>}
            {efforts.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent>
        </Select> : <input aria-label="教材提取思考等级" value={effort} onChange={event => onEffort(event.target.value.trim())} disabled={pending} placeholder="跟随本机配置" className="block w-full rounded-lg border border-line bg-surface p-2 text-ink" />}
      </label>
    </div>
    {models.isError && <p className="text-xs text-ink-muted">暂时无法读取模型列表，可使用已保存的模型或填写本机模型标识。</p>}
    <ImportOptions title="自定义模型标识">
      <input aria-label="自定义教材提取模型" value={model} onChange={event => onModel(event.target.value.trim())} disabled={pending} placeholder="留空跟随本机配置" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
    </ImportOptions>
    <p className="text-xs leading-5 text-ink-muted">可优先使用轻量模型。模型和思考等级会记住你的选择。</p>
  </div>;
}
