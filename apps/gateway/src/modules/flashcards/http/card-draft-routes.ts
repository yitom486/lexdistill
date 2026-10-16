import { Hono } from 'hono';
import { BusinessError, isOk } from '@lexdistill/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type {
  CardDraftSource,
  CardDraftStatus,
  ProposeCardDraftInput,
  UpdateCardDraftPatch,
} from '../persistence/card-drafts.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

const DRAFT_SOURCES = new Set(['ai-enrich', 'agent', 'import']);
const DRAFT_STATUSES = new Set(['pending', 'accepted', 'dismissed']);
const DRAFT_KINDS = new Set(['word', 'sentence']);
const DRAFT_CARD_TYPES = new Set(['VOCABULARY', 'GRAMMAR', 'CONFUSION_PAIR', 'SENTENCE']);

function narrowProposeBody(body: Record<string, unknown> | null): ProposeCardDraftInput | null {
  if (typeof body?.userId !== 'string' || !body.userId.trim()) return null;
  if (typeof body?.language !== 'string') return null;
  if (typeof body?.headword !== 'string' || !body.headword.trim()) return null;
  if (!Array.isArray(body?.meanings)) return null;
  if (typeof body?.source !== 'string' || !DRAFT_SOURCES.has(body.source)) return null;
  if (body?.kind !== undefined && (typeof body.kind !== 'string' || !DRAFT_KINDS.has(body.kind))) {
    return null;
  }
  if (
    body?.cardType !== undefined &&
    (typeof body.cardType !== 'string' || !DRAFT_CARD_TYPES.has(body.cardType))
  ) {
    return null;
  }
  const input: ProposeCardDraftInput = {
    userId: body.userId,
    language: body.language,
    headword: body.headword,
    meanings: body.meanings.filter((m): m is string => typeof m === 'string'),
    source: body.source as CardDraftSource,
  };
  if (typeof body?.reading === 'string') input.reading = body.reading;
  if (typeof body?.partOfSpeech === 'string') input.partOfSpeech = body.partOfSpeech;
  if (typeof body?.sourceRef === 'string') input.sourceRef = body.sourceRef;
  if (body?.kind === 'word' || body?.kind === 'sentence') input.kind = body.kind;
  if (
    body?.cardType === 'VOCABULARY' ||
    body?.cardType === 'GRAMMAR' ||
    body?.cardType === 'CONFUSION_PAIR' ||
    body?.cardType === 'SENTENCE'
  ) {
    input.cardType = body.cardType;
  }
  return input;
}

function narrowPatchBody(body: Record<string, unknown> | null): UpdateCardDraftPatch | null {
  if (!body) return null;
  const patch: UpdateCardDraftPatch = {};
  let touched = false;
  if (typeof body?.headword === 'string') {
    patch.headword = body.headword;
    touched = true;
  }
  if (typeof body?.reading === 'string') {
    patch.reading = body.reading;
    touched = true;
  }
  if (Array.isArray(body?.meanings)) {
    patch.meanings = body.meanings.filter((m): m is string => typeof m === 'string');
    touched = true;
  }
  if (typeof body?.partOfSpeech === 'string') {
    patch.partOfSpeech = body.partOfSpeech;
    touched = true;
  }
  return touched ? patch : null;
}

/** 生词草稿域路由：提议 → 列表 → 逐字段改 → 接受入库 / 驳回（与草稿 Tool 同命令）。 */
export function createCardDraftRoutes(deps: GatewayDeps) {
  return (
    new Hono()
      .post('/api/flashcards/drafts/propose', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as {
            drafts?: unknown;
          } | null;
          if (!Array.isArray(body?.drafts)) {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', '请提供 drafts 数组', 'VALIDATION')
            );
          }
          const inputs: ProposeCardDraftInput[] = [];
          for (const d of body.drafts) {
            const narrowed =
              d && typeof d === 'object'
                ? narrowProposeBody(d as Record<string, unknown>)
                : null;
            if (!narrowed) {
              return formatBusinessErrorResponse(
                c,
                new BusinessError('E_INVALID_INPUT', '某条草稿字段不正确', 'VALIDATION')
              );
            }
            inputs.push(narrowed);
          }
          const res = await deps.repo.proposeCardDrafts(inputs);
          if (isOk(res)) return c.json({ drafts: res.value });
          return formatBusinessErrorResponse(c, res.error, 'draftPropose');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'draftPropose');
        }
      })
      .get('/api/flashcards/drafts/:userId', async (c) => {
        const statusRaw = c.req.query('status') || 'pending';
        if (!DRAFT_STATUSES.has(statusRaw)) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', 'status 非法', 'VALIDATION')
          );
        }
        const limitRaw = Number(c.req.query('limit') ?? 50);
        const res = await deps.repo.listCardDrafts(
          c.req.param('userId'),
          c.req.query('lang') || 'ja',
          statusRaw as CardDraftStatus,
          Number.isFinite(limitRaw) ? limitRaw : 50
        );
        if (isOk(res)) return c.json({ drafts: res.value });
        return formatBusinessErrorResponse(c, res.error, 'draftList');
      })
      .patch('/api/flashcards/drafts/:userId/:draftId', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
          const patch = narrowPatchBody(body);
          if (!patch) {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', '没有可更新的字段', 'VALIDATION')
            );
          }
          const res = await deps.repo.updateCardDraft(
            c.req.param('userId'),
            c.req.param('draftId'),
            patch
          );
          if (isOk(res)) return c.json({ draft: res.value });
          return formatBusinessErrorResponse(c, res.error, 'draftUpdate');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'draftUpdate');
        }
      })
      .post('/api/flashcards/drafts/:userId/:draftId/accept', async (c) => {
        const res = await deps.repo.acceptCardDraft(c.req.param('userId'), c.req.param('draftId'));
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error, 'draftAccept');
      })
      .post('/api/flashcards/drafts/:userId/:draftId/dismiss', async (c) => {
        const res = await deps.repo.dismissCardDraft(
          c.req.param('userId'),
          c.req.param('draftId')
        );
        if (isOk(res)) return c.json({ draft: res.value });
        return formatBusinessErrorResponse(c, res.error, 'draftDismiss');
      })
  );
}
