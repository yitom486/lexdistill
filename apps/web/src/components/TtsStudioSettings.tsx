import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createTTSClient } from 'gemini-tts-studio/client';
import { ChevronDown, SlidersHorizontal, Database, Play, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button.js';
import { Switch } from './ui/switch.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible.js';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { buildTtsStreamBody, fetchTtsStream } from '../lib/tts-stream.js';
import { audioChunksToBlob } from '../lib/pcm-audio.js';
import { useTtsDefaultsQuery } from '../queries/tts-defaults.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import type { SupportedLanguage } from '../utils/audio.js';
import { TtsModelPicker } from './tts/TtsModelPicker.js';
import { TtsVoiceLibrary } from './tts/TtsVoiceLibrary.js';
import { TtsPreviewBar } from './tts/TtsPreviewBar.js';
import { AudioCacheManager } from './audio/AudioCacheManager.js';

const fieldClass = 'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring';

function ApiKeyField({
  label,
  value,
  onChange,
  onTest,
  isTesting,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  onTest: () => void;
  isTesting: boolean;
  placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-ink">{label}</label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isTesting}
          onClick={onTest}
          className="h-7 px-2 text-xs text-ink-soft hover:text-ink cursor-pointer"
        >
          {isTesting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
          测试有效性
        </Button>
      </div>
      <input
        className={`${fieldClass} mt-1.5`}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function TtsStudioSettings({ lang }: { lang: SupportedLanguage }) {
  const [userText, setUserText] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [cacheSectionOpen, setCacheSectionOpen] = useState(false);
  const [testingKey, setTestingKey] = useState<'primary' | 'backup' | null>(null);

  const {
    preferredService, providerApiKeys, backupApiKeys, azureRegion, localBaseUrl,
    voiceId, voiceIdMale, voiceIdFemale, modelId, saveAudioCache,
    setPreferredService, setProviderApiKey, setBackupApiKey, setAzureRegion,
    setLocalBaseUrl, setVoiceId, setModelId, setSaveAudioCache, stop,
  } = useTtsStore();

  const providers = useQuery({
    queryKey: ['tts-studio', 'providers', GATEWAY_BASE_URL],
    queryFn: () => createTTSClient({ baseUrl: GATEWAY_BASE_URL, prefix: '/api/tts-studio' }).getProviders(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const defaults = useTtsDefaultsQuery();
  const serverText = defaults.data?.previewTexts[lang.toLowerCase()] ?? '';
  const effectiveText = userText.trim() || serverText;

  const chooseService = (service: string) => {
    if (service === preferredService) return;
    stop();
    setVoiceId('');
    setModelId('');
    setPreferredService(service);
  };

  const handleTestKey = async (type: 'primary' | 'backup') => {
    if (!preferredService) {
      toast.info('当前为服务默认模式，无需配置 API Key');
      return;
    }
    const key = type === 'primary' ? (providerApiKeys[preferredService] ?? '') : (backupApiKeys[preferredService] ?? '');
    const label = type === 'primary' ? '主用 API Key' : '备用 API Key';
    if (!key.trim()) {
      toast.warning(`请先输入${label}`);
      return;
    }
    setTestingKey(type);
    try {
      const startTime = Date.now();
      const testVoice = voiceId || (preferredService === 'azure' ? 'ja-JP-NanamiNeural' : 'Puck');
      const testModel = preferredService === 'gemini' ? (modelId || 'gemini-2.5-flash') : undefined;
      const body = buildTtsStreamBody({
        provider: preferredService,
        text: lang === 'JA' ? 'こんにちは、テスト成功です。' : 'Hello, test successful.',
        voiceName: testVoice,
        ...(testModel ? { model: testModel } : {}),
      });
      const result = await fetchTtsStream(body, {
        headers: {
          [`x-${preferredService}-api-key`]: key.trim(),
          ...(preferredService === 'azure' && azureRegion ? { 'x-azure-region': azureRegion } : {}),
          ...(preferredService === 'local' && localBaseUrl ? { 'x-local-base-url': localBaseUrl } : {}),
        },
      });
      const latency = Date.now() - startTime;
      const blob = audioChunksToBlob(result.chunks, result.mimeType, result.sampleRate);
      const audio = new Audio(URL.createObjectURL(blob));
      await audio.play().catch(() => {});
      toast.success(`${label}验证成功（延迟 ${latency}ms）：服务连通且可用！`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${label}验证失败：${msg}`);
    } finally {
      setTestingKey(null);
    }
  };

  return (
    <section id="settings-speech" className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-8">
      <h2 className="text-2xl font-semibold text-ink">语音朗读</h2>

      {/* 语音服务选择 */}
      <div className="mt-7">
        <h3 className="mb-3 text-base font-semibold text-ink">语音服务</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={preferredService ? 'outline' : 'default'} onClick={() => chooseService('')}>
            服务默认
          </Button>
          {providers.data?.map((provider) => (
            <Button
              key={provider.id}
              type="button"
              variant={preferredService === provider.id ? 'default' : 'outline'}
              onClick={() => chooseService(provider.id)}
            >
              {provider.displayName}
            </Button>
          ))}
        </div>

        {preferredService && (
          <div className="mt-4 rounded-2xl border border-line bg-surface-soft p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <ApiKeyField
                label="主用 API Key（优先免费配额）"
                value={providerApiKeys[preferredService] ?? ''}
                onChange={(val) => setProviderApiKey(preferredService, val)}
                onTest={() => void handleTestKey('primary')}
                isTesting={testingKey === 'primary'}
                placeholder="输入主用 API Key（优先使用，留空使用网关配置）"
              />
              <ApiKeyField
                label="备用 API Key（可选，付费兜底）"
                value={backupApiKeys[preferredService] ?? ''}
                onChange={(val) => setBackupApiKey(preferredService, val)}
                onTest={() => void handleTestKey('backup')}
                isTesting={testingKey === 'backup'}
                placeholder="可选：主用触发 429 限额时自动接管"
              />
              {preferredService === 'azure' && (
                <label className="block text-sm font-medium text-ink md:col-span-2">
                  区域 (Region)
                  <input
                    className={`${fieldClass} mt-1.5`}
                    value={azureRegion}
                    onChange={(event) => setAzureRegion(event.target.value)}
                    placeholder="如 eastus"
                  />
                </label>
              )}
              {preferredService === 'local' && (
                <label className="block text-sm font-medium text-ink md:col-span-2">
                  本地服务地址
                  <input
                    className={`${fieldClass} mt-1.5`}
                    value={localBaseUrl}
                    onChange={(event) => setLocalBaseUrl(event.target.value)}
                    placeholder="如 http://localhost:8000"
                  />
                </label>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <p className="max-w-xl text-xs leading-relaxed text-ink-mute">
                支持主备双 Key 智能容灾：主用 Key 触发 Google 1 分钟频率限制（429 / 15 RPM）时，系统自动无缝切换至备用 Key 接管；60 秒冷却后自动恢复优先使用免费 Key。
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => toast.success('语音服务与 API Key 设置已保存并实时生效')}
                className="cursor-pointer"
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                保存配置
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 核心试音操作条（高频使用，始终置顶） */}
      <TtsPreviewBar lang={lang} serverText={serverText} userText={userText} onUserTextChange={setUserText} />

      <p className="mt-4 border-t border-line pt-4 text-xs text-ink-mute">
        {defaults.isPending ? '正在同步网关试音配置…' : serverText ? `当前轨道默认试音：${serverText}` : '网关未下发当前轨道试音文案。'}
      </p>

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
            <ChevronDown className={`h-4 w-4 text-ink-mute transition-transform duration-200 ${modelPickerOpen ? 'rotate-180' : ''}`} />
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
            <ChevronDown className={`h-4 w-4 text-ink-mute transition-transform duration-200 ${cacheSectionOpen ? 'rotate-180' : ''}`} />
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
