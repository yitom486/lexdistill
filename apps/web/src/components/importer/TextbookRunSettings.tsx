import { TextbookPipelineSettingsSchema, type TextbookPipelineSettings } from '@study-studio/document-model';

type NumericSetting = { [K in keyof TextbookPipelineSettings]: TextbookPipelineSettings[K] extends number ? K : never }[keyof TextbookPipelineSettings];

export function TextbookRunSettings({ settings, onChange, pending }: {
  settings: TextbookPipelineSettings; onChange: (value: Partial<TextbookPipelineSettings>) => void; pending: boolean;
}) {
  const fields: Array<{ key: Exclude<NumericSetting, 'poolSize'>; label: string }> = [
    { key: 'queueCapacity', label: '待处理队列容量' },
    { key: 'modelRetries', label: '模型重试次数' }, { key: 'toolRepairRetries', label: '工具修正次数' },
    { key: 'storageRetries', label: '保存重试次数' }, { key: 'firstResponseTimeoutMs', label: '首响应超时（毫秒）' },
    { key: 'stallTimeoutMs', label: '无活动超时（毫秒）' },
  ];
  return <div className="grid gap-3 sm:grid-cols-2">{fields.map(({ key, label }) => <label key={key} className="flex items-center justify-between gap-3 text-xs">
    {label}<input aria-label={label} type="number" step="1" min={key === 'queueCapacity' || key.endsWith('TimeoutMs') ? 1 : 0} value={settings[key] ?? TextbookPipelineSettingsSchema.shape[key].parse(undefined)} disabled={pending}
      onChange={event => { const value = Number(event.target.value); if (TextbookPipelineSettingsSchema.shape[key].safeParse(value).success) onChange({ [key]: value }); }}
      className="w-24 rounded-lg border border-line bg-surface p-2 text-ink" />
  </label>)}</div>;
}
