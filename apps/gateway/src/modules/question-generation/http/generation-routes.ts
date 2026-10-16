import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { BusinessError, isOk } from '@lexdistill/shared';
import { BankAnswerSubmitSchema, CreateGenerationTaskSchema } from '@lexdistill/protocol';
import { listPresets, resolvePreset } from '../presets.js';
import type { GenerationTaskService } from '../service.js';
import type { GenerationRunManager } from '../run-manager.js';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

function tasksOf(deps: GatewayDeps): GenerationTaskService {
  if (!deps.generation) throw new BusinessError('E_NOT_FOUND', '专用出题服务未启用', 'ROUTING');
  return deps.generation.service;
}

function runsOf(deps: GatewayDeps): GenerationRunManager | undefined {
  return deps.generation?.runs;
}

/**
 * P1 专用出题宿主入口（HTTP 薄层，业务归属 service + repository）。
 * - 试卷一律返回学生视图（隐藏答案、解释、rubric 与听力全文）；复盘释放按练习阶段由
 *   后端在 P2 学习闭环中决定，不接受客户端参数自行放行。本批不设宿主全文读口。
 * - 模型驱动经后台调度异步执行（POST …/run 返回 202），不经 HTTP 同步触发。
 */
export function createGenerationRoutes(deps: GatewayDeps) {
  return new Hono()
    .post('/api/generation/tasks',
      validator('json', value => value as Record<string, unknown>),
      async c => {
        try {
          const parsed = CreateGenerationTaskSchema.safeParse(await c.req.json().catch(() => null));
          if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请提供有效的任务配置与身份。', 'VALIDATION'));
          // 冻结前证伪：指名运行时的模型必须在其目录内，否则运行时即 400 指引（不烧任务）。
          // 缺席不探针，执行时走默认池。
          const runtimeId = parsed.data.config.runtimeId;
          if (runtimeId) {
            const checked = await deps.server.checkRunModelEffort(runtimeId, parsed.data.config.modelId);
            if (checked.dropModel) {
              return formatBusinessErrorResponse(c, new BusinessError('E_GENERATION_MODEL_MISMATCH',
                `${checked.warnings.join('；')}（请重选该运行时的模型）`, 'VALIDATION'));
            }
          }
          const binding = tasksOf(deps).createTask(parsed.data);
          return c.json({ taskId: binding.taskId, binding });
        } catch (e) { return formatBusinessErrorResponse(c, e, 'createGenerationTask'); }
      })
    .get('/api/generation/tasks/:userId', async c => {
      try { return c.json(tasksOf(deps).listUserTasks(c.req.param('userId'))); }
      catch (e) { return formatBusinessErrorResponse(c, e, 'listGenerationTasks'); }
    })
    .get('/api/generation/presets', async c => {
      try { return c.json(listPresets()); }
      catch (e) { return formatBusinessErrorResponse(c, e, 'listGenerationPresets'); }
    })
    .post('/api/generation/presets/resolve',
      validator('json', value => value as Record<string, unknown>),
      async c => {
        try {
          const parsed = z.object({
            presetId: z.string().min(1).max(80), language: z.enum(['ja', 'en', 'ko']),
            targetLevel: z.string().min(1).max(16), modelId: z.string().min(1).max(200),
            audio: z.object({ providerId: z.string().min(1).max(200), modelId: z.string().min(1).max(200),
              maleVoice: z.string().min(1).max(200), femaleVoice: z.string().min(1).max(200),
              narratorVoice: z.string().min(1).max(200), speed: z.number().min(0.5).max(2),
              timeoutMs: z.number().int().min(100).max(120000) }).strict().optional(),
            categoryCounts: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
            listeningModes: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
          }).strict().safeParse(await c.req.json().catch(() => null));
          if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请提供有效的预设、等级与模型。', 'VALIDATION'));
          try {
            return c.json(resolvePreset(parsed.data as never));
          } catch (cause) {
            // zod 结构问题透出首条明细（如听力形式之和不等于听力题数），便于界面修正。
            // 按名识别而非 instanceof：网关与协议包可能解析到不同 zod 副本。
            const zodLike = cause as { name?: unknown; issues?: Array<{ message?: unknown }> } | null;
            if (zodLike?.name === 'ZodError' && Array.isArray(zodLike.issues)) {
              const detail = zodLike.issues.map(issue => String(issue.message ?? '')).find(message => message.trim().length > 0);
              return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', detail ?? '预设配置不符合要求。', 'VALIDATION'));
            }
            return formatBusinessErrorResponse(c, cause, 'resolveGenerationPreset');
          }
        } catch (e) { return formatBusinessErrorResponse(c, e, 'resolveGenerationPreset'); }
      })
    .get('/api/generation/suggest/:userId', async c => {
      try {
        const language = c.req.query('language');
        if (language !== undefined && !['ja', 'en', 'ko'].includes(language)) {
          throw new BusinessError('E_INVALID_INPUT', '请选择日语、英语或韩语学习轨道。', 'VALIDATION');
        }
        return c.json(await deps.repo.suggestGenerationPreset(c.req.param('userId'),
          language === 'ja' || language === 'ko' || language === 'en' ? language : undefined));
      } catch (e) { return formatBusinessErrorResponse(c, e, 'suggestGenerationPreset'); }
    })
    .get('/api/generation/tasks/:userId/:taskId', async c => {
      try { return c.json(tasksOf(deps).queryTask(c.req.param('userId'), c.req.param('taskId'))); }
      catch (e) { return formatBusinessErrorResponse(c, e, 'queryGenerationTask'); }
    })
    .post('/api/generation/tasks/:userId/:taskId/cancel', async c => {
      try { return c.json(await tasksOf(deps).cancelTask(c.req.param('userId'), c.req.param('taskId'))); }
      catch (e) { return formatBusinessErrorResponse(c, e, 'cancelGenerationTask'); }
    })
    .post('/api/generation/tasks/:userId/recover',
      validator('json', value => value as { taskIds?: unknown }),
      async c => {
        try {
          const body = c.req.valid('json');
          const taskIds = Array.isArray(body.taskIds) ? body.taskIds.map(String) : [];
          return c.json({ recovered: tasksOf(deps).recoverOrphanedTasks(c.req.param('userId'), taskIds) });
        } catch (e) { return formatBusinessErrorResponse(c, e, 'recoverGenerationTasks'); }
      })
    .post('/api/generation/tasks/:userId/:taskId/run', async c => {
      try {
        const runs = runsOf(deps);
        if (!runs) return formatBusinessErrorResponse(c, new BusinessError('E_NOT_FOUND', '出题后台调度未启用', 'ROUTING'));
        const accepted = await runs.start(c.req.param('userId'), c.req.param('taskId'));
        if (!accepted.started) {
          return formatBusinessErrorResponse(c, new BusinessError(accepted.reason === 'RUNNING' ? 'E_GENERATION_BUSY' : 'E_GENERATION_INACTIVE',
            accepted.reason === 'RUNNING' ? '该任务正在后台出题，请勿重复提交' : '任务已结束或过期，不能启动', accepted.reason === 'RUNNING' ? 'TOOL_EXECUTION' : 'VALIDATION'));
        }
        return c.json({ accepted: true, taskId: c.req.param('taskId') }, 202);
      } catch (e) { return formatBusinessErrorResponse(c, e, 'startGenerationRun'); }
    })
    .get('/api/generation/tasks/:userId/:taskId/run-state', async c => {
      try {
        const runs = runsOf(deps);
        if (!runs) return formatBusinessErrorResponse(c, new BusinessError('E_NOT_FOUND', '出题后台调度未启用', 'ROUTING'));
        return c.json(runs.runState(c.req.param('userId'), c.req.param('taskId')));
      } catch (e) { return formatBusinessErrorResponse(c, e, 'queryGenerationRunState'); }
    })
    .get('/api/generation/tasks/:userId/:taskId/papers/:paperId', async c => {
      try {
        // 作答阶段一律学生视图；复盘按后端判定的已作答题目逐题释放，未作答仍隐藏。
        if (c.req.query('view') === 'review') {
          return c.json(tasksOf(deps).readReviewPaper(c.req.param('userId'), c.req.param('taskId'), c.req.param('paperId')));
        }
        return c.json(tasksOf(deps).readStudentPaper(c.req.param('userId'), c.req.param('taskId'), c.req.param('paperId')));
      } catch (e) { return formatBusinessErrorResponse(c, e, 'readGenerationPaper'); }
    })
    .post('/api/generation/tasks/:userId/:taskId/papers/:paperId/answers/objective',
      validator('json', value => value as Record<string, unknown>),
      async c => {
        try {
          const parsed = BankAnswerSubmitSchema.safeParse({ ...(await c.req.json().catch(() => null) as object),
            taskId: c.req.param('taskId'), paperId: c.req.param('paperId') });
          if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请提供有效的题目、答案和提交身份。', 'VALIDATION'));
          const result = await deps.repo.submitBankObjectiveAnswer(c.req.param('userId'), parsed.data);
          return isOk(result) ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
        } catch (e) { return formatBusinessErrorResponse(c, e, 'submitBankObjectiveAnswer'); }
      })
    .post('/api/generation/tasks/:userId/:taskId/papers/:paperId/answers/subjective',
      validator('json', value => value as Record<string, unknown>),
      async c => {
        try {
          const parsed = BankAnswerSubmitSchema.safeParse({ ...(await c.req.json().catch(() => null) as object),
            taskId: c.req.param('taskId'), paperId: c.req.param('paperId') });
          if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请提供有效的题目、答案和提交身份。', 'VALIDATION'));
          const result = await deps.repo.submitBankSubjectiveAnswer(c.req.param('userId'), parsed.data);
          return isOk(result) ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
        } catch (e) { return formatBusinessErrorResponse(c, e, 'submitBankSubjectiveAnswer'); }
      })
    .get('/api/generation/tasks/:userId/:taskId/papers/:paperId/submissions', async c => {
      try {
        return c.json(tasksOf(deps).listBankSubmissions(c.req.param('userId'), c.req.param('taskId'), c.req.param('paperId')));
      } catch (e) { return formatBusinessErrorResponse(c, e, 'listBankSubmissions'); }
    })
    .get('/api/generation/tasks/:userId/:taskId/audio/:materialId', async c => {
      try {
        const { bytes, mimeType } = tasksOf(deps).readAudio(c.req.param('userId'), c.req.param('taskId'), c.req.param('materialId'));
        return new Response(bytes as unknown as BodyInit, { headers: { 'Content-Type': mimeType, 'Content-Length': String(bytes.byteLength) } });
      } catch (e) { return formatBusinessErrorResponse(c, e, 'readGenerationAudio'); }
    });
}
