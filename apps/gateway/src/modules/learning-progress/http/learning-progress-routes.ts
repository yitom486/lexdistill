import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError } from '@lexdistill/shared';
import type { LearnerProfile } from '@lexdistill/protocol';
import type { MistakeEntry } from '@lexdistill/learner-core';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { runLearningAnalysis, buildAnalysisSnapshot } from '../application/learning-analysis.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

/** 学习进度域路由：画像、每日任务/计划、学习分析、错题（G2 迁移，行为不变）。 */
export function createLearningProgressRoutes(deps: GatewayDeps) {
  return new Hono()
  .get('/api/profile/:userId', async (c) => {
    const userId = c.req.param('userId');
    const lang = c.req.query('lang');
    const res = await deps.repo.getProfileSnapshot(userId, lang);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  .post(
    '/api/profile/:userId',
    validator('json', (value) => value as Partial<LearnerProfile>),
    async (c) => {
      const userId = c.req.param('userId');
      try {
        const body = c.req.valid('json');
        const res = await deps.repo.updateLearnerProfile(userId, body);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'updateLearnerProfile');
      }
    }
  )
  // 2. 每日打卡与足迹进度
  .get('/api/task/progress/:userId', async (c) => {
    const userId = c.req.param('userId');
    const date = c.req.query('date') || undefined;
    const res = await deps.repo.getDailyTaskProgress(userId, date, c.req.query('lang'));
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  // 2.5 历史足迹热力图 (查询最近 N 天真实 SQLite 打卡记录)
  .get('/api/task/history/:userId', async (c) => {
    const userId = c.req.param('userId');
    const days = Number(c.req.query('days')) || 28;
    const lang = c.req.query('lang');
    const res = await deps.repo.getActivityHistory(userId, days, lang);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  .post(
    '/api/task/activity/:userId',
    validator('json', (value) => value as {
      quizzes?: number;
      cards?: number;
      listeningMinutes?: number;
      mistakesResolved?: number;
      reading?: number;
      date?: string;
    }),
    async (c) => {
      const userId = c.req.param('userId');
      try {
        const body = c.req.valid('json');
        const res = await deps.repo.recordDailyActivity(userId, body);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'recordDailyActivity');
      }
    }
  )
  .get('/api/learning/plan/:userId', async (c) => {
    try {
      const userId = c.req.param('userId');
      const date = c.req.query('date') || undefined;
      const res = await deps.repo.getOrCreateDailyStudyPlan(userId, date, c.req.query('lang'));
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error);
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'getDailyStudyPlan');
    }
  })
  .post(
    '/api/learning/plan/:userId/complete',
    validator('json', (value) => value as { stepId?: string; date?: string; language?: string }),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const body = c.req.valid('json');
        if (!body.stepId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '标记完成需要 stepId', 'VALIDATION')
          );
        }
        const res = await deps.repo.completeDailyPlanStep(userId, body.stepId, body.date, body.language);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'completeDailyPlanStep');
      }
    }
  )
  // P4-C：AI 学习分析（缓存 + 模型 + 本地规则回退）
  .get('/api/learning/analysis/:userId', async (c) => {
    try {
      const userId = c.req.param('userId');
      const forceRefresh = c.req.query('refresh') === '1';
      const model = c.req.query('model') || undefined;
      const runtimeId = c.req.query('runtimeId') || undefined;
      const res = await runLearningAnalysis({
        adapter: deps.server.resolveAgentAdapter(runtimeId),
        repo: deps.repo,
        userId,
        forceRefresh,
        model,
      });
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error);
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'runLearningAnalysis');
    }
  })
  // 3. 新手带路进度（零基础分阶段清单，进度取自当日学习资产）
  .get('/api/trail/:userId', async (c) => {
    const userId = c.req.param('userId');
    const raw = (c.req.query('track') || '').toLowerCase();
    const track = raw === 'ko' || raw === 'kr' ? 'ko' : raw === 'en' ? 'en' : 'ja';
    const res = await deps.repo.getBeginnerTrail(userId, track);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  // 3b. 档位信息（当前档 + 升级提示语；等级状态机读口）
  .get('/api/level/:userId', async (c) => {
    const userId = c.req.param('userId');
    const res = await deps.repo.getLevelInfo(userId, c.req.query('lang') || 'ja');
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error, 'levelInfo');
  })
  // 3c. 课程路线（长期路线求值 + 新掌握写档；每日计划从中取任务）。
  .get('/api/course-route/:userId', async (c) => {
    const userId = c.req.param('userId');
    const res = await deps.repo.getCourseRoute(userId, c.req.query('lang') || 'ja');
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error, 'courseRoute');
  })
  // 4. 错题本存取与消除
  .get('/api/mistakes/:userId', async (c) => {
    const userId = c.req.param('userId');
    const lang = c.req.query('lang');
    const res = await deps.repo.getMistakes(userId, lang ? { language: lang } : undefined);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  .post(
    '/api/mistakes/:userId',
    validator('json', (value) => value as Record<string, unknown>),
    async (c) => {
      try {
        const body = c.req.valid('json');
        // MistakeEntry 暂无 zod schema；此处为 HTTP 信任边界断言（与此前 as any 等价，不断言不放行）。
        const res = await deps.repo.saveMistake(body as unknown as MistakeEntry);
        if (isOk(res)) return c.json({ success: true });
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'saveMistake');
      }
    }
  )
  .post('/api/mistakes/:userId/resolve/:mistakeId', async (c) => {
    const mistakeId = c.req.param('mistakeId');
    const res = await deps.repo.resolveMistake(mistakeId);
    if (isOk(res)) return c.json({ success: true, mistakeId });
    return formatBusinessErrorResponse(c, res.error);
  })
  .post(
    '/api/mistakes/:userId/retry/:mistakeId',
    validator('json', (value) => value as { isCorrect?: boolean }),
    async (c) => {
      const userId = c.req.param('userId');
      const mistakeId = c.req.param('mistakeId');
      const { isCorrect } = c.req.valid('json');
      if (typeof isCorrect !== 'boolean') {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_INVALID_INPUT', '请提供本次订正是否正确。', 'VALIDATION'),
          'retryMistake'
        );
      }
      const res = await deps.repo.retryMistake(userId, mistakeId, isCorrect);
      if (isOk(res)) return c.json({ success: true, mistakeId, ...res.value });
      return formatBusinessErrorResponse(c, res.error, 'retryMistake');
    }
  )
;
}
