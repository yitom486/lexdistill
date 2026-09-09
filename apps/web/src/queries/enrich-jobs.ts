import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@study-studio/shared';
import {
  EnrichJobSnapshotSchema,
  WsEventTypes,
  type EnrichJobSnapshot,
} from '@study-studio/protocol';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { gatewayClient } from '../lib/gateway-client.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';

const enrichJobKey = (userId: string, documentId: string, jobId: string) =>
  [...QUERY_KEYS.TEXTBOOKS, 'enrich-job', userId, documentId, jobId] as const;

function extractUserMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'userMessage' in payload) {
    const msg = (payload as { userMessage: unknown }).userMessage;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

function parseJobSnapshot(payload: unknown): EnrichJobSnapshot {
  const parsed = EnrichJobSnapshotSchema.safeParse(payload);
  if (!parsed.success) throw new Error('抽取任务状态解析失败，请刷新重试');
  return parsed.data;
}

/**
 * 启动整本后台抽取：POST …/enrich-jobs（202 立即返回 job）。
 * sessionId 随包带上——网关经 WS import.enrich.* 向本会话推送进度；
 * 断线时 GET 轮询兜底（useEnrichJobQuery 的 refetchInterval）。
 */
export function useStartEnrichJobMutation(userId = DEFAULT_USER_ID) {
  return useMutation({
    mutationFn: async (vars: {
      documentId: string;
      lessonIds?: string[];
      /** 并发课数 1–4（缺省 1；服务端钳制，限流失败可重试） */
      concurrency?: number;
    }): Promise<EnrichJobSnapshot> => {
      const sessionId = gatewayClient.getSessionId();
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(vars.documentId)}/enrich-jobs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(vars.lessonIds ? { lessonIds: vars.lessonIds } : {}),
            ...(sessionId ? { sessionId } : {}),
            ...(vars.concurrency !== undefined ? { concurrency: vars.concurrency } : {}),
          }),
        }
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(extractUserMessage(payload, `启动抽取失败（HTTP ${res.status}）`));
      }
      const body = (payload ?? {}) as { job?: unknown };
      return parseJobSnapshot(body.job);
    },
    onError: (e) => {
      logger.debug('[useStartEnrichJobMutation] start failed', e);
    },
  });
}

/**
 * 任务状态查询：running 时每 2s 轮询（TanStack 原生 refetchInterval），
 * 终态自动停。WS 推送到达时经 setQueryData 即时刷新，不等轮询。
 */
export function useEnrichJobQuery(
  userId: string,
  documentId: string,
  jobId: string | null
) {
  return useQuery<EnrichJobSnapshot>({
    queryKey: jobId ? enrichJobKey(userId, documentId, jobId) : ['enrich-job', 'idle'],
    enabled: !!jobId,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 2000 : false,
    queryFn: async (): Promise<EnrichJobSnapshot> => {
      if (!jobId) throw new Error('缺少任务 ID');
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(documentId)}/enrich-jobs/${encodeURIComponent(jobId)}`
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(extractUserMessage(payload, `查询任务失败（HTTP ${res.status}）`));
      }
      const body = (payload ?? {}) as { job?: unknown };
      return parseJobSnapshot(body.job);
    },
  });
}

export function useCancelEnrichJobMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      documentId: string;
      jobId: string;
    }): Promise<EnrichJobSnapshot> => {
      const res = await fetch(
        `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/${encodeURIComponent(vars.documentId)}/enrich-jobs/${encodeURIComponent(vars.jobId)}/cancel`,
        { method: 'POST' }
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(extractUserMessage(payload, `取消任务失败（HTTP ${res.status}）`));
      }
      const body = (payload ?? {}) as { job?: unknown };
      return parseJobSnapshot(body.job);
    },
    onSuccess: (job) => {
      queryClient.setQueryData(enrichJobKey(userId, job.documentId, job.jobId), job);
    },
    onError: (e) => {
      logger.debug('[useCancelEnrichJobMutation] cancel failed', e);
    },
  });
}

/**
 * WS 推送订阅：import.enrich.* 到达即写入 Query 缓存（经 zod 校验）。
 * 终态（completed/failed）附带失效教材树——逐课落库的新词即刻可见。
 */
export function useEnrichJobSubscription(
  userId: string,
  documentId: string,
  jobId: string | null
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!jobId) return;
    const apply = (rawPayload: unknown) => {
      const parsed = EnrichJobSnapshotSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const job = parsed.data;
      if (job.jobId !== jobId) return;
      queryClient.setQueryData(enrichJobKey(userId, documentId, jobId), job);
      if (job.status !== 'running') {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS });
      }
    };
    const offs = [
      gatewayClient.subscribe(WsEventTypes.IMPORT_ENRICH_PROGRESS, (env) =>
        apply(env.payload)
      ),
      gatewayClient.subscribe(WsEventTypes.IMPORT_ENRICH_COMPLETED, (env) =>
        apply(env.payload)
      ),
      gatewayClient.subscribe(WsEventTypes.IMPORT_ENRICH_FAILED, (env) =>
        apply(env.payload)
      ),
    ];
    return () => {
      offs.forEach((off) => off());
    };
  }, [queryClient, userId, documentId, jobId]);
}
