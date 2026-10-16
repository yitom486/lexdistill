import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { BusinessError, isOk } from '@lexdistill/shared';
import type { LearnerLevel } from '@lexdistill/protocol';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

const LEVELS: LearnerLevel[] = ['NOVICE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

/**
 * 定级考路由（跳级通道）：
 * - 开考建 QUIZ×20 的练习 run（组卷由答题工作台挂载时调既有 assemble 口）；
 * - 答题走既有 run 提交口（draft/submit-objective/subjective）与既有 runner UI；
 * - 交卷 finalize 后按准确率 + 字母线判定，过线写档（可重考）。
 */
export function createPlacementRoutes(deps: GatewayDeps) {
  return (
    new Hono()
      .post(
        '/api/placement/:userId/start',
        validator('json', (value) => value as { language?: unknown; targetLevel?: unknown }),
        async (c) => {
          try {
            const userId = c.req.param('userId');
            const body = c.req.valid('json');
            const language =
              body.language === 'ko' ? 'ko' : body.language === 'en' ? 'en' : 'ja';
            const targetLevel =
              typeof body.targetLevel === 'string' &&
              (LEVELS as string[]).includes(body.targetLevel)
                ? (body.targetLevel as LearnerLevel)
                : null;
            if (!targetLevel) {
              return formatBusinessErrorResponse(
                c,
                new BusinessError('E_INVALID_INPUT', 'targetLevel 须为四档之一', 'VALIDATION')
              );
            }
            const started = await deps.repo.startPlacementExam(userId, language, targetLevel);
            if (!isOk(started)) return formatBusinessErrorResponse(c, started.error, 'placementStart');
            return c.json({ exam: started.value.exam, runId: started.value.runId });
          } catch (e: unknown) {
            return formatBusinessErrorResponse(c, e, 'placementStart');
          }
        }
      )
      .post('/api/placement/:userId/:examId/finish', async (c) => {
        try {
          const res = await deps.repo.finishPlacementExam(
            c.req.param('userId'),
            c.req.param('examId')
          );
          if (isOk(res)) return c.json(res.value);
          return formatBusinessErrorResponse(c, res.error, 'placementFinish');
        } catch (e: unknown) {
          return formatBusinessErrorResponse(c, e, 'placementFinish');
        }
      })
  );
}
