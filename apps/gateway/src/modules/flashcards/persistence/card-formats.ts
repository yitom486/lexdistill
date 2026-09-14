import { eq } from 'drizzle-orm';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import {
  BUILTIN_CARD_FORMATS,
  getBuiltinCardFormat,
  validateCardFormat,
  type AnkiCardFormat,
} from '@study-studio/flashcards';
import { ankiCardFormats } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * 卡片模板包持久化（由 DrizzleLearnerRepository 委托调用）。
 * 模板是呈现资产：内置行懒播种；用户改过（user_modified=1）的行永不被内置升级覆盖。
 */

type CardFormatRow = typeof ankiCardFormats.$inferSelect;

/** DB 行 → 领域模板（读侧永不抛；fields_json 损坏回退空映射并如实校验报错）。 */
export function toCardFormat(row: CardFormatRow): AnkiCardFormat {
  let fields: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.fieldsJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') fields[k] = v;
      }
    }
  } catch {
    fields = {};
  }
  const format: AnkiCardFormat = {
    id: row.id,
    name: row.name,
    entryType: row.entryType,
    fields,
    frontTemplate: row.frontTemplate,
    backTemplate: row.backTemplate,
    css: row.css,
    templateVersion: row.templateVersion,
    userModified: row.userModified === 1,
  };
  if (row.deckName) format.deckName = row.deckName;
  if (row.modelName) format.modelName = row.modelName;
  return format;
}

/** 内置模板懒播种（缺哪行补哪行；用户行不动；未改过的旧版行自动跟进内置）。 */
export async function ensureBuiltinCardFormats(
  deps: RepoDeps
): Promise<Result<void, BusinessError>> {
  try {
    const rows = await deps.db.select().from(ankiCardFormats);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const now = nowIso();
    for (const builtin of BUILTIN_CARD_FORMATS) {
      const existing = byId.get(builtin.id);
      if (!existing) {
        await deps.db.insert(ankiCardFormats).values({
          id: builtin.id,
          name: builtin.name,
          entryType: builtin.entryType,
          deckName: builtin.deckName ?? null,
          modelName: builtin.modelName ?? null,
          fieldsJson: JSON.stringify(builtin.fields),
          frontTemplate: builtin.frontTemplate,
          backTemplate: builtin.backTemplate,
          css: builtin.css,
          templateVersion: builtin.templateVersion,
          userModified: 0,
          updatedAt: now,
        });
      } else if (existing.userModified === 0 && existing.templateVersion < builtin.templateVersion) {
        // 用户没改过：跟进内置新版（如声调阶梯图字段）；改过的一律不动。
        await deps.db
          .update(ankiCardFormats)
          .set({
            name: builtin.name,
            entryType: builtin.entryType,
            deckName: builtin.deckName ?? null,
            modelName: builtin.modelName ?? null,
            fieldsJson: JSON.stringify(builtin.fields),
            frontTemplate: builtin.frontTemplate,
            backTemplate: builtin.backTemplate,
            css: builtin.css,
            templateVersion: builtin.templateVersion,
            updatedAt: now,
          })
          .where(eq(ankiCardFormats.id, builtin.id));
      }
    }
    return ok(undefined);
  } catch (e) {
    return err(translateToBusinessError(e, 'ensureBuiltinCardFormats'));
  }
}

export async function listCardFormats(
  deps: RepoDeps
): Promise<Result<AnkiCardFormat[], BusinessError>> {
  try {
    const seeded = await ensureBuiltinCardFormats(deps);
    if (!isOk(seeded)) return seeded;
    const rows = await deps.db.select().from(ankiCardFormats);
    return ok(rows.map(toCardFormat).sort((a, b) => a.id.localeCompare(b.id)));
  } catch (e) {
    return err(translateToBusinessError(e, 'listCardFormats'));
  }
}

export interface SaveCardFormatInput {
  id: string;
  name: string;
  entryType?: string | undefined;
  deckName?: string | undefined;
  modelName?: string | undefined;
  fields: Record<string, string>;
  frontTemplate: string;
  backTemplate: string;
  css: string;
}

const FORMAT_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const ENTRY_TYPES = new Set(['term', 'kanji', 'sentence']);

