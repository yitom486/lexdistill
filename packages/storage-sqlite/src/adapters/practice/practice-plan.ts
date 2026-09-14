import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
  isOk,
} from '@study-studio/shared';
import type {
  PracticePlanTemplate,
  PracticePlanRun,
  PracticeItemAttempt,
  PracticeBlockSpec,
  PracticeRunStatus,
  GeneratedQuestion,
} from '@study-studio/protocol';
import { PracticePlanScheduleSchema } from '@study-studio/protocol';
import {
  validatePracticePlanTemplate,
  freezeRunFromTemplate,
  parsePracticeBlockSpecs,
} from '@study-studio/learning';
import {
  practicePlanTemplates,
  practicePlanRuns,
  practiceItemAttempts,
  practiceCollections,
  practiceItems,
  quizAttempts,
} from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';
import { safeJsonParse } from '@study-studio/shared';

/**
 * D3 起家在 storage-sqlite（前身 gateway modules/practice/persistence/practice-plan.ts，
 * 逻辑不变）。参数收窄为 `{ db }`；learning 纯函数引用经 commander 特批（见包 README）。
 */

/**
 * 练习计划域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域互调直接调模块函数。
 */

export async function savePracticePlanTemplate(
  deps: { db: DrizzleDb },
  template: PracticePlanTemplate
): Promise<Result<PracticePlanTemplate, BusinessError>> {
  try {
    // 领域校验
    const vres = validatePracticePlanTemplate(template);
    if (!isOk(vres)) {
      return err(vres.error);
    }
    const now = nowIso();
    const existing = await deps.db
      .select()
      .from(practicePlanTemplates)
      .where(and(eq(practicePlanTemplates.id, template.id), eq(practicePlanTemplates.userId, template.userId)))
      .limit(1);
    const nextRevision =
      existing.length > 0 ? (existing[0]!.revision ?? 0) + 1 : 1;
    const payload = {
      id: template.id,
      userId: template.userId,
      language: template.language,
      name: template.name,
      enabled: template.enabled ? 1 : 0,
      revision: nextRevision,
      blocksJson: JSON.stringify(template.blocks),
      scheduleJson: template.schedule ? JSON.stringify(template.schedule) : null,
      createdAt: existing.length > 0 ? existing[0]!.createdAt : now,
      updatedAt: now,
    };
    if (existing.length > 0) {
      await deps.db
        .update(practicePlanTemplates)
        .set({ name: payload.name, enabled: payload.enabled, revision: payload.revision, blocksJson: payload.blocksJson, scheduleJson: payload.scheduleJson, updatedAt: now })
        .where(eq(practicePlanTemplates.id, template.id));
    } else {
      await deps.db.insert(practicePlanTemplates).values(payload);
    }
    return ok({ ...template, revision: nextRevision, createdAt: payload.createdAt, updatedAt: now });
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'savePracticePlanTemplate', entityId: template.id }));
  }
}

export async function listPracticePlanTemplates(
  deps: { db: DrizzleDb },
  userId: string,
  opts?: { language?: string | undefined; includeDisabled?: boolean | undefined }
): Promise<Result<PracticePlanTemplate[], BusinessError>> {
  try {
    const conds = [eq(practicePlanTemplates.userId, userId)];
    if (opts?.language) conds.push(eq(practicePlanTemplates.language, opts.language));
    if (!opts?.includeDisabled) conds.push(eq(practicePlanTemplates.enabled, 1));
    const rows = await deps.db
      .select()
      .from(practicePlanTemplates)
      .where(and(...conds))
      .orderBy(desc(practicePlanTemplates.updatedAt));
    return ok(rows.map((r) => mapTemplateRow(r)));
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'listPracticePlanTemplates', entityId: userId }));
  }
}

export async function getPracticePlanTemplate(
  deps: { db: DrizzleDb },
  userId: string,
  templateId: string
): Promise<Result<PracticePlanTemplate | null, BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(practicePlanTemplates)
      .where(and(eq(practicePlanTemplates.id, templateId), eq(practicePlanTemplates.userId, userId)))
      .limit(1);
    if (rows.length === 0) return ok(null);
    return ok(mapTemplateRow(rows[0]!));
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'getPracticePlanTemplate', entityId: templateId }));
  }
}

