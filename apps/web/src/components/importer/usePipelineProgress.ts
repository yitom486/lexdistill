import { useMemo, useRef } from 'react';
import type { TextbookPipelineJobSnapshot } from '@lexdistill/protocol';
import { planTextbookTasks } from '@lexdistill/document-model';
import { useTextbookLessonSlotsQuery } from '../../queries/textbooks-annotations.js';
import { useCancelPipelineJobMutation } from '../../queries/pipeline-jobs.js';
import { useImportMonitorQuery } from '../../queries/textbook-import-monitor.js';
import { useImportDirectory } from './monitor/useImportDirectory.js';
import { selectImportRun } from './monitor/import-run-scope.js';
import type { WorkerStatusInfo } from './monitor/AgentWorkerCard.js';
export const stageLabels: Record<string, string> = {
  preparing: '裁剪章节材料',
  queued: '队列排队中',
  extracting: '模型深度提炼',
  validating: '结构格式校验',
  correcting: '模型自动修正',
  model_retrying: '失败重试中',
  saving: '入库持久化',
  storage_retrying: '保存重试中',
  saved: '已完成入库',
  failed: '本轮失败',
};

export function usePipelineProgress(job: TextbookPipelineJobSnapshot) {
  const slots = useTextbookLessonSlotsQuery(job.documentId, job.userId);
  const cancel = useCancelPipelineJobMutation();
  // 同步取消锁：与 disabled 双重保护同 tick 连击
  const cancellingRef = useRef(false);
  const monitorQuery = useImportMonitorQuery(job.userId, job.traceId ?? '', Boolean(job.traceId));

  const allEvents = useMemo(() => {
    return selectImportRun(monitorQuery.data?.events ?? [], job.jobId);
  }, [monitorQuery.data?.events, job.jobId]);

  const snapshot = useImportDirectory(job.userId, job.traceId ?? '', allEvents, Boolean(job.traceId));
  const directory = snapshot?.directory ?? [];

  const planned = useMemo(() => {
    return slots.data?.length 
      ? planTextbookTasks(slots.data.map(slot => ({ ...slot, id: slot.lessonId, level: slot.kind }))) 
      : undefined;
  }, [slots.data]);

  const tasks = useMemo(() => {
    return planned?.ok ? planned.value.map(t => t.root) : [];
  }, [planned]);

  const slotMap = useMemo(() => {
    return new Map(tasks.map(t => [t.lessonId, t]));
  }, [tasks]);

  // 从 events 和 job 计算 Worker 池信息
  const workers: WorkerStatusInfo[] = useMemo(() => {
    const poolSize = job.concurrency ?? 6;
    const sessionIds = [...new Set(allEvents.flatMap(e => e.sessionId ? [e.sessionId] : []))];

    // 按配置池大小占位（未唤醒槽位如实标“未启动/就绪待命”，不是伪造进度）
    const activeSlotsCount = Math.max(poolSize, sessionIds.length);
    const result: WorkerStatusInfo[] = [];

    for (let i = 0; i < activeSlotsCount; i++) {
      const sid = sessionIds[i];
      const workerIndex = i + 1;

      if (!sid) {
        // 空闲未唤醒槽位
        result.push({
          workerIndex,
          sessionId: '',
          stage: job.status === 'running' ? 'preparing' : 'idle',
          stageText: job.status === 'running' ? '就绪待命' : '未启动',
          attemptCount: 1,
        });
        continue;
      }

      // 提取该 session 最近的事件
      const sEvents = allEvents.filter(e => e.sessionId === sid);
      const latestEvent = sEvents.at(-1);
      const boundNodeId = [...sEvents].reverse().find(e => e.nodeId)?.nodeId ?? undefined;
      const lessonTitle = boundNodeId ? (slotMap.get(boundNodeId)?.title ?? directory.find(d => d.id === boundNodeId)?.title ?? boundNodeId) : undefined;
      
      const currentStageName = boundNodeId ? job.lessonStages?.[boundNodeId] : undefined;
      const activity = boundNodeId ? job.lessonActivities?.[boundNodeId] : undefined;

      let stage: WorkerStatusInfo['stage'] = 'idle';
      if (currentStageName === 'saved') stage = 'saved';
      else if (currentStageName === 'failed') stage = 'failed';
      else if (currentStageName === 'correcting' || currentStageName === 'model_retrying' || currentStageName === 'storage_retrying') stage = 'retrying';
      else if (currentStageName === 'extracting') stage = 'extracting';
      else if (currentStageName === 'validating') stage = 'validating';
      else if (currentStageName === 'preparing') stage = 'preparing';
      else if (currentStageName === 'saving') stage = 'saving';
      else if (latestEvent?.category === 'model') stage = 'thinking';
      else if (job.status === 'running') stage = 'extracting';

      // 统计产出
      const stats = sEvents.reverse().find(e => e.category === 'storage' && e.name === 'committed' && e.detail)?.detail as {
        vocabCount?: number | undefined;
        grammarCount?: number | undefined;
        exerciseCount?: number | undefined;
        hasPassage?: boolean | undefined;
      } | undefined;

      const recentMsg = activity?.message || (latestEvent?.detail && typeof latestEvent.detail === 'object' && 'message' in latestEvent.detail ? String((latestEvent.detail as Record<string, unknown>).message) : undefined);
      const lastTime = activity?.lastActivityAt ? new Date(activity.lastActivityAt).toLocaleTimeString() : undefined;

      result.push({
        workerIndex,
        sessionId: sid,
        stage,
        stageText: currentStageName ? (stageLabels[currentStageName] ?? currentStageName) : (latestEvent ? `[${latestEvent.category}] ${latestEvent.name}` : '运行中'),
        attemptCount: activity?.attempt ?? 1,
        ...(latestEvent?.threadId ? { threadId: latestEvent.threadId } : {}),
        ...(boundNodeId ? { nodeId: boundNodeId } : {}),
        ...(lessonTitle ? { lessonTitle } : {}),
        ...(activity ? { activity } : {}),
        ...(recentMsg ? { recentMessage: recentMsg } : {}),
        ...(lastTime ? { lastActiveTime: lastTime } : {}),
        ...(stats ? { stats } : {}),
      });
    }

    return result;
  }, [allEvents, job, slotMap, directory]);

  const activeWorkerCount = workers.filter(w => ['preparing', 'thinking', 'extracting', 'validating', 'saving', 'retrying'].includes(w.stage)).length;

  return { slots, cancel, cancellingRef, monitorQuery, allEvents, directory, tasks, slotMap, workers, activeWorkerCount };
}
