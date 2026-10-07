import { Hono } from 'hono';
import { BankGradeSubmitSchema } from '@study-studio/protocol';
import { BusinessError, isOk } from '@study-studio/shared';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { BankGrading } from '../application/bank-grading.js';
import { TextbookGrading } from '../application/textbook-grading.js';
import { SubmitExerciseGradeTool } from '../tools/submit-exercise-grade.js';

/** Explicit grading/retry is separate from saving an answer: no implicit model cost. */
export function createBankGradingRoutes(deps: GatewayDeps) {
  let grading: BankGrading | undefined;
  return new Hono().post('/api/generation/tasks/:userId/:taskId/papers/:paperId/answers/subjective/:submissionId/grade', async c => {
    try {
      const body = await c.req.json().catch(() => null);
      const parsed = BankGradeSubmitSchema.safeParse({ ...(body as object), taskId: c.req.param('taskId'),
        paperId: c.req.param('paperId'), submissionId: c.req.param('submissionId') });
      if (!parsed.success) throw new BusinessError('E_INVALID_INPUT', '请提供有效的批改配置，不接受客户端分数或参考答案。', 'VALIDATION');
      if (!grading) {
        const tool = deps.server.toolRegistry.get('learning.submit_grade');
        if (!(tool instanceof SubmitExerciseGradeTool)) throw new BusinessError('E_GRADING_UNAVAILABLE', '批改服务尚未就绪，作答仍保留。', 'AGENT_RUNTIME', true);
        grading = new BankGrading({ repo: deps.repo, adapterId: deps.server.agentAdapter.id,
          grading: new TextbookGrading({ repo: deps.repo, adapter: deps.server.agentAdapter, tool }) });
      }
      const result = await grading.grade(c.req.param('userId'), parsed.data);
      return isOk(result) ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
    } catch (cause) { return formatBusinessErrorResponse(c, cause, 'gradeBankSubmission'); }
  });
}
