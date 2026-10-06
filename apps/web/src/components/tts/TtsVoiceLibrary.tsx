import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Play, RefreshCw, Square } from 'lucide-react';
import { createTTSClient, type VoiceInfo } from 'gemini-tts-studio/client';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { GATEWAY_BASE_URL } from '../../lib/api-client.js';
import { useTtsDefaultsQuery } from '../../queries/tts-defaults.js';
import { useTtsStore } from '../../stores/useTtsStore.js';
import type { SupportedLanguage } from '../../utils/audio.js';

function genderLabel(gender: VoiceInfo['gender']): string | null {
  if (gender === 'female') return '女';
  if (gender === 'male') return '男';
  if (gender === 'neutral') return '中性';
  return null;
}

interface Props {
  /** 试听文案（网关下发；为空表示配置未就绪，试播禁用）。 */
  previewText: string;
  lang: SupportedLanguage;
}

/**
 * 角色音色库：进页自动同步（选择题），搜索 + 性别徽标 + 单音色试播 + 自定义 ID。
 * 音色挂在服务下（包设计：Voices API 按 provider 拉取，与模型无关），
 * 生效服务 = 用户锁定 → 网关默认（运行时下发）。
 */
export function TtsVoiceLibrary({ previewText, lang }: Props) {
  const preferredService = useTtsStore((s) => s.preferredService);
  const providerApiKeys = useTtsStore((s) => s.providerApiKeys);
  const azureRegion = useTtsStore((s) => s.azureRegion);
  const voiceId = useTtsStore((s) => s.voiceId);
  const setVoiceId = useTtsStore((s) => s.setVoiceId);
  const voiceIdMale = useTtsStore((s) => s.voiceIdMale);
  const setVoiceIdMale = useTtsStore((s) => s.setVoiceIdMale);
  const voiceIdFemale = useTtsStore((s) => s.voiceIdFemale);
  const setVoiceIdFemale = useTtsStore((s) => s.setVoiceIdFemale);
  const isSpeaking = useTtsStore((s) => s.isSpeaking);
  const speak = useTtsStore((s) => s.speak);
  const stop = useTtsStore((s) => s.stop);

  const [activeSlot, setActiveSlot] = useState<'default' | 'male' | 'female'>('default');
  const [query, setQuery] = useState('');
  const [customId, setCustomId] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);

  // 全局停止（含底部试听条的停止）同样熄灭卡片试播态：同一套播放状态。
  useEffect(() => {
    if (!isSpeaking) setPlayingId(null);
  }, [isSpeaking]);

  const defaults = useTtsDefaultsQuery();
  const effectiveService = preferredService || defaults.data?.defaultProvider || '';

  const currentApiKey = providerApiKeys[effectiveService] ?? '';

  const voices = useQuery({
    queryKey: ['tts-studio', 'voices', effectiveService, currentApiKey, azureRegion],
    queryFn: () => {
      const key = currentApiKey;
      const credentialHeaders = key && /^[a-z0-9-]+$/.test(effectiveService)
        ? { [`x-${effectiveService}-api-key`]: key }
        : {};
      return createTTSClient({
        baseUrl: GATEWAY_BASE_URL,
        prefix: '/api/tts-studio',
        headers: credentialHeaders,
      }).getVoices(effectiveService, effectiveService === 'azure' ? azureRegion : undefined);
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: effectiveService.length > 0,
  });

  const list = useMemo(() => {
    const all = voices.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((v) =>
      v.name.toLowerCase().includes(q) || v.description.toLowerCase().includes(q) || v.id.toLowerCase().includes(q),
    );
  }, [voices.data, query]);

  const previewVoice = (voice: VoiceInfo): void => {
    if (!previewText.trim()) return;
    if (playingId === voice.id) {
      stop();
      setPlayingId(null);
      return;
    }
    stop();
    setPlayingId(voice.id);
    void speak(previewText, {
      lang,
      purpose: 'preview',
      voiceId: voice.id,
      onEnd: () => setPlayingId((cur) => (cur === voice.id ? null : cur)),
      onError: () => setPlayingId((cur) => (cur === voice.id ? null : cur)),
    });
  };

  const handleSelectVoice = (id: string): void => {
    if (activeSlot === 'default') {
      setVoiceId(id);
    } else if (activeSlot === 'male') {
      setVoiceIdMale(id);
    } else {
      setVoiceIdFemale(id);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
          音色库
          {voices.data ? <Badge variant="secondary">{voices.data.length} 款可用</Badge> : null}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={voices.isFetching}
          onClick={() => void voices.refetch()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${voices.isFetching ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 角色音色分配槽位切换 */}
      <div className="mb-3 flex items-center gap-1.5 rounded-xl border border-line bg-surface-soft p-1">
        <button
          type="button"
          onClick={() => setActiveSlot('default')}
          className={`flex-1 rounded-lg py-1.5 px-2 text-xs font-medium transition-colors text-center ${
            activeSlot === 'default'
              ? 'bg-surface text-ink shadow-xs border border-line-soft'
              : 'text-ink-mute hover:text-ink'
          }`}
        >
          默认朗读
          {voiceId ? ` (${voiceId})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setActiveSlot('male')}
          className={`flex-1 rounded-lg py-1.5 px-2 text-xs font-medium transition-colors text-center ${
            activeSlot === 'male'
              ? 'bg-surface text-ink shadow-xs border border-line-soft'
              : 'text-ink-mute hover:text-ink'
          }`}
        >
          男角色音色
          {voiceIdMale ? ` (${voiceIdMale})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setActiveSlot('female')}
          className={`flex-1 rounded-lg py-1.5 px-2 text-xs font-medium transition-colors text-center ${
            activeSlot === 'female'
              ? 'bg-surface text-ink shadow-xs border border-line-soft'
              : 'text-ink-mute hover:text-ink'
          }`}
        >
          女角色音色
          {voiceIdFemale ? ` (${voiceIdFemale})` : ''}
        </button>
      </div>

      <div className="mb-2 flex gap-2">
        <input
          className="w-full rounded-xl border border-line bg-surface px-4 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="快速搜索音色名称或特点…"
        />
        <input
          className="w-32 shrink-0 rounded-xl border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={customId}
          onChange={(e) => setCustomId(e.target.value)}
          placeholder="自定义 ID"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customId.trim()) {
              handleSelectVoice(customId.trim());
              setCustomId('');
            }
          }}
        />
      </div>
      {voices.isError && <p role="alert" className="mb-2 text-sm text-ink-mute">音色同步失败（多为缺 API Key），请在下方连接设置填入后点刷新。</p>}
      <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1" role="listbox" aria-label="角色音色库">
        {voices.isPending && <p className="col-span-2 text-sm text-ink-mute">正在从网关同步音色库…</p>}
        {voices.isSuccess && list.length === 0 && (
          <p className="col-span-2 text-sm text-ink-mute">无匹配音色，换个关键词试试。</p>
        )}
        {list.map((voice) => {
          const isDefault = voiceId === voice.id;
          const isMale = voiceIdMale === voice.id;
          const isFemale = voiceIdFemale === voice.id;
          const selected = activeSlot === 'default' ? isDefault : activeSlot === 'male' ? isMale : isFemale;
          const playing = playingId === voice.id;
          const gender = genderLabel(voice.gender);
          return (
            <div
              key={voice.id}
              role="option"
              aria-selected={selected}
              className={`relative rounded-xl border p-3 transition-colors ${selected ? 'border-ring ring-1 ring-ring' : 'border-line bg-surface'}`}
            >
              <button type="button" className="block w-full cursor-pointer text-left" onClick={() => handleSelectVoice(voice.id)}>
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className="mr-1 truncate text-sm font-semibold text-ink">{voice.name}</span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-label="已选中" />}
                </div>
                <p className="line-clamp-2 pr-6 text-xs leading-tight text-ink-mute">{voice.description}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {gender ? <Badge variant="outline">{gender}</Badge> : null}
                  {isDefault ? <Badge variant="secondary">默认</Badge> : null}
                  {isMale ? <Badge variant="amber">男角色</Badge> : null}
                  {isFemale ? <Badge variant="destructive">女角色</Badge> : null}
                  {voice.kind && voice.kind !== 'prebuilt' ? <Badge variant="secondary">定制</Badge> : null}
                </div>
              </button>
              <button
                type="button"
                title={playing ? '停止试听' : `试听 ${voice.name}`}
                aria-label={playing ? `停止试听 ${voice.name}` : `试听 ${voice.name}`}
                disabled={!previewText.trim()}
                onClick={() => previewVoice(voice)}
                className="absolute bottom-1.5 right-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink-mute"
              >
                {playing ? <Square className="h-3 w-3 fill-current" /> : <Play className="ml-px h-3 w-3" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
