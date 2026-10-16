import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { sound } from '../utils/audio.js';
import {
  useAgentProviderQuery,
  useDeleteAgentProviderMutation,
  useSaveAgentProviderMutation,
} from '../queries/useAgentQueries.js';

/** 自定义 API 供应商（OpenAI 兼容端点）：Key 只进网关存储，状态接口永不回传。 */
export function ProviderSettingsSection() {
  const provider = useAgentProviderQuery(true);
  const save = useSaveAgentProviderMutation();
  const remove = useDeleteAgentProviderMutation();
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const status = provider.data;
  const statusKnown = provider.isSuccess;
  const saveForm = () => {
    sound.playClick();
    save.mutate(
      { baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim(), wireApi: 'chat' },
      {
        onSuccess: () => {
          setApiKey('');
          sound.playSuccess();
          toast.success('自定义供应商已保存');
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : '供应商保存失败。'),
      },
    );
  };
  return (
    <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between font-medium text-ink-mute">
        <div className="flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-tone-amber-500" />
          <span>自定义 API 供应商</span>
        </div>
        {provider.isPending ? (
          <Badge variant="outline" className="border-line px-1.5 py-0 text-sm text-ink-ghost">
            读取中…
          </Badge>
        ) : provider.isError ? (
          <button
            type="button"
            onClick={() => void provider.refetch()}
            title="重新读取供应商配置"
            className="border-line-amber-500o30 px-1.5 py-0 text-sm text-accent-ink rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            读取失败，点击重试
          </button>
        ) : statusKnown && status ? (
          <Badge variant="outline" className="border-line-amber-500o30 px-1.5 py-0 text-sm text-accent-ink max-w-48 truncate" title={status.configured && status.model ? status.model : undefined}>
            {status.configured ? `已配置${status.model ? ` · ${status.model}` : ''}` : '未配置'}
          </Badge>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-ink-ghost">
        自备 OpenAI 兼容端点（地址/模型/Key）。保存后在 Agent 运行时下拉选“自定义 API…”即走该供应商；Key 只存本机网关，查询接口不回传。
      </p>
      <div className="grid gap-2">
        <label className="block">
          <span className="mb-0.5 block text-xs text-ink-ghost">Base URL</span>
          <input
            aria-label="供应商地址"
            value={baseUrl}
            onChange={event => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-ink-ghost">模型</span>
          <input
            aria-label="供应商模型"
            value={model}
            onChange={event => setModel(event.target.value)}
            placeholder="gpt-4o-mini"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-ink-ghost">API Key（保存后清空输入框）</span>
          <input
            aria-label="供应商密钥"
            type="password"
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            placeholder="sk-…"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={saveForm} disabled={save.isPending || !baseUrl.trim() || !model.trim() || !apiKey.trim()}>
          {save.isPending ? '保存中…' : '保存供应商'}
        </Button>
        {status?.configured && (
          <Button
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => {
              sound.playClick();
              remove.mutate(undefined, {
                onSuccess: () => toast.success('自定义供应商已删除'),
                onError: (e) => toast.error(e instanceof Error ? e.message : '供应商删除失败。'),
              });
            }}
          >
            删除
          </Button>
        )}
      </div>
    </div>
  );
}
