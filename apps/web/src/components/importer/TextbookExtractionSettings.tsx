import { useAgentModelsQuery } from '../../queries/useAgentQueries.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Switch } from '../ui/switch.js';
import { Button } from '../ui/button.js';

interface Props {
  forceOverwrite: boolean;
  onForceOverwrite: (value: boolean) => void;
  pending: boolean;
  onStart: () => void;
}

export function TextbookExtractionSettings({ forceOverwrite, onForceOverwrite, pending, onStart }: Props) {
  const models = useAgentModelsQuery();
  const model = usePreferencesStore((s) => s.pipelineModel);
  const setModel = usePreferencesStore((s) => s.setPipelineModel);
  const effort = usePreferencesStore((s) => s.pipelineEffort);
  const setEffort = usePreferencesStore((s) => s.setPipelineEffort);
  const selectedModel = models.data?.find((item) => (item.id || item.model) === model);
  const poolSize = usePreferencesStore((s) => s.pipelinePoolSize);
  const setPoolSize = usePreferencesStore((s) => s.setPipelinePoolSize);
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-xs">
      <h3 className="font-semibold text-ink">内容提取配置</h3>
      <label className="block space-y-1 text-ink">提取模型
        <Select value={model || '__default__'} onValueChange={(value) => value && setModel(value === '__default__' ? '' : value)} disabled={pending}>
          <SelectTrigger aria-label="教材提取模型"><SelectValue placeholder="跟随本机配置" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">跟随本机配置</SelectItem>
            {(models.data ?? []).map((item) => <SelectItem key={item.id || item.model} value={item.id || item.model}>{item.displayName || item.model}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      {models.isError && <p className="text-ink-muted">模型列表暂时无法读取，可填写本机已配置的模型标识。</p>}
      <input aria-label="自定义教材提取模型" value={model} onChange={(event) => setModel(event.target.value.trim())} disabled={pending} placeholder="或输入本机模型标识，留空跟随配置" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
      <p className="text-ink-muted">结构化提取可优先选择本机提供的轻量模型。模型和思考等级由你选择并记住。</p>
      <label className="block space-y-1 text-ink">思考等级
        {selectedModel?.supportedReasoningEfforts?.length ? (
          <Select value={effort || '__default__'} onValueChange={(value) => value && setEffort(value === '__default__' ? '' : value)} disabled={pending}>
            <SelectTrigger aria-label="教材提取思考等级"><SelectValue placeholder="跟随本机配置" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">跟随本机配置</SelectItem>
              {selectedModel.supportedReasoningEfforts.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <input aria-label="教材提取思考等级" value={effort} onChange={(event) => setEffort(event.target.value.trim())} disabled={pending} placeholder="留空跟随本机配置" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />}
      </label>
      <label className="flex items-center gap-2 text-ink">并发 Worker 数量
        <input aria-label="教材提取并发数量" type="number" min="1" step="1" value={poolSize} onChange={(event) => setPoolSize(event.target.value)} disabled={pending} className="w-20 rounded-lg border border-line bg-surface p-2" />
      </label>
      <p className="text-ink-muted">并发越高，资源与模型额度消耗越大。默认会保留并跳过已就绪课次。</p>
      <label className="flex items-center justify-between gap-3 text-ink">重新提取并覆盖已保存内容
        <Switch checked={forceOverwrite} onCheckedChange={onForceOverwrite} disabled={pending} />
      </label>
      <Button disabled={pending} onClick={onStart}>{pending ? '正在启动…' : '开始提取并保存教材'}</Button>
    </section>
  );
}
