import { Hono } from 'hono';
import { BusinessError, isOk } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { clampEnrichConcurrency } from '../application/pdf-import/enrich-job-runner.js';

/**
 * 整本 enrich 后台任务：POST /api/documents/:userId/:documentId/enrich-jobs …。
 *
 * - 启动立即返回 { job }（202 语义），逐课进度经 WS import.enrich.* 推送，
 *   断线/无会话时靠 GET /enrich-jobs/:jobId 轮询；
 * - 同一文档已有 running 任务时返回旧任务（防双击开双任务）；
 * - 取消：POST …/cancel，课间即停，在途一课正常收尾；
 * - 失败课记 job.failed，重试 = 用 lessonIds=failed[].lessonId 另起任务（已完成课自动跳过）。
 * 同步单次接口 POST …/enrich 保持不动（单课快抽仍走它）。
 */
export function createEnrichJobRoutes(deps: GatewayDeps) {
  const pickJob = (userId: string, documentId: string, jobId: string) => {
    const job = deps.server.enrichJobs.get(jobId);
    if (!job || job.userId !== userId || job.documentId !== documentId) {
      return null;
    }
    return job;
  };

  return new Hono()
    .post('/api/documents/:userId/:documentId/enrich-jobs', async (c) => {
      try {
        const userId = c.req.param('userId');
        const documentId = c.req.param('documentId');
        let lessonIds: string[] | undefined;
        let sessionId: string | undefined;
        let concurrency: number | undefined;
        let model: string | undefined;
        let effort: string | undefined;
        try {
          const body = (await c.req.json().catch(() => null)) as {
            lessonIds?: unknown;
            sessionId?: unknown;
            concurrency?: unknown;
            model?: unknown;
            effort?: unknown;
          } | null;
          if (Array.isArray(body?.lessonIds) && body.lessonIds.every((v) => typeof v === 'string')) {
            lessonIds = [...body.lessonIds];
          }
          if (typeof body?.sessionId === 'string' && body.sessionId) sessionId = body.sessionId;
          // 并发 1–4（越界钳制不断言，失败课可重试）；模型分流只收窄字符串，透传引擎。
          if (typeof body?.concurrency === 'number' && Number.isInteger(body.concurrency)) {
            concurrency = clampEnrichConcurrency(body.concurrency);
          }
          if (typeof body?.model === 'string' && body.model.trim().length > 0 && body.model.length <= 200) {
            model = body.model.trim();
          }
          if (typeof body?.effort === 'string' && body.effort.trim().length > 0 && body.effort.length <= 40) {
            effort = body.effort.trim();
          }
        } catch {
          // 无 body = 整本抽取
        }
        const started = deps.server.enrichJobs.start(
          {
            repo: deps.repo,
            adapter: deps.server.agentAdapter,
            emitToSession: (sid, type, payload) => deps.server.emitToSession(sid, type, payload),
          },
          {
            userId,
            documentId,
            ...(lessonIds ? { lessonIds } : {}),
            ...(sessionId ? { sessionId } : {}),
            ...(concurrency !== undefined ? { concurrency } : {}),
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
          }
        );
        if (!isOk(started)) return formatBusinessErrorResponse(c, started.error);
        return c.json({ job: started.value }, 202);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'startEnrichJob');
      }
    })
    .get('/api/documents/:userId/:documentId/enrich-jobs/:jobId', (c) => {
      try {
        const job = pickJob(c.req.param('userId'), c.req.param('documentId'), c.req.param('jobId'));
        if (!job) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_NOT_FOUND', '未找到指定的抽取任务', 'LEARNER_STATE')
          );
        }
        return c.json({ job });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'getEnrichJob');
      }
    })
    .post('/api/documents/:userId/:documentId/enrich-jobs/:jobId/cancel', (c) => {
      try {
        const job = pickJob(c.req.param('userId'), c.req.param('documentId'), c.req.param('jobId'));
        if (!job) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_NOT_FOUND', '未找到指定的抽取任务', 'LEARNER_STATE')
          );
        }
        const cancelled = deps.server.enrichJobs.cancel(job.jobId);
        if (!isOk(cancelled)) return formatBusinessErrorResponse(c, cancelled.error);
        return c.json({ job: cancelled.value });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'cancelEnrichJob');
      }
    });
}