export async function deletePracticePlanTemplate(
  deps: { db: DrizzleDb },
  userId: string,
  templateId: string
): Promise<Result<void, BusinessError>> {
  try {
    await deps.db
      .delete(practicePlanTemplates)
      .where(and(eq(practicePlanTemplates.id, templateId), eq(practicePlanTemplates.userId, userId)));
    return ok(undefined);
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'deletePracticePlanTemplate', entityId: templateId }));
  }
}

export async function setPracticePlanTemplateEnabled(
  deps: { db: DrizzleDb },
  userId: string,
  templateId: string,
  enabled: boolean
): Promise<Result<PracticePlanTemplate | null, BusinessError>> {
  try {
    const existing = await deps.db
      .select({ id: practicePlanTemplates.id })
      .from(practicePlanTemplates)
      .where(and(eq(practicePlanTemplates.id, templateId), eq(practicePlanTemplates.userId, userId)))
      .limit(1);
    if (existing.length === 0) return ok(null);
    await deps.db
      .update(practicePlanTemplates)
      .set({ enabled: enabled ? 1 : 0, updatedAt: nowIso() })
      .where(and(eq(practicePlanTemplates.id, templateId), eq(practicePlanTemplates.userId, userId)));
    return await getPracticePlanTemplate(deps, userId, templateId);
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'setPracticePlanTemplateEnabled', entityId: templateId }));
  }
}

export async function copyPracticePlanTemplate(
  deps: { db: DrizzleDb },
  userId: string,
  templateId: string
): Promise<Result<PracticePlanTemplate, BusinessError>> {
  const sourceRes = await getPracticePlanTemplate(deps, userId, templateId);
  if (!isOk(sourceRes)) return err(sourceRes.error);
  const source = sourceRes.value;
  if (!source) {
    return err(new BusinessError('E_PRACTICE_TEMPLATE_NOT_FOUND', '要复制的练习计划模板不存在，可能已被删除', 'VALIDATION'));
  }
  const copy: PracticePlanTemplate = {
    ...source,
    id: generateId('tpl'),
    name: `${source.name}（副本）`,
    enabled: false,
    revision: 0,
    blocks: source.blocks.map((b) => ({ ...b, id: generateId('blk') })),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return await savePracticePlanTemplate(deps, copy);
}

export async function startPracticePlanRun(
  deps: { db: DrizzleDb },
  userId: string,
  params: {
    language: 'en' | 'ja' | 'ko';
    templateId?: string | undefined;
    blocks?: PracticeBlockSpec[] | undefined;
  }
): Promise<Result<PracticePlanRun, BusinessError>> {
  try {
    let run: PracticePlanRun;
    if (params.templateId) {
      const tres = await getPracticePlanTemplate(deps, userId, params.templateId);
      if (!isOk(tres) || !tres.value) {
        return err(new BusinessError('E_TEMPLATE_NOT_FOUND', '计划模板未找到', 'DATABASE'));
      }
      run = freezeRunFromTemplate({ template: tres.value, runId: generateId('prun') });
    } else if (params.blocks && params.blocks.length > 0) {
      run = {
        id: generateId('prun'),
        userId,
        language: params.language,
        templateId: undefined,
        templateRevision: undefined,
        blocks: params.blocks.map((b) => ({ ...b })),
        status: 'IN_PROGRESS',
        startedAt: nowIso(),
        createdAt: nowIso(),
      };
    } else {
      return err(new BusinessError('E_INVALID_RUN', '必须提供 templateId 或 blocks', 'VALIDATION'));
    }
    await deps.db.insert(practicePlanRuns).values({
      id: run.id,
      userId,
      language: run.language,
      templateId: run.templateId ?? null,
      templateRevision: run.templateRevision ?? null,
      blocksJson: JSON.stringify(run.blocks),
      status: run.status,
      startedAt: run.startedAt,
      completedAt: null,
      createdAt: run.createdAt,
    });
    return ok(run);
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'startPracticePlanRun', entityId: userId }));
  }
}

export async function getPracticePlanRun(
  deps: { db: DrizzleDb },
  userId: string,
  runId: string
): Promise<Result<PracticePlanRun | null, BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(practicePlanRuns)
      .where(and(eq(practicePlanRuns.id, runId), eq(practicePlanRuns.userId, userId)))
      .limit(1);
    if (rows.length === 0) return ok(null);
    return ok(mapRunRow(rows[0]!));
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'getPracticePlanRun', entityId: runId }));
  }
}

