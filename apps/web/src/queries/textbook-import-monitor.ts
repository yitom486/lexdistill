import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImportEventSchema, ImportEventPageSchema, type ImportEvent } from '@study-studio/document-model';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { GatewayRequestError, readGatewayUserMessage } from '../lib/gateway-error.js';

export interface ImportMonitorData { events: ImportEvent[]; cursor: number; warning?: string }
const monitorKey = (userId: string, traceId: string) => ['textbook-import-monitor', userId, traceId];
const endpoint = (userId: string, traceId: string) => `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/textbook-imports/${encodeURIComponent(traceId)}`;
async function request(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new GatewayRequestError(readGatewayUserMessage(payload, '无法读取导入监视记录，请重试'));
  return payload;
}
export async function requestImportMonitor(userId: string, traceId: string): Promise<ImportMonitorData> {
  const events: ImportEvent[] = [];
  let cursor = 0, warning: string | undefined;
  while (true) {
    const page = ImportEventPageSchema.safeParse(await request(`${endpoint(userId, traceId)}?after=${cursor}`));
    if (!page.success) throw new GatewayRequestError('导入监视记录格式不完整，请重试');
    events.push(...page.data.events); warning = page.data.warning;
    if (page.data.cursor <= cursor || page.data.events.length < 200) return { events, cursor: page.data.cursor, ...(warning ? { warning } : {}) };
    cursor = page.data.cursor;
  }
}
export function useImportMonitorQuery(userId: string, traceId: string, enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: monitorKey(userId, traceId), queryFn: () => requestImportMonitor(userId, traceId), enabled, staleTime: 0 });
  const ready = query.isSuccess;
  useEffect(() => {
    if (!enabled || !ready || typeof EventSource === 'undefined') return;
    const cursor = client.getQueryData<ImportMonitorData>(monitorKey(userId, traceId))?.cursor ?? 0;
    const stream = new EventSource(`${endpoint(userId, traceId)}/events?after=${cursor}`);
    stream.addEventListener('monitor.event', event => {
      try {
        const parsed = ImportEventSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
        if (!parsed.success || parsed.data.userId !== userId || parsed.data.traceId !== traceId) return;
        client.setQueryData<ImportMonitorData>(monitorKey(userId, traceId), current => {
          const unique = new Map((current?.events ?? []).map(item => [item.sequence, item])); unique.set(parsed.data.sequence, parsed.data);
          return { ...current, events: [...unique.values()].sort((a, b) => a.sequence - b.sequence), cursor: Math.max(current?.cursor ?? 0, parsed.data.sequence) };
        });
      } catch { void client.invalidateQueries({ queryKey: monitorKey(userId, traceId) }); }
    });
    stream.addEventListener('monitor.warning', () => { void client.invalidateQueries({ queryKey: monitorKey(userId, traceId) }); });
    stream.onerror = () => { void client.invalidateQueries({ queryKey: monitorKey(userId, traceId) }); };
    return () => stream.close();
  }, [enabled, ready, userId, traceId, client]);
  return query;
}
export function useImportEventDetail(userId: string, traceId: string, sequence: number, enabled: boolean) {
  return useQuery({ queryKey: [...monitorKey(userId, traceId), 'detail', sequence], enabled,
    queryFn: async () => {
      const result = ImportEventSchema.safeParse(await request(`${endpoint(userId, traceId)}/details/${sequence}`));
      if (!result.success) throw new GatewayRequestError('交互详情格式不完整');
      return result.data;
    }, staleTime: Infinity,
  });
}
export function useSavedTextbookContent(userId: string, documentId: string, nodeId: string, enabled: boolean) {
  return useQuery({ queryKey: ['textbook-saved-content', userId, documentId, nodeId], enabled, staleTime: 0,
    queryFn: () => request(`${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/textbook-saved/${encodeURIComponent(documentId)}/${encodeURIComponent(nodeId)}`),
  });
}
