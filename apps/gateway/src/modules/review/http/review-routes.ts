import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError } from '@study-studio/shared';
import { scheduleFsrsReviewV1 } from '@study-studio/review-core';
import { FlashcardSchema } from '@study-studio/protocol';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../transport/http/gateway-deps.js';

/** 复习域路由：FSRS 闪卡存取与复习（G2 迁移，行为不变）。 */
export function createReviewRoutes(deps: GatewayDeps) {
  return new Hono()
  // 3. FSRS 闪卡存取
  .get('/api/cards/:userId', async (c) => {
    const userId = c.req.param('userId');
    const lang = c.req.query('lang');
    const res = await deps.repo.getDueCards(userId, undefined, lang ? { language: lang } : undefined);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  .post(
    '/api/cards/:userId',
    validator('json', (value) => value as Record<string, unknown> | Record<string, unknown>[]),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const cardsToSave = Array.isArray(body) ? body : [body];
        for (const card of cardsToSave) {
          const parsed = FlashcardSchema.safeParse(card);
          if (!parsed.success) {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', '闪卡数据格式不正确，请检查后重试。', 'VALIDATION'),
              'saveCards'
            );
          }
          await deps.repo.saveCard(parsed.data);
        }
        return c.json({ success: true, count: cardsToSave.length });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'saveCards');
      }
    }
  )
  // 3a. 卡片复习评分：Gateway 为唯一 FSRS 计算与持久化者，前端只传 rating
  .post(
    '/api/cards/:userId/:cardId/review',
    validator('json', (value) => value as { rating?: unknown }),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const cardId = c.req.param('cardId');
        const { rating } = c.req.valid('json');
        if (rating !== 'AGAIN' && rating !== 'HARD' && rating !== 'GOOD' && rating !== 'EASY') {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供有效的复习评分。', 'VALIDATION'),
            'reviewCard'
          );
        }
        const cardsRes = await deps.repo.getDueCards(userId, 200);
        if (!isOk(cardsRes)) return formatBusinessErrorResponse(c, cardsRes.error, 'reviewCard');
        const targetCard = cardsRes.value.find((card) => card.id === cardId);
        if (!targetCard) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_NOT_FOUND', '未找到待复习卡片，请刷新后重试。', 'LEARNER_STATE'),
            'reviewCard'
          );
        }
        const currentFsrs = {
          stability: targetCard.fsrs.stability,
          difficulty: targetCard.fsrs.difficulty,
          reps: targetCard.fsrs.reps,
          lapses: targetCard.fsrs.lapses,
          dueAt: targetCard.fsrs.dueAt,
          state: targetCard.fsrs.state,
          ...(targetCard.fsrs.lastReviewedAt
            ? { lastReviewedAt: targetCard.fsrs.lastReviewedAt }
            : {}),
        };
        // M3-3：复习排程经版本化入口（单次请求共用一个 now；版本门失败走
        //  envelope 错误链返回，不抛原始异常、不静默回退；不持久化版本/trace）。
        const now = new Date();
        const scheduledRes = scheduleFsrsReviewV1({ state: currentFsrs, rating, now });
        if (!isOk(scheduledRes)) {
          return formatBusinessErrorResponse(c, scheduledRes.error, 'reviewCard');
        }
        const nextFsrs = scheduledRes.value.state;
        const commitRes = await deps.repo.commitReviewOutcome({
          userId,
          card: { ...targetCard, fsrs: nextFsrs },
          rating,
          scheduled: scheduledRes.value,
        });
        if (!isOk(commitRes)) return formatBusinessErrorResponse(c, commitRes.error, 'reviewCard');
        return c.json({
          success: true,
          cardId,
          nextFsrs,
          nextReviewDays: Math.max(1, Math.round(nextFsrs.stability)),
        });
      } catch (e: unknown) {
        return formatBusinessErrorResponse(c, e, 'reviewCard');
      }
    }
  )
  // 3b. 标记讲透（M2 学习门；幂等，卡不存在报 NOT_FOUND）。
  .post('/api/cards/:userId/:cardId/studied', async (c) => {
    const res = await deps.repo.markCardStudied(c.req.param('userId'), c.req.param('cardId'));
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error, 'markCardStudied');
  })
;
}