export async function listPracticePlanRuns(
  deps: { db: DrizzleDb },
  userId: string,
  opts?: { language?: string | undefined; status?: PracticeRunStatus | undefined }
): Promise<Result<PracticePlanRun[], BusinessError>> {
  try {
    const conds = [eq(practicePlanRuns.userId, userId)];
    if (opts?.language) conds.push(eq(practicePlanRuns.language, opts.language));
    if (opts?.status) conds.push(eq(practicePlanRuns.status, opts.status));
    const rows = await deps.db
      .select()
      .from(practicePlanRuns)
      .where(and(...conds))
      .orderBy(desc(practicePlanRuns.createdAt));
    return ok(rows.map((r) => mapRunRow(r)));
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'listPracticePlanRuns', entityId: userId }));
  }
}

export async function savePracticeItemDraft(
  deps: { db: DrizzleDb },
  userId: string,
  runId: string,
  itemId: string,
  userAnswer: string
): Promise<Result<PracticeItemAttempt, BusinessError>> {
  try {
    const runRes = await getPracticePlanRun(deps, userId, runId);
    if (!isOk(runRes) || !runRes.value) {
      return err(new BusinessError('E_RUN_NOT_FOUND', '练习运行未找到', 'DATABASE'));
    }
    const existing = await deps.db
      .select()
      .from(practiceItemAttempts)
      .where(and(eq(practiceItemAttempts.runId, runId), eq(practiceItemAttempts.itemId, itemId)))
      .limit(1);
    const now = nowIso();
    if (existing.length > 0) {
      const row = existing[0]!;
      await deps.db
        .update(practiceItemAttempts)
        .set({ userAnswer, status: 'DRAFT' })
        .where(eq(practiceItemAttempts.id, row.id));
      return ok(mapAttemptRow({ ...row, userAnswer, status: 'DRAFT' }));
    }
    const id = generateId('patt');
    await deps.db.insert(practiceItemAttempts).values({
      id,
      runId,
      blockId: '',
      itemId,
      status: 'DRAFT',
      userAnswer,
      gradingResultJson: null,
      timeSpentMs: null,
      submittedAt: null,
      gradedAt: null,
    });
    return ok({
      id,
      runId,
      blockId: '',
      itemId,
      status: 'DRAFT',
      userAnswer,
      timeSpentMs: undefined,
      submittedAt: undefined,
      gradedAt: undefined,
    });
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'savePracticeItemDraft', entityId: runId }));
  }
}

export async function submitPracticeItem(
  deps: { db: DrizzleDb },
  userId: string,
  runId: string,
  itemId: string,
  userAnswer: string,
  gradingResult?: Record<string, unknown>,
  timeSpentMs?: number
): Promise<Result<PracticeItemAttempt, BusinessError>> {
  try {
    const runRes = await getPracticePlanRun(deps, userId, runId);
    if (!isOk(runRes) || !runRes.value) {
      return err(new BusinessError('E_RUN_NOT_FOUND', '练习运行未找到', 'DATABASE'));
    }
    const now = nowIso();
    const existing = await deps.db
      .select()
      .from(practiceItemAttempts)
      .where(and(eq(practiceItemAttempts.runId, runId), eq(practiceItemAttempts.itemId, itemId)))
      .limit(1);
    const status: 'SUBMITTED' | 'GRADED' = gradingResult ? 'GRADED' : 'SUBMITTED';
    if (existing.length > 0) {
      const row = existing[0]!;
      await deps.db
        .update(practiceItemAttempts)
        .set({
          userAnswer,
          status,
          gradingResultJson: gradingResult ? JSON.stringify(gradingResult) : row.gradingResultJson,
          timeSpentMs: timeSpentMs ?? row.timeSpentMs,
          submittedAt: row.submittedAt ?? now,
          gradedAt: status === 'GRADED' ? now : row.gradedAt,
        })
        .where(eq(practiceItemAttempts.id, row.id));
      return ok(
        mapAttemptRow({
          ...row,
          userAnswer,
          status,
          gradingResultJson: gradingResult ? JSON.stringify(gradingResult) : row.gradingResultJson,
          timeSpentMs: timeSpentMs ?? row.timeSpentMs,
          submittedAt: row.submittedAt ?? now,
          gradedAt: status === 'GRADED' ? now : row.gradedAt,
        })
      );
    }
    const id = generateId('patt');
    await deps.db.insert(practiceItemAttempts).values({
      id,
      runId,
      blockId: '',
      itemId,
      status,
      userAnswer,
      gradingResultJson: gradingResult ? JSON.stringify(gradingResult) : null,
      timeSpentMs: timeSpentMs ?? null,
      submittedAt: now,
      gradedAt: status === 'GRADED' ? now : null,
    });
    return ok({
      id,
      runId,
      blockId: '',
      itemId,
      status,
      userAnswer,
      gradingResult: gradingResult,
      timeSpentMs,
      submittedAt: now,
      gradedAt: status === 'GRADED' ? now : undefined,
    });
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'submitPracticeItem', entityId: runId }));
  }
}

