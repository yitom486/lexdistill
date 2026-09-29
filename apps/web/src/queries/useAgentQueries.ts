import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';

export const AGENT_QUERY_KEYS = {
  STATUS: ['agent', 'status'] as const,
  MODELS: ['agent', 'models'] as const,
  SESSIONS: ['agent', 'sessions'] as const,
  SESSION_ITEMS: ['agent', 'sessionItems'] as const,
  COLLAB_MODES: ['agent', 'collaborationModes'] as const,
  QUEUE: ['agent', 'queue'] as const,
  SKILLS: ['agent', 'skills'] as const,
  USAGE: ['agent', 'usage'] as const,
  MCP_SERVERS: ['integrations', 'mcpServers'] as const,
};

type AgentInvalidateListener = (event: {
  kind: 'queue' | 'skills';
  sessionId?: string;
}) => void;

const agentInvalidateListeners = new Set<AgentInvalidateListener>();

/** GatewayClient 收到旁路通知时调用 */
export function emitAgentInvalidate(event: {
  kind: 'queue' | 'skills';
  sessionId?: string;
}): void {
  for (const listener of agentInvalidateListeners) {
    listener(event);
  }
}

/** 订阅 Agent 旁路失效（queue/changed、skills/changed） */
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
      if (event.kind === 'skills') {
        void qc.invalidateQueries({ queryKey: AGENT_QUERY_KEYS.SKILLS });
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

export interface AgentModelDto {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  hidden?: boolean;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
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

export interface AgentCollaborationModeDto {
  name: string;
  mode: string | null;
  model: string | null;
  reasoningEffort: string | null;
}

export interface AgentQueuedSubmissionDto {
  id: string;
  text: string;
  clientUserMessageId: string;
}

export interface AgentSkillDto {
  name: string;
  description: string;
  enabled: boolean;
  scope?: string;
}

export interface AgentUsageDto {
  usedPercent: number | null;
  resetsAt: number | null;
  label: string | null;
}

export interface McpServerStatusDto {
  name: string;
  status: string;
  toolCount: number;
}

/** EXPERIMENTAL — 本机 realtime 能力探测（无 UI） */


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

/** 本机 Agent 可见模型列表 */
export function useAgentModelsQuery(enabled = true) {
  return useQuery<AgentModelDto[]>({
    queryKey: AGENT_QUERY_KEYS.MODELS,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/models`);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: AgentModelDto[] };
      return Array.isArray(data.models) ? data.models : [];
    },
    staleTime: 1000 * 60 * 5,
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

/** collaborationMode/list */
export function useAgentCollaborationModesQuery(enabled = true) {
  return useQuery<AgentCollaborationModeDto[]>({
    queryKey: AGENT_QUERY_KEYS.COLLAB_MODES,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/collaboration-modes`);
      if (!res.ok) return [];
      const data = (await res.json()) as { modes?: AgentCollaborationModeDto[] };
      return Array.isArray(data.modes) ? data.modes : [];
    },
    staleTime: 1000 * 60 * 10,
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

export function useAgentSkillsQuery(enabled = true) {
  return useQuery<AgentSkillDto[]>({
    queryKey: AGENT_QUERY_KEYS.SKILLS,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/skills`);
      if (!res.ok) return [];
      const data = (await res.json()) as { skills?: AgentSkillDto[] };
      return Array.isArray(data.skills) ? data.skills : [];
    },
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
}

export function useAgentUsageQuery(enabled = true) {
  return useQuery<AgentUsageDto | null>({
    queryKey: AGENT_QUERY_KEYS.USAGE,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/agent/usage`);
      if (!res.ok) return null;
      return (await res.json()) as AgentUsageDto;
    },
    staleTime: 1000 * 60,
    retry: 1,
  });
}

export function useMcpServersQuery(enabled = true) {
  return useQuery<McpServerStatusDto[]>({
    queryKey: AGENT_QUERY_KEYS.MCP_SERVERS,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/integrations/mcp/servers`);
      if (!res.ok) return [];
      const data = (await res.json()) as { servers?: McpServerStatusDto[] };
      return Array.isArray(data.servers) ? data.servers : [];
    },
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
}
