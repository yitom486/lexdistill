import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { BusinessError, isOk } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import {
  classifyStructure,
  type AllowedSkill,
} from '../application/pdf-import/structure-classify.js';
import { HeadingCandidateSchema, type HeadingCandidate } from '@study-studio/protocol';

/**
 * 文档结构分类（mini 分流观测）：
 * - POST /api/structure/classify：瞬时分类（不落库），输入 map 阶段标题候选；
 * - POST /api/documents/:userId/:documentId/structure：保存已验分类（一文档一行）；
 * - GET 同路径：读回（无记录返回 null）。
 * 模型与 effort 由前端显式传入（导入页独立选择，默认最末）；网关只做非空校验与透传。
 */
export function createDocumentStructureRoutes(deps: GatewayDeps) {
  return (
    new Hono()
      .post('/api/structure/classify', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as {
            headings?: unknown;
            lang?: unknown;
            model?: unknown;
            effort?: unknown;
          } | null;
          const rawHeadings = Array.isArray(body?.headings) ? body.headings : [];
          // 信任边界收窄：版式特征随 zod 契约一起验，多余键剥离、非法条目丢弃
          const headings: HeadingCandidate[] = rawHeadings
            .flatMap((h) => {
              const parsed = HeadingCandidateSchema.safeParse(h);
              return parsed.success ? [parsed.data] : [];
            })
            .filter((h) => h.text.trim())
            .slice(0, 200);
          if (headings.length === 0) {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', '没有可分类的标题候选', 'VALIDATION')
            );
          }
          const lang =
            body?.lang === 'en' || body?.lang === 'ko' ? body.lang : ('ja' as const);
          const lessonsRes = await deps.repo.listLessons('structure-classify', lang);
          const allowed: AllowedSkill[] = isOk(lessonsRes)
            ? lessonsRes.value.map((l) => ({ id: l.skillId, title: l.title }))
            : [];
          const model = typeof body?.model === 'string' && body.model ? body.model : undefined;
          const effort = typeof body?.effort === 'string' && body.effort ? body.effort : undefined;
          const res = await classifyStructure(deps.server.agentAdapter, {
            headings,
            allowedSkills: allowed,
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
          });
          if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'classifyStructure');
          return c.json({ ...res.value, allowedSkillIds: allowed.map((s) => s.id) });
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'classifyStructure');
        }
      })
      .post(
        '/api/documents/:userId/:documentId/structure',
        validator('json', (value) => value as Record<string, unknown>),
        async (c) => {
          try {
            const userId = c.req.param('userId');
            const documentId = c.req.param('documentId');
            const body = c.req.valid('json');
            const headings = (Array.isArray(body.headings) ? body.headings : [])
              .filter(
                (h): h is Record<string, unknown> => !!h && typeof h === 'object'
              )
              .map((h) => ({
                page: typeof h.page === 'number' ? h.page : 0,
                text: typeof h.text === 'string' ? h.text : '',
              }))
              .filter((h) => h.text && h.page > 0)
              .slice(0, 200);
            const classes = (Array.isArray(body.classes) ? body.classes : [])
              .filter(
                (x): x is Record<string, unknown> => !!x && typeof x === 'object'
              )
              .map((x) => ({
                text: typeof x.text === 'string' ? x.text : '',
                page: typeof x.page === 'number' ? x.page : 0,
                kind:
                  x.kind === 'lesson' || x.kind === 'section' || x.kind === 'toc' || x.kind === 'noise'
                    ? (x.kind as 'lesson' | 'section' | 'toc' | 'noise')
                    : ('noise' as const),
                lessonNo: typeof x.lessonNo === 'string' ? x.lessonNo : null,
                skillId: typeof x.skillId === 'string' ? x.skillId : null,
              }))
              .filter((x) => x.text);
            const res = await deps.repo.saveDocumentStructure(userId, documentId, {
              headings,
              classes,
              model: typeof body.model === 'string' ? body.model : '',
              effort: typeof body.effort === 'string' ? body.effort : '',
              dropped: typeof body.dropped === 'number' ? body.dropped : 0,
            });
            if (isOk(res)) return c.json(res.value);
            return formatBusinessErrorResponse(c, res.error, 'saveDocumentStructure');
          } catch (e) {
            return formatBusinessErrorResponse(c, e, 'saveDocumentStructure');
          }
        }
      )
      .get('/api/documents/:userId/:documentId/structure', async (c) => {
        try {
          const res = await deps.repo.getDocumentStructure(
            c.req.param('userId'),
            c.req.param('documentId')
          );
          if (isOk(res)) return c.json(res.value);
          return formatBusinessErrorResponse(c, res.error, 'getDocumentStructure');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'getDocumentStructure');
        }
      })
  );
}
