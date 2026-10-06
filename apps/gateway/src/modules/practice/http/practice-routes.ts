import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError, generateId } from '@study-studio/shared';
import type { PracticeBlockSpec } from '@study-studio/protocol';
import { isQuestionAllowed, resolveStudyGate } from '@study-studio/learner-core';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { assemblePracticeRun } from '../application/practice-assembly.js';
import { submitObjectiveItem } from '../application/submit-objective-item.js';
import { createProposal, consumeProposal } from '../application/practice-proposal.js';
import { summarizePracticeRun } from '../application/practice-summary.js';
import type { PersistableQuestion } from '../persistence/questions.js';
import { buildAnalysisSnapshot } from '../../learning-progress/public.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

/** 练习域路由：模板、运行、题目集合、题库（G2 迁移，行为不变）。 */
export function createPracticeRoutes(deps: GatewayDeps) {
  return new Hono()
  // P5：可配置练习计划——模板 CRUD（HTTP Mutation，暂不暴露给 Agent）
  .get('/api/practice/templates/:userId', async (c) => {
    try {
      const userId = c.req.param('userId');
      const language = (c.req.query('lang') as 'en' | 'ja' | 'ko' | undefined) || undefined;
      const includeDisabled = c.req.query('includeDisabled') === '1';
      const res = await deps.repo.listPracticePlanTemplates(userId, { language, includeDisabled });
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error);
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'listPracticePlanTemplates');
    }
  })
  .get('/api/practice/templates/:userId/:templateId', async (c) => {
    try {
      const res = await deps.repo.getPracticePlanTemplate(c.req.param('userId'), c.req.param('templateId'));
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error);
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'getPracticePlanTemplate');
    }
  })
  .post(
    '/api/practice/templates',
    validator('json', (value) => value as Record<string, unknown>),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const res = await deps.repo.savePracticePlanTemplate(body as never);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'savePracticePlanTemplate');
      }
    }
  )
  .delete('/api/practice/templates/:userId/:templateId', async (c) => {
    try {
      const res = await deps.repo.deletePracticePlanTemplate(c.req.param('userId'), c.req.param('templateId'));
      if (isOk(res)) return c.json({ ok: true });
      return formatBusinessErrorResponse(c, res.error);
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'deletePracticePlanTemplate');
    }
  })
  // P5-E2：启用/停用模板（仅改 enabled，不递增 revision）
  .patch(
    '/api/practice/templates/:userId/:templateId/enabled',
    validator('json', (value) => value as { enabled: boolean }),
    async (c) => {
      try {
        const body = c.req.valid('json');
        if (typeof body.enabled !== 'boolean') {
          return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', 'enabled 必须为布尔值', 'VALIDATION'));
        }
        const res = await deps.repo.setPracticePlanTemplateEnabled(
          c.req.param('userId'),
          c.req.param('templateId'),
          body.enabled
        );
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'setPracticePlanTemplateEnabled');
      }
    }
  )
  // P5-E2：复制模板（新 id、revision 重置、默认停用）
  .post('/api/practice/templates/:userId/:templateId/copy', async (c) => {
    try {
      const res = await deps.repo.copyPracticePlanTemplate(c.req.param('userId'), c.req.param('templateId'));
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error);
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'copyPracticePlanTemplate');
    }
  })
  // P5：练习运行生命周期
  .post(
    '/api/practice/runs/start',
    validator('json', (value) => value as { userId: string; language: 'en' | 'ja' | 'ko'; templateId?: string; blocks?: unknown[] }),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const res = await deps.repo.startPracticePlanRun(body.userId, {
          language: body.language,
          templateId: body.templateId,
          blocks: body.blocks as PracticeBlockSpec[] | undefined,
        });
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'startPracticePlanRun');
      }
    }
  )
  .get('/api/practice/runs/:userId/:runId', async (c) => {
    try {
      const runRes = await deps.repo.getPracticePlanRun(c.req.param('userId'), c.req.param('runId'));
      if (!isOk(runRes)) return formatBusinessErrorResponse(c, runRes.error);
      const attemptsRes = await deps.repo.listPracticeItemAttempts(c.req.param('runId'));
      if (!isOk(attemptsRes)) return formatBusinessErrorResponse(c, attemptsRes.error);
      return c.json({ run: runRes.value, attempts: attemptsRes.value });
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'getPracticePlanRun');
    }
  })
  .post(
    '/api/practice/runs/draft',
    validator('json', (value) => value as { userId: string; runId: string; itemId: string; userAnswer: string }),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const res = await deps.repo.savePracticeItemDraft(body.userId, body.runId, body.itemId, body.userAnswer);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'savePracticeItemDraft');
      }
    }
  )
  .post(
    '/api/practice/runs/submit-objective',
    validator(
      'json',
      (value) =>
        value as {
          userId: string;
          runId: string;
          itemId: string;
          userAnswer: string;
          isCorrect?: boolean;
          score?: number;
          testedSkillId?: string;
          timeSpentMs?: number;
        }
    ),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const res = await submitObjectiveItem(deps.repo, body);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'submitPracticeItemObjective');
      }
    }
  )
  .post(
    '/api/practice/runs/submit-subjective',
    validator(
      'json',
      (value) =>
        value as {
          userId: string;
          runId: string;
          itemId: string;
          userAnswer: string;
          gradingResult: Record<string, unknown>;
          timeSpentMs?: number;
        }
    ),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const res = await deps.repo.submitPracticeItem(
          body.userId,
          body.runId,
          body.itemId,
          body.userAnswer,
          body.gradingResult,
          body.timeSpentMs
        );
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'submitPracticeItemSubjective');
      }
    }
  )
  .post(
    '/api/practice/runs/submit-batch',
    validator(
      'json',
      (value) =>
        value as {
          userId: string;
          runId: string;
          items: Array<{ itemId: string; userAnswer: string; gradingResult: Record<string, unknown>; timeSpentMs?: number }>;
        }
    ),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const attempts = [];
        let correct = 0;
        for (const it of body.items) {
          const res = await deps.repo.submitPracticeItem(
            body.userId,
            body.runId,
            it.itemId,
            it.userAnswer,
            it.gradingResult,
            it.timeSpentMs
          );
          if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
          attempts.push(res.value);
          if ((it.gradingResult as { isCorrect?: boolean }).isCorrect) correct++;
        }
        return c.json({
          attempts,
          batchSummary: { total: body.items.length, graded: attempts.length, correct },
        });
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'submitPracticeBatch');
      }
    }
  )
  .post(
    '/api/practice/runs/finalize',
    validator('json', (value) => value as { userId: string; runId: string }),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const res = await deps.repo.finalizePracticePlanRun(body.userId, body.runId);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'finalizePracticePlanRun');
      }
    }
  )
  // P5-E7：装配运行题目（按块语义：词汇卡/题型池/模板生成补齐/任意题回退）
  .post(
    '/api/practice/runs/:userId/:runId/assemble',
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const runId = c.req.param('runId');
        const contentTool = deps.server.toolRegistry.get('learning.content');
        const res = await assemblePracticeRun(
          deps.repo,
          userId,
          runId,
          contentTool
            ? (contentTool as unknown as Parameters<typeof assemblePracticeRun>[3])
            : undefined
        );
        if (isOk(res)) return c.json(res);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'assemblePracticeRun');
      }
    }
  )
  // P5：读取运行的所有题目（按 block 聚合）
  .get('/api/practice/runs/:userId/:runId/items', async (c) => {
    try {
      const userId = c.req.param('userId');
      const runId = c.req.param('runId');
      const res = await deps.repo.getPracticeRunItems(userId, runId);
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error);
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'getPracticeRunItems');
    }
  })
  // P5-PhaseD：AI 计划建议（UI 直取，规则驱动从快照生成）
  .post(
    '/api/practice/templates/propose',
    validator('json', (value) => value as { userId: string; language: 'en' | 'ja' | 'ko' }),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const snapRes = await buildAnalysisSnapshot(deps.repo, body.userId);
        if (!isOk(snapRes)) return formatBusinessErrorResponse(c, snapRes.error);
        const proposal = createProposal(body.userId, body.language, snapRes.value);
        return c.json(proposal);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'proposeTemplate');
      }
    }
  )
  // P5-PhaseD：用户确认式 apply（校验一次性令牌后才保存模板）
  .post(
    '/api/practice/templates/apply-proposal',
    validator(
      'json',
      (value) =>
        value as {
          userId: string;
          proposalId: string;
          name?: string;
          blocks?: PracticeBlockSpec[];
        }
    ),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const consumeRes = consumeProposal(body.userId, body.proposalId);
        if (!isOk(consumeRes)) return formatBusinessErrorResponse(c, consumeRes.error);
        const proposal = consumeRes.value;
        const name = body.name?.trim() || proposal.suggestedName;
        const blocks = body.blocks && body.blocks.length > 0 ? body.blocks : proposal.blocks;
        const now = new Date().toISOString();
        const saveRes = await deps.repo.savePracticePlanTemplate({
          id: generateId('tpl'),
          userId: body.userId,
          language: proposal.language,
          name,
          enabled: true,
          revision: 0,
          blocks,
          createdAt: now,
          updatedAt: now,
        });
        if (isOk(saveRes)) return c.json(saveRes.value);
        return formatBusinessErrorResponse(c, saveRes.error);
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'applyProposal');
      }
    }
  )
  // P5-PhaseD：运行汇总与下次建议（只读，模型不可用回退本地规则）
  .get('/api/practice/runs/:userId/:runId/summary', async (c) => {
    try {
      const userId = c.req.param('userId');
      const runId = c.req.param('runId');
      const res = await summarizePracticeRun({ repo: deps.repo, userId, runId });
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error);
    } catch (e: unknown) {
      return formatBusinessErrorResponse(c, e, 'summarizePracticeRun');
    }
  })
  // 3b. 练习队列浏览与勾选转入 FSRS（collect ≠ 自动建卡）
  .get('/api/practice/collections/:userId', async (c) => {
    const userId = c.req.param('userId');
    const res = await deps.repo.listPracticeCollections(userId);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  .get('/api/practice/collections/:userId/:collectionId/items', async (c) => {
    const userId = c.req.param('userId');
    const collectionId = c.req.param('collectionId');
    const res = await deps.repo.listPracticeItems(userId, collectionId);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  .post(
    '/api/practice/items/:userId/to-cards',
    validator('json', (value) => value as { itemIds?: string[] }),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const body = c.req.valid('json');
        const itemIds = Array.isArray(body.itemIds)
          ? body.itemIds.map((id) => String(id))
          : [];
        const res = await deps.repo.convertPracticeItemsToCards(userId, itemIds);
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'convertPracticeItemsToCards');
      }
    }
  )
  // 5. AI 自适应靶向弱项出题与题库持久化
  .get('/api/questions/:userId', async (c) => {
    const userId = c.req.param('userId');
    const lang = c.req.query('lang');
    // 优先从 SQLite quiz_questions 获取持久化的题目列表
    const existingRes = await deps.repo.getQuestions(userId, undefined, lang);
    if (isOk(existingRes) && existingRes.value.length > 0) {
      // 展示侧出题门：超纲 / 讲义未学的题不列（快照读不到则 fail-open 全列，不挡展示）。
      const gate = await resolveStudyGate(deps.repo, userId, lang ?? '', null);
      const gated = existingRes.value.filter((q) => {
        const skill =
          (typeof q.testedSkillId === 'string' && q.testedSkillId) ||
          (typeof q.testedSkill === 'string' && q.testedSkill) ||
          null;
        const tier = typeof q.difficulty === 'number' ? q.difficulty : null;
        return isQuestionAllowed(skill, tier, gate.level, gate);
      });
      return c.json(gated);
    }
    const profileRes = await deps.repo.getLearnerProfile(userId);
    const targetLanguage = lang || (isOk(profileRes) ? profileRes.value.targetLanguage : 'ja');
    // C5：优先 learning.content；旧 quiz.generateAdaptive 仅兼容回退
    const contentTool = deps.server.toolRegistry.get('learning.content');
    if (contentTool) {
      const toolRes = await contentTool.execute(
        { action: 'generate_quiz', count: 2, language: targetLanguage, collect: true },
        { userId, sessionId: 'http_req' }
      );
      if (isOk(toolRes)) {
        // Tool 输出为信任边界：此处不断言内容合法性，仓储写入侧做中性回填。
        const generated = ((toolRes.value as { questions?: unknown }).questions ??
          []) as PersistableQuestion[];
        await deps.repo.saveQuestions(generated);
        return c.json(generated);
      }
      return formatBusinessErrorResponse(c, toolRes.error);
    }
    const tool = deps.server.toolRegistry.get('quiz.generateAdaptive');
    if (tool) {
      const toolRes = await tool.execute(
        { targetLanguage, count: 2 },
        { userId, sessionId: 'http_req' }
      );
      if (isOk(toolRes)) {
        const generated = ((toolRes.value as { questions?: unknown }).questions ??
          []) as PersistableQuestion[];
        await deps.repo.saveQuestions(generated);
        return c.json(generated);
      }
      return formatBusinessErrorResponse(c, toolRes.error);
    }
    return c.json([]);
  })
  .post(
    '/api/questions/:userId',
    validator('json', (value) => value as Record<string, unknown> | Record<string, unknown>[]),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const questionsToSave = Array.isArray(body) ? body : [body];
        const res = await deps.repo.saveQuestions(questionsToSave);
        if (isOk(res)) return c.json({ success: true, count: questionsToSave.length });
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'saveQuestions');
      }
    }
  )
;
}
