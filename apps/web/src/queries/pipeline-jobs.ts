import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@study-studio/shared';
import type { TextbookPipelineJobSnapshot } from '@study-studio/protocol';
import type { TextbookPipelineSettings, TocEntry } from '@study-studio/document-model';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import {
  GatewayRequestError,
  GATEWAY_NO_RESPONSE_MESSAGE,
  GATEWAY_UNREACHABLE_CODE,
  isGatewayNoResponseError,
  readGatewayErrorCode,
  readGatewayErrorDetails,
  readGatewayUserMessage,
} from '../lib/gateway-error.js';
import { sound } from '../utils/audio.js';
import { toast } from 'sonner';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { usePipelineJobStore } from '../stores/usePipelineJobStore.js';

export interface StartPipelineJobVars extends Partial<TextbookPipelineSettings> {
  documentId?: string;
  title: string;
  language?: string;
  filePath?: string;
  pdfBase64?: string;
  model?: string;
  effort?: string;
  poolSize?: number;
  forceOverwrite?: boolean;
  tocEntries: Array<TocEntry & { sortOrder: number }>;
  lessonJobs?: Array<{
    lessonId: string;
    ocrText: string;
    title?: string;
  }>;
}

async function fetchPdfGateway(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    if (isGatewayNoResponseError(e)) {
      throw new GatewayRequestError(GATEWAY_NO_RESPONSE_MESSAGE, { code: GATEWAY_UNREACHABLE_CODE });
    }
    throw e instanceof Error ? e : new Error('网络请求失败，请稍后重试');
  }
}

/**
 * 异步启动教材整书 AI 并发提炼任务（网关立即返回 202 与初始快照）。
 */
export async function requestStartPipelineJob(
  userId: string,
  vars: StartPipelineJobVars
): Promise<TextbookPipelineJobSnapshot> {
  const url = `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/textbook-pipeline-jobs`;
  const res = await fetchPdfGateway(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vars),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await res.json().catch(() => null)) as TextbookPipelineJobSnapshot | null;
  if ((res.status !== 202 && !res.ok) || !payload) {
    throw new GatewayRequestError(
      readGatewayUserMessage(payload, `启动教材提炼流水线失败（HTTP ${res.status}）`),
      {
        code: readGatewayErrorCode(payload),
        details: readGatewayErrorDetails(payload),
      }
    );
  }
  return payload;
}

/**
 * 中止指定的整书提炼任务。
 */
