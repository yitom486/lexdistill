import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { createTTSClient, type ModelInfo } from 'gemini-tts-studio/client';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Badge } from '../ui/badge.js';
import { GATEWAY_BASE_URL } from '../../lib/api-client.js';
import { useTtsDefaultsQuery } from '../../queries/tts-defaults.js';
import { useTtsStore } from '../../stores/useTtsStore.js';

const AUTO_LABEL = '自动选择（版本最新的 TTS 模型）';

function tierLabel(tier: ModelInfo['tier']): string | null {
  if (tier === 'flagship') return '旗舰';
  if (tier === 'pro') return '专业';
  if (tier === 'lite') return '极速';
  if (tier === 'preview') return '预览';
  return null;
}

function modelLabel(m: ModelInfo): string {
  return `${m.displayName}${m.tier ? ` · ${tierLabel(m.tier) ?? m.tier}` : ''}${m.category === 'live' ? ' · Live' : ''}`;
}

/**
 * 模型选择：进页即经 Gateway 自动同步（选择题，不是填空题），
 * 生效服务 = 用户锁定 → 网关默认（运行时下发，无前端字面量）。
 */
export function TtsModelPicker() {
  const preferredService = useTtsStore((s) => s.preferredService);
  const providerApiKeys = useTtsStore((s) => s.providerApiKeys);
  const azureRegion = useTtsStore((s) => s.azureRegion);
  const modelId = useTtsStore((s) => s.modelId);
  const setModelId = useTtsStore((s) => s.setModelId);

  const defaults = useTtsDefaultsQuery();
  const effectiveService = preferredService || defaults.data?.defaultProvider || '';

  const currentApiKey = providerApiKeys[effectiveService] ?? '';

  const models = useQuery({
    queryKey: ['tts-studio', 'models', effectiveService, currentApiKey, azureRegion],
    queryFn: () => {
      const key = currentApiKey;
      const credentialHeaders = key && /^[a-z0-9-]+$/.test(effectiveService)
        ? { [`x-${effectiveService}-api-key`]: key }
        : {};
      return createTTSClient({
        baseUrl: GATEWAY_BASE_URL,
        prefix: '/api/tts-studio',
        headers: credentialHeaders,
      }).getModels(effectiveService, effectiveService === 'azure' ? azureRegion : undefined);
    },
    enabled: effectiveService.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const list: ModelInfo[] = models.data?.models ?? [];
  const selected = list.find((m) => m.id === modelId);
  const tier = selected?.tier ? tierLabel(selected.tier) : null;
  const triggerLabel = selected ? modelLabel(selected) : AUTO_LABEL;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
          模型
          {models.isSuccess ? <Badge variant="secondary">{list.length} 个可选</Badge> : null}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={models.isFetching}
          onClick={() => void models.refetch()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${models.isFetching ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>
      <Select value={modelId || '__automatic'} onValueChange={(v) => setModelId(v === '__automatic' || !v ? '' : v)}>
        <SelectTrigger className="min-h-11 min-w-0 flex-1 text-base">
          <SelectValue placeholder={AUTO_LABEL}>{triggerLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__automatic">{AUTO_LABEL}</SelectItem>
          {modelId && !selected && <SelectItem value={modelId}>{modelId}</SelectItem>}
          {list.map((m) => (
            <SelectItem key={m.id} value={m.id}>{modelLabel(m)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-2 text-xs text-ink-mute">
        {models.isPending
          ? <span>正在从网关同步模型列表…</span>
          : selected?.description
            ? <span className="line-clamp-2">{selected.description}</span>
            : <span>未锁定时自动选用版本最新的 TTS 模型。</span>}
        {tier ? <Badge variant="secondary">{tier}</Badge> : null}
        {models.data?.source ? <Badge variant="outline">来源 {models.data.source}</Badge> : null}
      </div>
      {models.isError && <p role="alert" className="mt-2 text-sm text-ink-mute">模型同步失败（多为缺 API Key），请在下方连接设置填入后点刷新。</p>}
    </div>
  );
}
