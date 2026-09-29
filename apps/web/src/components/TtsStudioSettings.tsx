import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createTTSClient } from 'gemini-tts-studio/client';
import { Button } from './ui/button.js';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { useTtsDefaultsQuery } from '../queries/tts-defaults.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import type { SupportedLanguage } from '../utils/audio.js';
import { TtsModelPicker } from './tts/TtsModelPicker.js';
import { TtsVoiceLibrary } from './tts/TtsVoiceLibrary.js';
import { TtsPreviewBar } from './tts/TtsPreviewBar.js';

const fieldClass = 'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function TtsStudioSettings({ lang }: { lang: SupportedLanguage }) {
  const [userText, setUserText] = useState('');
  const preferredService = useTtsStore((state) => state.preferredService);
  const providerApiKeys = useTtsStore((state) => state.providerApiKeys);
  const azureRegion = useTtsStore((state) => state.azureRegion);
  const localBaseUrl = useTtsStore((state) => state.localBaseUrl);
  const setPreferredService = useTtsStore((state) => state.setPreferredService);
  const setProviderApiKey = useTtsStore((state) => state.setProviderApiKey);
  const setAzureRegion = useTtsStore((state) => state.setAzureRegion);
  const setLocalBaseUrl = useTtsStore((state) => state.setLocalBaseUrl);
  const setVoiceId = useTtsStore((state) => state.setVoiceId);
  const setModelId = useTtsStore((state) => state.setModelId);
  const stop = useTtsStore((state) => state.stop);

  const providers = useQuery({
    queryKey: ['tts-studio', 'providers', GATEWAY_BASE_URL],
    // The provider catalog needs no credential. Sending one caused CORS preflight to fail.
    queryFn: () => createTTSClient({ baseUrl: GATEWAY_BASE_URL, prefix: '/api/tts-studio' }).getProviders(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  // 试音文案与默认服务全部来自网关运行时，前端无字面量复刻。
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

  return (
    <section id="settings-speech" className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-8">
      <h2 className="text-2xl font-semibold text-ink">语音朗读</h2>

      <div className="mt-7">
        <h3 className="mb-3 text-base font-semibold text-ink">语音服务</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={preferredService ? 'outline' : 'default'} onClick={() => chooseService('')}>服务默认</Button>
          {providers.data?.map((provider) => (
            <Button key={provider.id} type="button" variant={preferredService === provider.id ? 'default' : 'outline'} onClick={() => chooseService(provider.id)}>
              {provider.displayName}
            </Button>
          ))}
        </div>
        {providers.isError && (
          <div role="alert" className="mt-3 flex items-center gap-3 text-sm text-ink-mute">
            <span>服务列表读取失败</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void providers.refetch()}>重试</Button>
          </div>
        )}
      </div>

      <div className="mt-7 grid gap-7 border-t border-line pt-7 lg:grid-cols-2">
        <TtsModelPicker />
        <TtsVoiceLibrary previewText={effectiveText} lang={lang} />
      </div>

      <TtsPreviewBar lang={lang} serverText={serverText} userText={userText} onUserTextChange={setUserText} />

      <details className="mt-7 border-t border-line pt-5">
        <summary className="cursor-pointer text-base font-semibold text-ink">连接设置</summary>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {preferredService && (
            <label className="block text-base font-medium text-ink">
              {providers.data?.find((provider) => provider.id === preferredService)?.displayName ?? preferredService} API Key
              <input className={`${fieldClass} mt-2`} type="password" autoComplete="off" value={providerApiKeys[preferredService] ?? ''} onChange={(event) => setProviderApiKey(preferredService, event.target.value)} placeholder="留空使用网关配置" />
            </label>
          )}
          {preferredService === 'azure' && (
            <label className="block text-base font-medium text-ink">
              区域
              <input className={`${fieldClass} mt-2`} value={azureRegion} onChange={(event) => setAzureRegion(event.target.value)} />
            </label>
          )}
          {preferredService === 'local' && (
            <label className="block text-base font-medium text-ink">
              本地服务地址
              <input className={`${fieldClass} mt-2`} value={localBaseUrl} onChange={(event) => setLocalBaseUrl(event.target.value)} />
            </label>
          )}
        </div>
        <p className="mt-4 text-sm text-ink-mute">
          这里的偏好和 Key 保存在此设备，TTS API 不保存设置。
          {defaults.isPending ? '正在同步网关试音配置…' : serverText ? `当前轨道默认试音：${serverText}` : '网关未下发当前轨道试音文案。'}
        </p>
      </details>
    </section>
  );
}
