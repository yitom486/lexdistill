import { useAgentModelsQuery } from '../../queries/useAgentQueries.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Switch } from '../ui/switch.js';
import { Button } from '../ui/button.js';
import { TextbookPipelineSettingsSchema, type TextbookPipelineSettings } from '@study-studio/document-model';
import { TextbookParserSettings } from './TextbookParserSettings.js';

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
  const settings = usePreferencesStore((s) => s.pipelineSettings);
  const setSettings = usePreferencesStore((s) => s.setPipelineSettings);
  const language = usePreferencesStore((s) => s.pipelineLanguage);
  const setLanguage = usePreferencesStore((s) => s.setPipelineLanguage);
  type NumericSetting = { [K in keyof TextbookPipelineSettings]: TextbookPipelineSettings[K] extends number ? K : never }[keyof TextbookPipelineSettings];
  const budgetFields: Array<{ key: Exclude<NumericSetting, 'poolSize'>; label: string }> = [
    { key: 'parseConcurrency', label: '同时提取的章节数' }, { key: 'queueCapacity', label: '待提交队列容量' },
    { key: 'parsePageLimit', label: '每个解析任务最多页数' }, { key: 'parseTimeoutMs', label: '解析等待超时（毫秒）' },
    { key: 'parseRetries', label: '解析重试次数' }, { key: 'modelRetries', label: '模型新轮重试次数' }, { key: 'toolRepairRetries', label: '每轮工具修正次数' }, { key: 'storageRetries', label: '保存重试次数' },
    { key: 'firstResponseTimeoutMs', label: '模型首响应超时（毫秒）' }, { key: 'stallTimeoutMs', label: '模型无活动超时（毫秒）' },
  ];
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-xs">
      <h3 className="font-semibold text-ink">内容提取配置</h3>
      <TextbookParserSettings settings={settings} onChange={setSettings} pending={pending} />
      <label className="block space-y-1 text-ink">教材语种
        <Select value={language} onValueChange={(value) => { if (value === 'ja' || value === 'en' || value === 'ko') setLanguage(value); }} disabled={pending}>
          <SelectTrigger aria-label="教材语种"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ja">日语</SelectItem><SelectItem value="en">英语</SelectItem><SelectItem value="ko">韩语</SelectItem></SelectContent>
        </Select>
      </label>
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {budgetFields.map(({ key, label }) => (
          <label key={key} className="flex items-center justify-between gap-2 text-ink">{label}
            <input aria-label={label} type="number" step="1" min={key === 'parseConcurrency' || key === 'queueCapacity' || key.endsWith('TimeoutMs') ? 1 : 0} value={settings[key] ?? TextbookPipelineSettingsSchema.shape[key].parse(undefined)} disabled={pending}
              onChange={event => { const value = Number(event.target.value); if (TextbookPipelineSettingsSchema.shape[key].safeParse(value).success) setSettings({ [key]: value }); }}
              className="w-20 rounded-lg border border-line bg-surface p-2" />
          </label>
        ))}
      </div>
      <p className="text-ink-muted">每轮工具修正次数控制同一会话轮次内的重新提交；用尽后结束该轮，再按模型新轮重试次数处理。引擎内部重试单独显示，不延长所选等待期限。</p>
      <p className="text-ink-muted">扫描正文使用你选择的解析方式，数字原生 PDF 直接读取文字。章节数控制同时处理的章节；队列满后等待模型消费。停止后不再发送新章节，正在执行的 OCR 或已被云端接受的任务可能继续完成当前处理，其迟到结果不会落库。</p>
      <label className="flex items-center justify-between gap-3 text-ink">允许 AI 补充习题（单独标注来源）
        <Switch checked={settings.allowAiExercises} onCheckedChange={allowAiExercises => setSettings({ allowAiExercises })} disabled={pending} />
      </label>
      <label className="flex items-center justify-between gap-3 text-ink">重新提取并覆盖已保存内容
        <Switch checked={forceOverwrite} onCheckedChange={onForceOverwrite} disabled={pending} />
      </label>
      <Button disabled={pending || (settings.parserBackend === 'mineru-local' && !settings.mineruLocalUrl)} onClick={onStart}>{pending ? '正在启动…' : '开始提取并保存教材'}</Button>
    </section>
  );
}
