import { Hono } from 'hono';
import { SubmitTextbookExerciseSchema } from '@lexdistill/protocol';
import { summarizeTextbookGrowth } from '@lexdistill/learner-core';
import { BusinessError } from '@lexdistill/shared';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { TextbookGrading } from '../application/textbook-grading.js';
import { SubmitExerciseGradeTool } from '../tools/submit-exercise-grade.js';

export function createTextbookPracticeRoutes(deps: GatewayDeps) {
  // 按运行时缓存批改服务（running 去重表随实例，跨运行时互不干扰）。
  // 无 runtimeId 走 server 默认适配器（产品为 codex-acp 池实例；测试可注入）。
  const gradingByRuntime = new Map<string, TextbookGrading>();
  const gradingFor = (runtimeId: string | undefined): TextbookGrading | undefined => {
    const key = runtimeId ?? '';
    const cached = gradingByRuntime.get(key);
    if (cached) return cached;
    const tool = deps.server.toolRegistry.get('learning.submit_grade');
    if (!(tool instanceof SubmitExerciseGradeTool)) return undefined;
    const grading = new TextbookGrading({
      repo: deps.repo,
      adapter: runtimeId ? deps.server.resolveAgentAdapter(runtimeId) : deps.server.agentAdapter,
      tool,
      toolRegistry: deps.server.toolRegistry,
    });
    gradingByRuntime.set(key, grading);
    return grading;
  };
  return new Hono()
    .post('/api/textbook-practice/:userId/submit', async c => {
      try {
        const parsed = SubmitTextbookExerciseSchema.safeParse(await c.req.json());
        if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '提交内容不完整或题目格式不正确', 'VALIDATION'));
        const grading = gradingFor(parsed.data.runtimeId);
        if (!grading) return formatBusinessErrorResponse(c, new BusinessError('E_GRADING_UNAVAILABLE', '批改服务尚未就绪，请稍后重试', 'AGENT_RUNTIME', true));
        const result = await grading.submit(c.req.param('userId'), parsed.data);
        return result.ok ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
      } catch (cause) { return formatBusinessErrorResponse(c, cause, 'submitTextbookExercise'); }
    })
    .get('/api/textbook-practice/:userId/history', async c => {
      try {
        const documentId = c.req.query('documentId'), chapterId = c.req.query('chapterId');
        if (!documentId || !chapterId) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请指定教材和章节', 'VALIDATION'));
        const result = await deps.repo.textbookExerciseHistory(c.req.param('userId'), documentId, chapterId);
        return result.ok ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
      } catch (cause) { return formatBusinessErrorResponse(c, cause, 'textbookExerciseHistory'); }
    })
    .get('/api/textbook-practice/:userId/growth', async c => {
      try {
        const documentId = c.req.query('documentId'), chapterId = c.req.query('chapterId');
        if (!documentId || !chapterId) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请指定教材和章节', 'VALIDATION'));
        const result = await deps.repo.textbookExerciseHistory(c.req.param('userId'), documentId, chapterId);
        return result.ok ? c.json({ history: result.value, summary: summarizeTextbookGrowth(result.value) }) : formatBusinessErrorResponse(c, result.error);
      } catch (cause) { return formatBusinessErrorResponse(c, cause, 'textbookExerciseGrowth'); }
    });
}