export async function listPracticeItemAttempts(
  deps: { db: DrizzleDb },
  runId: string
): Promise<Result<PracticeItemAttempt[], BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(practiceItemAttempts)
      .where(eq(practiceItemAttempts.runId, runId));
    return ok(rows.map((r) => mapAttemptRow(r)));
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'listPracticeItemAttempts', entityId: runId }));
  }
}

/** P5：按 run 聚合所有关联集合的题目（practice_collections.plan_run_id = runId）。 */
export async function getPracticeRunItems(
  deps: { db: DrizzleDb },
  userId: string,
  runId: string
): Promise<Result<Array<{ itemId: string; blockId: string; gradingMode: string; question: GeneratedQuestion }>, BusinessError>> {
  try {
    const cols = await deps.db
      .select()
      .from(practiceCollections)
      .where(and(eq(practiceCollections.userId, userId), eq(practiceCollections.planRunId, runId)));
    if (cols.length === 0) return ok([]);
    const collectionIds = cols.map((c) => c.id);
    const itemRows = await deps.db
      .select()
      .from(practiceItems)
      .where(inArray(practiceItems.collectionId, collectionIds))
      .orderBy(asc(practiceItems.sortOrder));
    const colByBlock = new Map(cols.map((c) => [c.id, { blockId: c.blockId ?? '', gradingMode: c.gradingMode ?? 'AUTO_IMMEDIATE' }]));
    const out = itemRows.map((r) => {
      const meta = colByBlock.get(r.collectionId) ?? { blockId: '', gradingMode: 'AUTO_IMMEDIATE' };
      const question = safeJsonParse(r.questionJson) as GeneratedQuestion;
      return {
        itemId: r.id,
        blockId: meta.blockId,
        gradingMode: meta.gradingMode,
        question,
      };
    });
    return ok(out);
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'getPracticeRunItems', entityId: runId }));
  }
}

function mapTemplateRow(r: typeof practicePlanTemplates.$inferSelect): PracticePlanTemplate {
  const blocks = parsePracticeBlockSpecs(safeJsonParse(r.blocksJson)) ?? [];
  // 排程损坏或缺失一律视为无排程（每日适用），绝不臆造
  const scheduleParsed = r.scheduleJson
    ? PracticePlanScheduleSchema.safeParse(safeJsonParse(r.scheduleJson))
    : null;
  return {
    id: r.id,
    userId: r.userId,
    language: r.language as 'en' | 'ja' | 'ko',
    name: r.name,
    enabled: r.enabled === 1,
    revision: r.revision,
    blocks,
    ...(scheduleParsed && scheduleParsed.success ? { schedule: scheduleParsed.data } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapRunRow(r: typeof practicePlanRuns.$inferSelect): PracticePlanRun {
  const blocks = parsePracticeBlockSpecs(safeJsonParse(r.blocksJson)) ?? [];
  return {
    id: r.id,
    userId: r.userId,
    language: r.language as 'en' | 'ja' | 'ko',
    templateId: r.templateId ?? undefined,
    templateRevision: r.templateRevision ?? undefined,
    blocks,
    status: r.status as PracticeRunStatus,
    startedAt: r.startedAt,
    completedAt: r.completedAt ?? undefined,
    createdAt: r.createdAt,
  };
}

function mapAttemptRow(r: typeof practiceItemAttempts.$inferSelect): PracticeItemAttempt {
  return {
    id: r.id,
    runId: r.runId,
    blockId: r.blockId,
    itemId: r.itemId,
    status: r.status as PracticeItemAttempt['status'],
    userAnswer: r.userAnswer ?? undefined,
    gradingResult: r.gradingResultJson ? (safeJsonParse(r.gradingResultJson) as Record<string, unknown>) : undefined,
    timeSpentMs: r.timeSpentMs ?? undefined,
    submittedAt: r.submittedAt ?? undefined,
    gradedAt: r.gradedAt ?? undefined,
  };
}
