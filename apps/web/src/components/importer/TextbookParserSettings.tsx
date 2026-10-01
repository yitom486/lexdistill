import { TextbookPipelineSettingsSchema, type TextbookPipelineSettings } from '@study-studio/document-model';
import { useTextbookParserConfig } from '../../queries/textbook-import-monitor.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';

export function TextbookParserSettings({ settings, onChange, pending }: { settings: TextbookPipelineSettings; onChange: (value: Partial<TextbookPipelineSettings>) => void; pending: boolean }) {
  const config = useTextbookParserConfig();
  return <div className="space-y-3 rounded-xl border border-line-soft p-3">
    <label className="block space-y-1 text-ink">扫描正文解析方式
      <Select value={settings.parserBackend} disabled={pending} onValueChange={value => { const parsed = TextbookPipelineSettingsSchema.shape.parserBackend.safeParse(value); if (parsed.success) onChange({ parserBackend: parsed.data }); }}>
        <SelectTrigger aria-label="扫描正文解析方式"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="mineru-cloud">MinerU 云端精准解析</SelectItem><SelectItem value="mineru-local">MinerU 本地部署</SelectItem></SelectContent>
      </Select>
    </label>
    {settings.parserBackend === 'mineru-cloud' ? <>
      <p className="text-ink-muted">扫描章节上传到 MinerU 云端解析，Token 由本机 Gateway 读取。数字原生 PDF 直接提取文字。</p>
      {config.isPending ? <p>正在检测本机云端凭据…</p> : config.isError ? <p role="alert">{config.error.message}</p> : <p role={config.data?.cloudTokenConfigured ? undefined : 'alert'}>{config.data?.cloudTokenConfigured ? '本机已配置云端 Token（未验证有效性或额度）' : '本机未配置云端 Token。解析扫描正文前请配置 MINERU_TOKEN，或选择已部署的本地服务。'}</p>}
    </> : <>
      <label className="block space-y-1 text-ink">本地 MinerU 服务地址
        <input aria-label="本地 MinerU 服务地址" value={settings.mineruLocalUrl} disabled={pending} onChange={event => onChange({ mineruLocalUrl: event.target.value.trim() })} placeholder="填写已经启动的本机 V1 服务地址" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
      </label>
      <label className="block space-y-1 text-ink">本地解析档位
        <Select value={settings.mineruLocalTier} disabled={pending} onValueChange={value => { const parsed = TextbookPipelineSettingsSchema.shape.mineruLocalTier.safeParse(value); if (parsed.success) onChange({ mineruLocalTier: parsed.data }); }}>
          <SelectTrigger aria-label="本地解析档位"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="basic">Basic</SelectItem><SelectItem value="standard">Standard</SelectItem><SelectItem value="advanced">Advanced</SelectItem></SelectContent>
        </Select>
      </label>
      <p className="text-ink-muted">需要你先部署并启动 MinerU V1 服务。本应用只调用该服务；档位须由服务支持。首次本地运行建议解析并发设为 1。</p>
    </>}
    <label className="block space-y-1 text-ink">扫描识别语言
      <Select value={settings.parserLanguage} disabled={pending} onValueChange={value => { const parsed = TextbookPipelineSettingsSchema.shape.parserLanguage.safeParse(value); if (parsed.success) onChange({ parserLanguage: parsed.data }); }}>
        <SelectTrigger aria-label="扫描识别语言"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="ch">中文／英文</SelectItem><SelectItem value="japan">日语／中日英混排</SelectItem><SelectItem value="en">英语</SelectItem><SelectItem value="korean">韩语／英文</SelectItem></SelectContent>
      </Select>
    </label>
    <p className="text-ink-muted">识别语言用于云端解析请求；本地由已部署模型处理。教材学习语种另行设置。</p>
  </div>;
}
