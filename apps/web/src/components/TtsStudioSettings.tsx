import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AudioLines, ChevronDown, KeyRound, Pause, Play, RefreshCw, Volume2 } from 'lucide-react';
import { createTTSClient, type ProviderSummary } from 'gemini-tts-studio/client';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Slider } from './ui/slider.js';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { getPreviewText } from '../config/tts-voice-personas.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { useTtsStore } from '../stores/useTtsStore.js';
import type { SpeechStudioConfig, SupportedLanguage } from '../utils/audio.js';

type TtsProvider = SpeechStudioConfig['preferredService'];

function isTtsProvider(value: string): value is TtsProvider {
  return value === 'gemini' || value === 'azure' || value === 'local';
}

const fieldClass = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function TtsStudioSettings({ lang }: { lang: SupportedLanguage }) {
  const [voiceSearch, setVoiceSearch] = useState('');
  const connected = useGatewayStore((state) => state.isConnected);
  const gender = useTtsStore((state) => state.gender);
  const rate = useTtsStore((state) => state.rate);
  const preferredService = useTtsStore((state) => state.preferredService);
  const geminiApiKey = useTtsStore((state) => state.geminiApiKey);
  const azureKey = useTtsStore((state) => state.azureKey);
  const azureRegion = useTtsStore((state) => state.azureRegion);
  const localBaseUrl = useTtsStore((state) => state.localBaseUrl);
  const localApiKey = useTtsStore((state) => state.localApiKey);
  const voiceId = useTtsStore((state) => state.voiceId);
  const isSpeaking = useTtsStore((state) => state.isSpeaking);
  const setGender = useTtsStore((state) => state.setGender);
  const setRate = useTtsStore((state) => state.setRate);
  const setPreferredService = useTtsStore((state) => state.setPreferredService);
  const setGeminiApiKey = useTtsStore((state) => state.setGeminiApiKey);
  const setAzureKey = useTtsStore((state) => state.setAzureKey);
  const setAzureRegion = useTtsStore((state) => state.setAzureRegion);
  const setLocalBaseUrl = useTtsStore((state) => state.setLocalBaseUrl);
  const setLocalApiKey = useTtsStore((state) => state.setLocalApiKey);
  const setVoiceId = useTtsStore((state) => state.setVoiceId);
  const speak = useTtsStore((state) => state.speak);
  const stop = useTtsStore((state) => state.stop);
  const client = () => createTTSClient({
    baseUrl: GATEWAY_BASE_URL,
    prefix: '/api/tts-studio',
    headers: () => ({
      ...(geminiApiKey ? { 'x-gemini-api-key': geminiApiKey } : {}),
      ...(azureKey ? { 'x-azure-api-key': azureKey } : {}),
      ...(azureRegion ? { 'x-azure-region': azureRegion } : {}),
      ...(localApiKey ? { 'x-local-api-key': localApiKey } : {}),
    }),
  });
  const providers = useQuery({
    queryKey: ['tts-studio', 'providers', GATEWAY_BASE_URL],
    queryFn: () => client().getProviders(),
    enabled: connected,
    staleTime: 5 * 60_000,
  });
  const voices = useQuery({
    queryKey: ['tts-studio', 'voices', preferredService, azureRegion],
    queryFn: () => client().getVoices(preferredService, preferredService === 'azure' ? azureRegion : undefined),
    enabled: false,
    retry: false,
  });
  const providerList = providers.data?.filter(
    (item): item is ProviderSummary & { id: TtsProvider } => isTtsProvider(item.id)
  ) ?? [];
  const selectedProvider = providerList.find((item) => item.id === preferredService);
  const previewText = getPreviewText(lang, gender);
  const visibleVoices = voices.data?.filter((voice) => {
    const query = voiceSearch.trim().toLocaleLowerCase();
    return !query || `${voice.name} ${voice.id} ${voice.description}`.toLocaleLowerCase().includes(query);
  }) ?? [];

  const chooseProvider = (provider: TtsProvider) => {
    if (provider === preferredService) return;
    stop();
    setVoiceSearch('');
    setVoiceId('');
    setPreferredService(provider);
  };
  const chooseGender = (next: 'FEMALE' | 'MALE') => {
    if (next === gender) return;
    setVoiceId('');
    setGender(next);
  };

  return (
    <section id="settings-speech" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-ink">
            <AudioLines className="h-4 w-4" />
            VOICE STUDIO
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-ink">语音朗读</h2>
          <p className="mt-1 text-sm text-ink-mute">选择服务与音色，试听时才会发起语音合成。</p>
        </div>
        <Badge variant="outline">{lang}</Badge>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-7">
            <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-wash-amber-500o15 blur-3xl" />
            <div className="relative flex items-center gap-2 text-sm font-medium text-ink-mute">
              <Volume2 className="h-4 w-4 text-accent-ink" />
              试听台
            </div>
            <blockquote className="relative mt-8 max-w-xl text-xl leading-relaxed text-ink sm:text-2xl">
              “{previewText}”
            </blockquote>
            <div className="relative mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
              <div className="text-xs text-ink-mute">
                <p className="font-medium text-ink">{selectedProvider?.displayName ?? preferredService}</p>
                <p className="mt-1">{voiceId ? `音色 ${voiceId}` : `${gender === 'FEMALE' ? '女声' : '男声'} · 自动选择音色`}</p>
              </div>
              <Button
                type="button"
                className="gap-2"
                disabled={!connected}
                onClick={() => {
                  if (isSpeaking) stop();
                  else void speak(previewText, { lang, gender, purpose: 'preview' });
                }}
              >
                {isSpeaking ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isSpeaking ? '停止播放' : '试听当前配置'}
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
            <h3 className="text-base font-semibold text-ink">朗读偏好</h3>
            <p className="mt-1 text-xs text-ink-mute">音色由 TTS Studio 按当前语言和偏好选择，播放速度在本机调整。</p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-ink">声音</p>
                <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={gender === 'FEMALE' ? 'default' : 'outline'} onClick={() => chooseGender('FEMALE')}>女声</Button>
                    <Button type="button" variant={gender === 'MALE' ? 'default' : 'outline'} onClick={() => chooseGender('MALE')}>男声</Button>
                </div>
                {voiceId && <p className="mt-2 text-xs text-ink-mute">切换男女声会恢复自动选择音色。</p>}
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between text-sm font-medium text-ink">
                  <span>播放速度</span><span>{rate.toFixed(1)}×</span>
                </div>
                <Slider value={rate} min={0.5} max={1.5} step={0.1} onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (typeof next === 'number') setRate(next);
                }} />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
            <h3 className="text-base font-semibold text-ink">语音服务</h3>
            <p className="mt-1 text-xs text-ink-mute">服务列表由本机 TTS Studio 提供。</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              {providerList.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  aria-pressed={preferredService === provider.id}
                  onClick={() => chooseProvider(provider.id)}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${preferredService === provider.id ? 'border-line-amber-500o30 bg-wash-amber-500o15 text-accent-ink' : 'border-line bg-surface-dim text-ink hover:border-line-amber-500o30'}`}
                >
                  {provider.displayName}
                  <span className="text-xs">{preferredService === provider.id ? '当前使用' : '选择'}</span>
                </button>
              ))}
              {providerList.length === 0 && (
                <div className="rounded-xl border border-line bg-surface-dim p-3 text-xs text-ink-mute">
                  {connected ? '暂时无法读取语音服务列表。' : '网关连接后会显示可用语音服务。'}
                  {connected && <Button type="button" variant="ghost" size="sm" onClick={() => void providers.refetch()}>重试</Button>}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-ink">音色库</h3>
                <p className="mt-1 text-xs text-ink-mute">默认自动选择；也可以指定当前服务的音色。</p>
              </div>
              {preferredService !== 'local' && (
                <Button type="button" variant="outline" size="sm" disabled={!connected || voices.isFetching} onClick={() => void voices.refetch()}>
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${voices.isFetching ? 'animate-spin' : ''}`} />
                  读取音色
                </Button>
              )}
            </div>
            {voices.isError && <p className="mt-3 text-xs text-ink-mute">音色列表暂时不可用，请检查当前服务的凭证与连接。</p>}
            {preferredService !== 'local' && voices.data && (
              <>
              <input
                aria-label="搜索音色"
                className={`${fieldClass} mt-4`}
                value={voiceSearch}
                onChange={(event) => setVoiceSearch(event.target.value)}
                placeholder="搜索音色名称或 ID"
              />
              <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-1">
                {visibleVoices.map((voice) => (
                  <button
                    key={voice.id}
                    type="button"
                    aria-pressed={voiceId === voice.id}
                    onClick={() => setVoiceId(voice.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${voiceId === voice.id ? 'border-line-amber-500o30 bg-wash-amber-500o15' : 'border-line bg-surface-dim'}`}
                  >
                    <span className="block text-sm font-medium text-ink">{voice.name}</span>
                    <span className="mt-1 block text-xs text-ink-mute">{voice.description}</span>
                  </button>
                ))}
                {visibleVoices.length === 0 && <p className="text-xs text-ink-mute">没有匹配的音色。</p>}
              </div>
              </>
            )}
            {voiceId && <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => setVoiceId('')}>恢复自动选择</Button>}
            {preferredService === 'local' && (
              <label className="mt-4 block text-xs font-medium text-ink-mute">
                本地音色 ID（可选）
                <input className={`${fieldClass} mt-2`} value={voiceId} onChange={(event) => setVoiceId(event.target.value)} placeholder="留空则由本地服务选择" />
              </label>
            )}
          </div>

          <details className="group rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left">
              <span className="flex items-center gap-2 text-sm font-semibold text-ink"><KeyRound className="h-4 w-4 text-accent-ink" />连接配置</span>
              <ChevronDown className="h-4 w-4 text-ink-mute transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-2 text-xs text-ink-mute">凭证只保存在本机；留空时使用网关环境变量。</p>
            <div className="mt-4 space-y-3">
                {preferredService === 'gemini' && (
                  <label className="block text-xs font-medium text-ink-mute">Gemini API Key
                    <input className={`${fieldClass} mt-2`} type="password" autoComplete="off" value={geminiApiKey} onChange={(event) => setGeminiApiKey(event.target.value)} placeholder="使用网关 GEMINI_API_KEY" />
                  </label>
                )}
                {preferredService === 'azure' && (
                  <>
                    <label className="block text-xs font-medium text-ink-mute">Azure API Key
                      <input className={`${fieldClass} mt-2`} type="password" autoComplete="off" value={azureKey} onChange={(event) => setAzureKey(event.target.value)} placeholder="使用网关 AZURE_SPEECH_KEY" />
                    </label>
                    <label className="block text-xs font-medium text-ink-mute">Azure 区域
                      <input className={`${fieldClass} mt-2`} value={azureRegion} onChange={(event) => setAzureRegion(event.target.value)} placeholder="例如 japaneast" />
                    </label>
                  </>
                )}
                {preferredService === 'local' && (
                  <>
                    <label className="block text-xs font-medium text-ink-mute">本地 TTS 地址
                      <input className={`${fieldClass} mt-2`} value={localBaseUrl} onChange={(event) => setLocalBaseUrl(event.target.value)} placeholder="使用网关 LOCAL_TTS_ENDPOINT" />
                    </label>
                    <label className="block text-xs font-medium text-ink-mute">本地 TTS API Key（可选）
                      <input className={`${fieldClass} mt-2`} type="password" autoComplete="off" value={localApiKey} onChange={(event) => setLocalApiKey(event.target.value)} />
                    </label>
                  </>
                )}
                {preferredService !== 'local' && (
                  <details className="rounded-xl border border-line bg-surface-dim p-3 text-xs text-ink-mute">
                    <summary className="cursor-pointer font-medium text-ink">本地兜底配置</summary>
                    <div className="mt-3 space-y-3">
                      <input aria-label="本地兜底 TTS 地址" className={fieldClass} value={localBaseUrl} onChange={(event) => setLocalBaseUrl(event.target.value)} placeholder="使用网关 LOCAL_TTS_ENDPOINT" />
                      <input aria-label="本地兜底 TTS API Key" className={fieldClass} type="password" autoComplete="off" value={localApiKey} onChange={(event) => setLocalApiKey(event.target.value)} placeholder="本地 TTS API Key（可选）" />
                    </div>
                  </details>
                )}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
