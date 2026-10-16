import { Hono } from 'hono';
import { ObjectiveAnswerInputSchema } from '@lexdistill/protocol';
import { BusinessError, isOk } from '@lexdistill/shared';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';

export function createAnswerRoutes(deps: GatewayDeps) {
  return new Hono().post('/api/practice/answers/:userId', async c => {
    const parsed = ObjectiveAnswerInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请提供有效的题目、答案和提交身份。', 'VALIDATION'));
    const result = await deps.repo.submitObjectiveAnswer(c.req.param('userId'), parsed.data);
    return isOk(result) ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
  });
}
