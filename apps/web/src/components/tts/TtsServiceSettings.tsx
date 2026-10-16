import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createTTSClient } from 'gemini-tts-studio/client';
import { Play, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { GATEWAY_BASE_URL } from '../../lib/api-client.js';
import { buildTtsStreamBody, fetchTtsStream } from '../../lib/tts-stream.js';
import { audioChunksToBlob } from '../../lib/pcm-audio.js';
import { useTtsStore } from '../../stores/useTtsStore.js';
import type { SupportedLanguage } from '../../utils/audio.js';
const fieldClass = 'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

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
  const fieldId = useId();
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={fieldId} className="text-sm font-medium text-ink">{label}</label>
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
        id={fieldId}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function TtsServiceSettings({ lang }: { lang: SupportedLanguage }) {
  const [testingKey, setTestingKey] = useState<'primary' | 'backup' | null>(null);
  const {
    preferredService, providerApiKeys, backupApiKeys, azureRegion, localBaseUrl,
    voiceId, modelId,
    setPreferredService, setProviderApiKey, setBackupApiKey, setAzureRegion,
    setLocalBaseUrl, setVoiceId, setModelId, stop,
  } = useTtsStore();

  const providers = useQuery({
    queryKey: ['tts-studio', 'providers', GATEWAY_BASE_URL],
    queryFn: () => createTTSClient({ baseUrl: GATEWAY_BASE_URL, prefix: '/api/tts-studio' }).getProviders(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

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
      <div className="mt-7">
        <h3 className="mb-3 text-base font-semibold text-ink">语音服务</h3>
        <p className="mb-3 text-xs text-ink-mute">
          当前选择：{preferredService
            ? providers.data?.find((item) => item.id === preferredService)?.displayName || `${preferredService}（已保存，名称待确认）`
            : '服务默认'}
        </p>
        {providers.isPending ? <p role="status" className="mb-3 text-xs text-ink-mute">正在读取语音服务列表…</p>
          : providers.isError ? <p className="mb-3 text-xs text-ink-mute">
            语音服务列表读取失败，已保存的选择保持不变。
            <Button type="button" variant="link" size="sm" onClick={() => void providers.refetch()}>重新读取服务</Button>
          </p>
          : providers.data?.length === 0 ? <p className="mb-3 text-xs text-ink-mute">暂无可选语音服务，保留当前选择。</p> : null}
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

  );
}
