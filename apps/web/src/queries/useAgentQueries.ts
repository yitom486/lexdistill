import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';

export const AGENT_QUERY_KEYS = {
  STATUS: ['agent', 'status'] as const,
  SESSIONS: ['agent', 'sessions'] as const,
  SESSION_ITEMS: ['agent', 'sessionItems'] as const,
  QUEUE: ['agent', 'queue'] as const,
  RUNTIMES: ['agent', 'runtimes'] as const,
  RUNTIME_OPTIONS: ['agent', 'runtime-options'] as const,
  PROVIDER: ['agent', 'provider'] as const,
};

type AgentInvalidateListener = (event: {
  kind: 'queue';
  sessionId?: string;
}) => void;

const agentInvalidateListeners = new Set<AgentInvalidateListener>();

/** GatewayClient 收到旁路通知时调用 */
export function emitAgentInvalidate(event: {
  kind: 'queue';
  sessionId?: string;
}): void {
  for (const listener of agentInvalidateListeners) {
    listener(event);
  }
}

/** 订阅 Agent 旁路失效（queue/changed） */
export function useAgentRealtimeInvalidation(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const listener: AgentInvalidateListener = (event) => {
      if (event.kind === 'queue') {
        if (event.sessionId) {
          void qc.invalidateQueries({
            queryKey: [...AGENT_QUERY_KEYS.QUEUE, event.sessionId],
          });
        } else {
          void qc.invalidateQueries({ queryKey: AGENT_QUERY_KEYS.QUEUE });
        }
        return;
      }
    };
    agentInvalidateListeners.add(listener);
    return () => {
      agentInvalidateListeners.delete(listener);
    };
  }, [qc]);
}

export interface AgentStatusDto {
  available: boolean;
  message: string;
}

export interface AgentSessionDto {
  id: string;
  preview: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  ephemeral: boolean;
}

export interface AgentSessionItemDto {
  turnId: string;
  type: string;
  text?: string;
  id?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
}

export interface AgentQueuedSubmissionDto {
  id: string;
  text: string;
  clientUserMessageId: string;
}

/** Current runtime readiness exposed without provider-specific account details. */
export function useAgentStatusQuery() {
  return useQuery<AgentStatusDto>({
    queryKey: AGENT_QUERY_KEYS.STATUS,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/status`);
      if (!res.ok) {
        return {
          available: false,
          message:
            res.status === 404
              ? `Gateway（${GATEWAY_BASE_URL}）缺少 /api/agent/status 路由（HTTP 404）；请更新并重启 Gateway。`
              : `Agent 状态查询失败：Gateway 返回 HTTP ${res.status}（${GATEWAY_BASE_URL}）。`,
        };
      }
      return (await res.json()) as AgentStatusDto;
    },
    staleTime: 1000 * 30,
    retry: 1,
  });
}

/** Persistent Agent sessions. */
export function useAgentSessionsQuery(enabled = true) {
  return useQuery<{ sessions: AgentSessionDto[]; nextCursor: string | null }>({
    queryKey: AGENT_QUERY_KEYS.SESSIONS,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/sessions?limit=40`);
      if (!res.ok) return { sessions: [], nextCursor: null };
      return (await res.json()) as { sessions: AgentSessionDto[]; nextCursor: string | null };
    },
    staleTime: 1000 * 15,
    retry: 1,
  });
}

/** thread/items/list — 恢复气泡 */
export function useAgentSessionItemsQuery(sessionId: string | null, enabled = true) {
  return useQuery<AgentSessionItemDto[]>({
    queryKey: [...AGENT_QUERY_KEYS.SESSION_ITEMS, sessionId],
    enabled: Boolean(sessionId) && enabled,
    queryFn: async () => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId!)}/items?limit=100`
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { items?: AgentSessionItemDto[] };
      return Array.isArray(data.items) ? data.items : [];
    },
    staleTime: 1000 * 10,
    retry: 1,
  });
}

export function useArchiveAgentSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/archive`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error('归档会话失败');
      return sessionId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AGENT_QUERY_KEYS.SESSIONS });
    },
  });
}

export function useCompactAgentSessionMutation() {
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/compact`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error('压缩会话失败');
      return sessionId;
    },
  });
}

export function useRenameAgentSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; name: string }) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/agent/sessions/${encodeURIComponent(input.sessionId)}/name`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.name }),
        }
      );
      if (!res.ok) throw new Error('重命名失败');
      return input;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AGENT_QUERY_KEYS.SESSIONS });
    },
  });
}

