import { ArrowRight } from 'lucide-react';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Switch } from '../ui/switch.js';
import { Button } from '../ui/button.js';
import { ImportOptions } from './ImportOptions.js';
import { TextbookModelSettings } from './TextbookModelSettings.js';
import { TextbookRunSettings } from './TextbookRunSettings.js';

interface Props {
  forceOverwrite: boolean;
  onForceOverwrite: (value: boolean) => void;
  pending: boolean;
  onStart: () => void;
}

export function TextbookExtractionSettings({ forceOverwrite, onForceOverwrite, pending, onStart }: Props) {
  const model = usePreferencesStore(s => s.pipelineModel);
  const setModel = usePreferencesStore(s => s.setPipelineModel);
  const effort = usePreferencesStore(s => s.pipelineEffort);
  const setEffort = usePreferencesStore(s => s.setPipelineEffort);
  const poolSize = usePreferencesStore(s => s.pipelinePoolSize);
  const setPoolSize = usePreferencesStore(s => s.setPipelinePoolSize);
  const settings = usePreferencesStore(s => s.pipelineSettings);
  const setSettings = usePreferencesStore(s => s.setPipelineSettings);
  const language = usePreferencesStore(s => s.pipelineLanguage);
  const setLanguage = usePreferencesStore(s => s.setPipelineLanguage);
  return <section aria-label="内容整理设置" className="space-y-5 text-sm text-ink">
    <div><h3 className="font-serif text-xl font-semibold">准备开始学习</h3>
      <p className="mt-2 leading-6 text-ink-muted">按一级章节裁剪 PDF，由连续 Worker 读取文件，按实际内容整理词汇、知识点、练习、文章和句子。{forceOverwrite ? '本次将重新整理已保存内容。' : '已整理好的章节会保留并跳过。'}</p>
    </div>
    <label className="block max-w-xs space-y-2">教材语种
      <Select value={language} onValueChange={value => { if (value === 'ja' || value === 'en' || value === 'ko') setLanguage(value); }} disabled={pending}>
        <SelectTrigger aria-label="教材语种"><SelectValue>{language === 'en' ? '英语' : language === 'ko' ? '韩语' : '日语'}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="ja">日语</SelectItem><SelectItem value="en">英语</SelectItem><SelectItem value="ko">韩语</SelectItem></SelectContent>
      </Select>
    </label>
    <ImportOptions title="模型与并发" summary={`${model || '跟随本机模型'} · ${effort || '默认思考等级'} · ${poolSize} 个 Worker`}>
      <TextbookModelSettings model={model} effort={effort} onModel={setModel} onEffort={setEffort} pending={pending} />
      <label className="flex items-center justify-between gap-3">并发 Worker 数量
        <input aria-label="教材提取并发数量" type="number" min="1" step="1" value={poolSize} onChange={event => setPoolSize(event.target.value)} disabled={pending} className="w-24 rounded-lg border border-line bg-surface p-2 text-ink" />
      </label>
      <p className="text-xs text-ink-muted">并发越高，资源与模型额度消耗越大。</p>
    </ImportOptions>
    <ImportOptions title="更多设置" summary="补充习题与重新整理" defaultOpen={forceOverwrite}>
      <label className="flex items-center justify-between gap-3">允许 AI 补充习题
        <Switch aria-label="允许 AI 补充习题" checked={settings.allowAiExercises} onCheckedChange={allowAiExercises => setSettings({ allowAiExercises })} disabled={pending} />
      </label>
      <label className="flex items-center justify-between gap-3">重新整理已保存内容
        <Switch aria-label="重新整理已保存内容" checked={forceOverwrite} onCheckedChange={onForceOverwrite} disabled={pending} />
      </label>
      <p className="text-xs leading-5 text-ink-muted">开启重新整理后，成功保存的章节会替换原内容。</p>
      <ImportOptions title="等待与重试" summary="通常无需调整"><TextbookRunSettings settings={settings} onChange={setSettings} pending={pending} /></ImportOptions>
    </ImportOptions>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
      <p className="text-xs text-ink-muted">设置会记住，下次无需重新填写。</p>
      <Button disabled={pending} onClick={onStart}>{pending ? '正在启动…' : '开始整理教材'}<ArrowRight className="h-4 w-4" /></Button>
    </div>
  </section>;
}