/** 输入收窄（信任边界：HTTP/Tool 入参先收窄再使用）。 */
export function narrowSaveCardFormatInput(input: unknown): SaveCardFormatInput | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const v = input as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || !FORMAT_ID_PATTERN.test(v['id'])) return undefined;
  if (typeof v['name'] !== 'string' || v['name'].trim().length === 0 || v['name'].length > 64) {
    return undefined;
  }
  if (
    !v['fields'] ||
    typeof v['fields'] !== 'object' ||
    Array.isArray(v['fields']) ||
    Object.keys(v['fields']).length === 0 ||
    Object.keys(v['fields']).length > 32
  ) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  for (const [k, val] of Object.entries(v['fields'] as Record<string, unknown>)) {
    if (typeof val !== 'string' || val.length > 8000) return undefined;
    fields[k] = val;
  }
  if (typeof v['frontTemplate'] !== 'string' || v['frontTemplate'].length > 20000) return undefined;
  if (typeof v['backTemplate'] !== 'string' || v['backTemplate'].length > 20000) return undefined;
  if (typeof v['css'] !== 'string' || v['css'].length > 20000) return undefined;
  const narrowed: SaveCardFormatInput = {
    id: v['id'],
    name: v['name'].trim(),
    fields,
    frontTemplate: v['frontTemplate'],
    backTemplate: v['backTemplate'],
    css: v['css'],
  };
  if (typeof v['entryType'] === 'string' && ENTRY_TYPES.has(v['entryType'])) {
    narrowed.entryType = v['entryType'];
  }
  if (typeof v['deckName'] === 'string' && v['deckName'].length <= 64) {
    narrowed.deckName = v['deckName'];
  }
  if (typeof v['modelName'] === 'string' && v['modelName'].length <= 64) {
    narrowed.modelName = v['modelName'];
  }
  return narrowed;
}

/** 保存模板（新建或覆盖；一律标 user_modified=1；校验不通过拒绝写入）。 */
export async function saveCardFormat(
  deps: RepoDeps,
  input: SaveCardFormatInput
): Promise<Result<AnkiCardFormat, BusinessError>> {
  try {
    await ensureBuiltinCardFormats(deps);
    const existing = await deps.db
      .select()
      .from(ankiCardFormats)
      .where(eq(ankiCardFormats.id, input.id));
    const prev = existing[0];
    const candidate: AnkiCardFormat = {
      id: input.id,
      name: input.name,
      entryType: input.entryType ?? prev?.entryType ?? 'term',
      fields: input.fields,
      frontTemplate: input.frontTemplate,
      backTemplate: input.backTemplate,
      css: input.css,
      templateVersion: (prev?.templateVersion ?? getBuiltinCardFormat(input.id)?.templateVersion ?? 0) + 1,
      userModified: true,
    };
    if (input.deckName !== undefined) candidate.deckName = input.deckName;
    else if (prev?.deckName) candidate.deckName = prev.deckName;
    if (input.modelName !== undefined) candidate.modelName = input.modelName;
    else if (prev?.modelName) candidate.modelName = prev.modelName;
    const issues = validateCardFormat(candidate);
    if (issues.length > 0) {
      return err(
        new BusinessError(
          'E_INVALID_INPUT',
          `卡片模板校验未通过：${issues[0]}`,
          'VALIDATION',
          false
        )
      );
    }
    const values = {
      id: candidate.id,
      name: candidate.name,
      entryType: candidate.entryType,
      deckName: candidate.deckName ?? null,
      modelName: candidate.modelName ?? null,
      fieldsJson: JSON.stringify(candidate.fields),
      frontTemplate: candidate.frontTemplate,
      backTemplate: candidate.backTemplate,
      css: candidate.css,
      templateVersion: candidate.templateVersion,
      userModified: 1,
      updatedAt: nowIso(),
    };
    if (prev) {
      await deps.db.update(ankiCardFormats).set(values).where(eq(ankiCardFormats.id, input.id));
    } else {
      await deps.db.insert(ankiCardFormats).values(values);
    }
    return ok(candidate);
  } catch (e) {
    return err(translateToBusinessError(e, 'saveCardFormat'));
  }
}

/** 恢复内置（仅内置 id 可恢复；自定义模板无内置可回，拒绝并明说）。 */
export async function resetCardFormat(
  deps: RepoDeps,
  id: string
): Promise<Result<AnkiCardFormat, BusinessError>> {
  try {
    const builtin = getBuiltinCardFormat(id);
    if (!builtin) {
      return err(
        new BusinessError('E_INVALID_INPUT', '自定义模板没有内置版本可恢复', 'VALIDATION', false)
      );
    }
    await ensureBuiltinCardFormats(deps);
    await deps.db
      .update(ankiCardFormats)
      .set({
        name: builtin.name,
        entryType: builtin.entryType,
        deckName: builtin.deckName ?? null,
        modelName: builtin.modelName ?? null,
        fieldsJson: JSON.stringify(builtin.fields),
        frontTemplate: builtin.frontTemplate,
        backTemplate: builtin.backTemplate,
        css: builtin.css,
        templateVersion: builtin.templateVersion,
        userModified: 0,
        updatedAt: nowIso(),
      })
      .where(eq(ankiCardFormats.id, id));
    return ok({ ...builtin });
  } catch (e) {
    return err(translateToBusinessError(e, 'resetCardFormat'));
  }
}

/** 按 id 取模板（读侧永不抛；找不到返回 undefined，由调用方决定报错）。 */
export async function getCardFormat(
  deps: RepoDeps,
  id: string
): Promise<AnkiCardFormat | undefined> {
  try {
    await ensureBuiltinCardFormats(deps);
    const rows = await deps.db
      .select()
      .from(ankiCardFormats)
      .where(eq(ankiCardFormats.id, id));
    const row = rows[0];
    return row ? toCardFormat(row) : undefined;
  } catch {
    return undefined;
  }
}