export function useForkAgentSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; ephemeral?: boolean }) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/agent/sessions/${encodeURIComponent(input.sessionId)}/fork`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ephemeral: input.ephemeral ?? false,
          }),
        }
      );
      if (!res.ok) throw new Error('分叉会话失败');
      return (await res.json()) as { sessionId: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AGENT_QUERY_KEYS.SESSIONS });
    },
  });
}

export function useAgentQueueQuery(sessionId: string | null, enabled = true) {
  return useQuery<AgentQueuedSubmissionDto[]>({
    queryKey: [...AGENT_QUERY_KEYS.QUEUE, sessionId],
    enabled: Boolean(sessionId) && enabled,
    queryFn: async () => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId!)}/queue`
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { items?: AgentQueuedSubmissionDto[] };
      return Array.isArray(data.items) ? data.items : [];
    },
    staleTime: 5_000,
    refetchInterval: enabled ? 30_000 : false,
    retry: 1,
  });
}

export function useQueueAgentMessageMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; message: string }) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/agent/sessions/${encodeURIComponent(input.sessionId)}/queue`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: input.message }),
        }
      );
      if (!res.ok) throw new Error('加入队列失败');
      return (await res.json()) as AgentQueuedSubmissionDto;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: [...AGENT_QUERY_KEYS.QUEUE, vars.sessionId],
      });
    },
  });
}

export function useDeleteAgentQueueItemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; queuedId: string }) => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/agent/sessions/${encodeURIComponent(input.sessionId)}/queue/${encodeURIComponent(input.queuedId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('删除队列项失败');
      return input;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: [...AGENT_QUERY_KEYS.QUEUE, vars.sessionId],
      });
    },
  });
}

export interface AgentRuntimeStatusDto {
  id: string;
  label: string;
  hint: string;
  configured: boolean | null;
  capabilities?: {
    supportsModelPicker?: boolean;
    supportsEffort?: boolean;
    supportsThreads?: boolean;
    supportsUsage?: boolean;
    supportsHistory?: boolean;
  } | undefined;
}

export function useAgentRuntimesQuery(enabled = true) {  return useQuery<AgentRuntimeStatusDto[]>({
    queryKey: [...AGENT_QUERY_KEYS.RUNTIMES] as const,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/runtimes`);
      if (!res.ok) return [];
      const data = (await res.json()) as { runtimes?: AgentRuntimeStatusDto[] };
      return Array.isArray(data.runtimes) ? data.runtimes : [];
    },
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
}

export interface AgentRuntimeOptionsDto {
  models: Array<{ value: string; label: string }>;
  efforts: string[];
  error?: string;
}

/** 运行时真实选项（模型/思考深度；按模型级联：档位表随模型变，model 变化即重拉）。 */
export function useAgentRuntimeOptionsQuery(runtimeId: string, enabled = true, model?: string) {
  const scopedModel = model?.trim() || '';
  return useQuery<AgentRuntimeOptionsDto>({
    queryKey: [...AGENT_QUERY_KEYS.RUNTIME_OPTIONS, runtimeId, scopedModel] as const,
    enabled: enabled && !!runtimeId,
    queryFn: async () => {
      const url = `${GATEWAY_BASE_URL}/api/agent/runtimes/${encodeURIComponent(runtimeId)}/options${scopedModel ? `?model=${encodeURIComponent(scopedModel)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) return { models: [], efforts: [] };
      const data = (await res.json()) as Partial<AgentRuntimeOptionsDto>;
      return {
        models: Array.isArray(data.models) ? data.models : [],
        efforts: Array.isArray(data.efforts) ? data.efforts : [],
        ...(typeof data.error === 'string' ? { error: data.error } : {}),
      };
    },
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });
}

export interface AgentProviderStatusDto {
  configured: boolean;
  name?: string;
  baseUrl?: string;
  model?: string;
  hasApiKey: boolean;
}

export interface AgentProviderSaveInput {
  name?: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  wireApi?: 'chat' | 'responses';
}

async function readProviderResponse(res: Response): Promise<AgentProviderStatusDto> {
  const data = (await res.json().catch(() => ({}))) as { provider?: AgentProviderStatusDto; error?: { userMessage?: string } };
  if (!res.ok || !data.provider) {
    throw new Error(data.error?.userMessage || '供应商保存失败，请检查地址/模型/Key');
  }
  return data.provider;
}

export function useAgentProviderQuery(enabled = true) {
  return useQuery<AgentProviderStatusDto>({
    queryKey: AGENT_QUERY_KEYS.PROVIDER,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/provider`);
      if (!res.ok) return { configured: false, hasApiKey: false };
      return readProviderResponse(res);
    },
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
}

export function useSaveAgentProviderMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: AgentProviderSaveInput) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/provider`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      return readProviderResponse(res);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: AGENT_QUERY_KEYS.PROVIDER });
    },
  });
}

export function useDeleteAgentProviderMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/provider`, { method: 'DELETE' });
      if (!res.ok) throw new Error('供应商删除失败，请重试');
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: AGENT_QUERY_KEYS.PROVIDER });
    },
  });
}
