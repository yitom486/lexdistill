import { TtsServiceSettings } from './tts/TtsServiceSettings.js';
import { useState } from 'react';
import { ChevronDown, SlidersHorizontal, Database } from 'lucide-react';
import { Switch } from './ui/switch.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible.js';
import { useTtsDefaultsQuery } from '../queries/tts-defaults.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import type { SupportedLanguage } from '../utils/audio.js';
import { TtsModelPicker } from './tts/TtsModelPicker.js';
import { TtsVoiceLibrary } from './tts/TtsVoiceLibrary.js';
import { TtsPreviewBar } from './tts/TtsPreviewBar.js';
import { AudioCacheManager } from './audio/AudioCacheManager.js';

export function TtsStudioSettings({ lang }: { lang: SupportedLanguage }) {
  const [userText, setUserText] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [cacheSectionOpen, setCacheSectionOpen] = useState(false);


  const { voiceId, voiceIdMale, voiceIdFemale, modelId, saveAudioCache, setSaveAudioCache } = useTtsStore();

  const defaults = useTtsDefaultsQuery();
  const serverText = defaults.data?.previewTexts[lang.toLowerCase()] ?? '';
  const effectiveText = userText.trim() || serverText;
  // 试音文案占位必须区分三态：读取中 / 读取失败（可重试，绝不显示“正在同步”）/ 网关未下发。
  const previewPlaceholder = defaults.isPending
    ? '正在同步试音文案…'
    : defaults.isError
      ? '试音文案读取失败，可直接输入句子试听。'
      : serverText || '暂无服务端试音文案，可输入句子试听。';

  return (
    <section id="settings-speech" className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-8">
      <h2 className="text-2xl font-semibold text-ink">语音朗读</h2>

      <TtsServiceSettings lang={lang} />

      {/* 核心试音操作条（高频使用，始终置顶） */}
      <TtsPreviewBar lang={lang} serverText={serverText} previewPlaceholder={previewPlaceholder} userText={userText} onUserTextChange={setUserText} />

      <div className="mt-4 border-t border-line pt-4 text-xs text-ink-mute">
        {defaults.isPending ? (
          <p>正在同步网关试音配置…</p>
        ) : defaults.isError ? (
          <p className="flex flex-wrap items-center gap-2">
            <span>试音文案读取失败，请检查网关后重试。</span>
            <button
              type="button"
              onClick={() => void defaults.refetch()}
              className="underline underline-offset-2 text-accent-ink-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
            >
              重新读取
            </button>
          </p>
        ) : serverText ? (
          <p>{`当前轨道默认试音：${serverText}`}</p>
        ) : (
          <p>网关未下发当前轨道试音文案，可在上方输入句子试听。</p>
        )}
      </div>

      {/* 折叠区域 1：模型与音色选择 */}
      <div className="mt-6 border-t border-line pt-6">
        <Collapsible open={modelPickerOpen} onOpenChange={setModelPickerOpen} className="space-y-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface-soft p-4 text-left transition-colors hover:bg-surface-soft/80">
            <div className="flex items-center gap-3">
              <SlidersHorizontal className="h-4 w-4 text-ink-mute" />
              <div>
                <h4 className="text-sm font-semibold text-ink">高级配置：模型与音色库</h4>
                <p className="text-xs text-ink-mute">
                  {modelId || voiceId || voiceIdMale || voiceIdFemale
                    ? `当前已选：${modelId || '默认模型'} · 默认(${voiceId || '默认'}) / 男声(${voiceIdMale || '默认'}) / 女声(${voiceIdFemale || '默认'})`
                    : '使用服务商默认推荐模型与音色'}
                </p>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-ink-mute transition-transform duration-[var(--motion-collapse-chevron-duration)] ${modelPickerOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="rounded-2xl border border-line bg-surface p-4">
            <div className="grid gap-6 lg:grid-cols-2">
              <TtsModelPicker />
              <TtsVoiceLibrary previewText={effectiveText} lang={lang} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* 折叠区域 2：本地音频缓存与存储管理 */}
      <div className="mt-4">
        <Collapsible open={cacheSectionOpen} onOpenChange={setCacheSectionOpen} className="space-y-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface-soft p-4 text-left transition-colors hover:bg-surface-soft/80">
            <div className="flex items-center gap-3">
              <Database className="h-4 w-4 text-ink-mute" />
              <div>
                <h4 className="text-sm font-semibold text-ink">存储与开销：音频本地缓存</h4>
                <p className="text-xs text-ink-mute">
                  {saveAudioCache ? '已开启保存音频（避免二次请求与 API 计费）' : '未开启本地保存'}
                </p>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-ink-mute transition-transform duration-[var(--motion-collapse-chevron-duration)] ${cacheSectionOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-5 rounded-2xl border border-line bg-surface p-5">
            {/* 开关：默认保存已生成音频 */}
            <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
              <div>
                <label htmlFor="tts-save-cache-toggle" className="text-sm font-medium text-ink cursor-pointer">
                  保存生成的音频（默认启用）
                </label>
                <p className="mt-0.5 text-xs text-ink-mute">
                  自动将生成的语音持久化保存在本机；重复朗读相同课文或句子时无需重新请求云端，零耗时且避免重复开销。
                </p>
              </div>
              <Switch
                id="tts-save-cache-toggle"
                aria-label="保存生成的音频"
                checked={saveAudioCache}
                onCheckedChange={setSaveAudioCache}
              />
            </div>

            {/* 音频缓存管理面板：用户可以指定清除哪些音频或全部清除 */}
            <div>
              <h5 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">
                已缓存音频管理
              </h5>
              <AudioCacheManager />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </section>
  );
}
