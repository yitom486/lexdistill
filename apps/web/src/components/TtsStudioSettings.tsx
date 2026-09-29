import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { createTTSClient } from 'gemini-tts-studio/client';
import { Button } from './ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js';
import { Slider } from './ui/slider.js';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import type { SupportedLanguage } from '../utils/audio.js';

const fieldClass = 'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function TtsStudioSettings({ lang }: { lang: SupportedLanguage }) {
  const [previewText, setPreviewText] = useState('');
  const rate = useTtsStore((state) => state.rate);
  const preferredService = useTtsStore((state) => state.preferredService);
  const providerApiKeys = useTtsStore((state) => state.providerApiKeys);
  const azureRegion = useTtsStore((state) => state.azureRegion);
  const localBaseUrl = useTtsStore((state) => state.localBaseUrl);
  const voiceId = useTtsStore((state) => state.voiceId);
  const isSpeaking = useTtsStore((state) => state.isSpeaking);
  const setRate = useTtsStore((state) => state.setRate);
  const setPreferredService = useTtsStore((state) => state.setPreferredService);
  const setProviderApiKey = useTtsStore((state) => state.setProviderApiKey);
  const setAzureRegion = useTtsStore((state) => state.setAzureRegion);
  const setLocalBaseUrl = useTtsStore((state) => state.setLocalBaseUrl);
  const setVoiceId = useTtsStore((state) => state.setVoiceId);
  const speak = useTtsStore((state) => state.speak);
  const stop = useTtsStore((state) => state.stop);

  const providers = useQuery({
    queryKey: ['tts-studio', 'providers', GATEWAY_BASE_URL],
    // The provider catalog needs no credential. Sending one caused CORS preflight to fail.
    queryFn: () => createTTSClient({ baseUrl: GATEWAY_BASE_URL, prefix: '/api/tts-studio' }).getProviders(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const voices = useQuery({
    queryKey: ['tts-studio', 'voices', preferredService, azureRegion],
    queryFn: () => {
      const key = providerApiKeys[preferredService];
      const credentialHeaders = key && /^[a-z0-9-]+$/.test(preferredService)
        ? { [`x-${preferredService}-api-key`]: key }
        : {};
      return createTTSClient({
        baseUrl: GATEWAY_BASE_URL,
        prefix: '/api/tts-studio',
        headers: credentialHeaders,
      }).getVoices(preferredService, preferredService === 'azure' ? azureRegion : undefined);
    },
    enabled: false,
    retry: false,
  });

  const chooseService = (service: string) => {
    if (service === preferredService) return;
    stop();
    setVoiceId('');
    setPreferredService(service);
  };

  return (
    <section id="settings-speech" className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-8">
      <h2 className="text-2xl font-semibold text-ink">语音朗读</h2>

      <div className="mt-7 grid gap-7 lg:grid-cols-2">
        <div>
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

        <div>
          <h3 className="mb-3 text-base font-semibold text-ink">音色</h3>
          <div className="flex gap-2">
            <Select value={voiceId || '__automatic'} onValueChange={(value) => setVoiceId(value === '__automatic' || !value ? '' : value)}>
              <SelectTrigger className="min-h-11 min-w-0 flex-1 text-base"><SelectValue placeholder="自动选择" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__automatic">自动选择</SelectItem>
                {voiceId && !voices.data?.some((voice) => voice.id === voiceId) && (
                  <SelectItem value={voiceId}>{voiceId}</SelectItem>
                )}
                {voices.data?.map((voice) => <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="min-h-11 shrink-0 gap-2" disabled={!preferredService || voices.isFetching} onClick={() => void voices.refetch()}>
              <RefreshCw className={`h-4 w-4 ${voices.isFetching ? 'animate-spin' : ''}`} />
              读取音色
            </Button>
          </div>
          {voices.isError && <p role="alert" className="mt-3 text-sm text-ink-mute">音色读取失败，请检查下方连接设置。</p>}
        </div>
      </div>

      <div className="mt-7 grid items-end gap-4 border-t border-line pt-7 lg:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <label className="block text-base font-semibold text-ink">
          试听内容
          <input className={`${fieldClass} mt-3`} value={previewText} onChange={(event) => setPreviewText(event.target.value)} placeholder="输入一句话" />
        </label>
        <div>
          <div className="mb-5 flex justify-between text-base font-semibold text-ink"><span>语速</span><span>{rate.toFixed(1)}×</span></div>
          <Slider value={rate} min={0.5} max={1.5} step={0.1} onValueChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (typeof next === 'number') setRate(next);
          }} />
        </div>
        <Button type="button" className="min-h-12 gap-2 px-6 text-base" disabled={!isSpeaking && !previewText.trim()} onClick={() => {
          if (isSpeaking) stop();
          else void speak(previewText, { lang, purpose: 'preview' });
        }}>
          {isSpeaking ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {isSpeaking ? '停止' : '试听'}
        </Button>
      </div>

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
        <p className="mt-4 text-sm text-ink-mute">这里的偏好和 Key 保存在此设备，TTS API 不保存设置。</p>
      </details>
    </section>
  );
}