export async function requestCancelPipelineJob(
  userId: string,
  jobId: string
): Promise<TextbookPipelineJobSnapshot> {
  const url = `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/textbook-pipeline-jobs/${encodeURIComponent(jobId)}/cancel`;
  const res = await fetchPdfGateway(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const payload = (await res.json().catch(() => null)) as TextbookPipelineJobSnapshot | null;
  if (!res.ok || !payload) {
    throw new GatewayRequestError(
      readGatewayUserMessage(payload, `中止教材提炼任务失败（HTTP ${res.status}）`),
      {
        code: readGatewayErrorCode(payload),
        details: readGatewayErrorDetails(payload),
      }
    );
  }
  return payload;
}

/**
 * 查询指定任务最新状态快照。
 */
export async function requestPipelineJob(
  userId: string,
  jobId: string
): Promise<TextbookPipelineJobSnapshot | null> {
  const url = `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/textbook-pipeline-jobs/${encodeURIComponent(jobId)}`;
  const res = await fetchPdfGateway(url);
  if (res.status === 404) return null;
  const payload = (await res.json().catch(() => null)) as TextbookPipelineJobSnapshot | null;
  if (!res.ok || !payload) {
    throw new GatewayRequestError(
      readGatewayUserMessage(payload, `获取任务状态失败（HTTP ${res.status}）`),
      {
        code: readGatewayErrorCode(payload),
        details: readGatewayErrorDetails(payload),
      }
    );
  }
  return payload;
}

/**
 * 查询当前用户是否有正在执行中的活跃任务。
 */
export async function requestActivePipelineJob(
  userId: string
): Promise<TextbookPipelineJobSnapshot | null> {
  const url = `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/textbook-pipeline-jobs/active`;
  const res = await fetchPdfGateway(url);
  if (!res.ok) return null;
  const payload = (await res.json().catch(() => null)) as { activeJob: TextbookPipelineJobSnapshot | null } | null;
  return payload?.activeJob ?? null;
}

export function useStartPipelineJobMutation(userId = DEFAULT_USER_ID) {
  const setActiveJob = usePipelineJobStore((s) => s.setActiveJob);
  const setActiveJobId = usePipelineJobStore((s) => s.setActiveJobId);
  return useMutation({
    mutationFn: (vars: StartPipelineJobVars) => requestStartPipelineJob(userId, vars),
    onSuccess: (snapshot) => {
      setActiveJobId(snapshot.jobId);
      setActiveJob(snapshot);
    },
    onError: (e) => {
      logger.debug('[useStartPipelineJobMutation] failed', e);
    },
  });
}

export function useCancelPipelineJobMutation(userId = DEFAULT_USER_ID) {
  const setActiveJob = usePipelineJobStore((s) => s.setActiveJob);
  return useMutation({
    mutationFn: (jobId: string) => requestCancelPipelineJob(userId, jobId),
    onSuccess: (snapshot) => {
      setActiveJob(snapshot);
      toast.info(`已中止《${snapshot.title}》的提炼`);
    },
    onError: (e) => {
      logger.debug('[useCancelPipelineJobMutation] failed', e);
      toast.error('中止任务失败，请重试');
    },
  });
}

export function useActivePipelineJobQuery(userId = DEFAULT_USER_ID) {
  return useQuery<TextbookPipelineJobSnapshot | null>({
    queryKey: ['pipeline-jobs', 'active', userId],
    queryFn: () => requestActivePipelineJob(userId),
    staleTime: 5000,
  });
}

/**
 * 全局 SSE 流式订阅 Hook：
 * 自动根据 Store 中的 activeJobId 连入网关推送通道，实时接收进度通知与任务状态变更。
 */
export function usePipelineJobSubscription(userId = DEFAULT_USER_ID) {
  const activeJobId = usePipelineJobStore((s) => s.activeJobId);
  const setActiveJob = usePipelineJobStore((s) => s.setActiveJob);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!activeJobId) return;

    let es: EventSource | null = null;
    let isDisposed = false;

    // 先做一次快照查询拉平初始状态
    requestPipelineJob(userId, activeJobId).then((snapshot) => {
      if (isDisposed || !snapshot) return;
      setActiveJob(snapshot);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS });

      // 若已经处于终止状态，无需挂载长连
      if (snapshot.status !== 'running') {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DOCUMENTS });
        return;
      }

      // 建立 SSE 订阅通道
      const sseUrl = `${GATEWAY_BASE_URL}/api/documents/${encodeURIComponent(userId)}/textbook-pipeline-jobs/${encodeURIComponent(activeJobId)}/events`;
      es = new EventSource(sseUrl);

      const handleEvent = (event: MessageEvent) => {
        try {
          const updated = JSON.parse(event.data) as TextbookPipelineJobSnapshot;
          const currentStoreJob = usePipelineJobStore.getState().activeJob;
          setActiveJob(updated);
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS });
          if (updated.status !== 'running') {
            queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DOCUMENTS });
          }

          // 跃迁到终态时的通知与音效反馈
          if (currentStoreJob?.status === 'running') {
            if (updated.status === 'done') {
              sound.playCorrect();
              toast.success(`教材《${updated.title}》目录内的 ${updated.successfulLessons} 个部分已保存`);
              queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEXTBOOKS });
              queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DOCUMENTS });
            } else if (updated.status === 'failed') {
              sound.playMistake();
              toast.error(`教材《${updated.title}》提炼失败：${updated.error || '部分课次提取异常'}`);
            } else if (updated.status === 'cancelled') {
              toast.info(`教材《${updated.title}》提炼已中止`);
            }
          }

          if (updated.status !== 'running') {
            es?.close();
          }
        } catch (err) {
          logger.debug('[usePipelineJobSubscription] Failed to parse SSE event data', err);
        }
      };

      es.addEventListener('pipeline.progress', handleEvent);
      es.addEventListener('pipeline.snapshot', handleEvent);
      es.onerror = () => {
        // SSE 断开时尝试拉一次快照更新终态
        if (!isDisposed) {
          requestPipelineJob(userId, activeJobId).then((s) => {
            if (s && !isDisposed) setActiveJob(s);
          });
        }
      };
    });

    return () => {
      isDisposed = true;
      if (es) {
        es.close();
      }
    };
  }, [activeJobId, userId, setActiveJob, queryClient]);
}
