import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
  logger,
} from '@study-studio/shared';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import {
  buildTermKey,
  recordTermExposure,
} from '../../dictionary/public.js';
import { CardTypeSchema, type CardType } from '@study-studio/protocol';
import { initFsrsState } from '@study-studio/learning-algorithms';
import { getVisibleDocument } from '@study-studio/storage-sqlite';

/**
 * 生词草稿（CardDraft）域：AI/导入提议 → 用户逐字段确认 → 入库成卡。
 * - 去重键 (user_id, language, term_key, source_ref)：同一来源重复提议跳过，
 *   已有 pending 草稿绝不覆写——用户已编辑字段默认禁止覆盖（字段锁语义雏形）；
 * - kind=word 走单词链（accept 回填相遇词）；kind=sentence 走句子链
 *   （accept 不记相遇词——整句进相遇词是污染，见 STATIC #54 规则）；
 * - accept 与建卡 + 相遇词回填同事务；任一步失败整单回滚并如实报错。
 */

export type CardDraftSource = 'ai-enrich' | 'agent' | 'import';
export type CardDraftStatus = 'pending' | 'accepted' | 'dismissed';
export type CardDraftKind = 'word' | 'sentence';

const SUPPORTED_LANGUAGES = new Set(['ja', 'en', 'ko']);
const SUPPORTED_SOURCES: ReadonlySet<string> = new Set(['ai-enrich', 'agent', 'import']);
const SUPPORTED_STATUSES: ReadonlySet<string> = new Set(['pending', 'accepted', 'dismissed']);
const SUPPORTED_KINDS: ReadonlySet<string> = new Set(['word', 'sentence']);
const SUPPORTED_CARD_TYPES: ReadonlySet<string> = new Set([
  'VOCABULARY',
  'GRAMMAR',
  'CONFUSION_PAIR',
  'SENTENCE',
]);
const EDITABLE_FIELDS = new Set(['headword', 'reading', 'meanings', 'partOfSpeech']);

export interface CardDraft {
  id: string;
  userId: string;
  language: string;
  termKey: string;
  headword: string;
  reading?: string | undefined;
  meanings: string[];
  partOfSpeech?: string | undefined;
  source: CardDraftSource;
  sourceRef?: string | undefined;
  kind: CardDraftKind;
  cardType: CardType;
  status: CardDraftStatus;
  editedFields: string[];
  flashcardId?: string | undefined;
  /** P4-1 选区关联（提议时校验归属，接受时原样保留）。 */
  selectionContextId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface ProposeCardDraftInput {
  userId: string;
  language: string;
  headword: string;
  reading?: string | undefined;
  meanings: string[];
  partOfSpeech?: string | undefined;
  source: CardDraftSource;
  sourceRef?: string | undefined;
  kind?: CardDraftKind | undefined;
  cardType?: CardType | undefined;
  selectionContextId?: string | undefined;
}

interface CardDraftRow {
  id: string;
  user_id: string;
  language: string;
  term_key: string;
  headword: string;
  reading: string | null;
  meanings_json: string;
  part_of_speech: string | null;
  source: string;
  source_ref: string | null;
  kind: string | null;
  card_type: string | null;
  status: string;
  edited_fields_json: string;
  flashcard_id: string | null;
  selection_context_id: string | null;
  created_at: string;
  updated_at: string;
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((m): m is string => typeof m === 'string');
  } catch {
    /* 损坏值回退空数组，读侧永不抛 */
  }
  return [];
}

function toCardDraft(row: CardDraftRow): CardDraft {
  const kind: CardDraftKind = row.kind === 'sentence' ? 'sentence' : 'word';
  const parsedType = typeof row.card_type === 'string' ? CardTypeSchema.safeParse(row.card_type) : null;
  const draft: CardDraft = {
    id: row.id,
    userId: row.user_id,
    language: row.language,
    termKey: row.term_key,
    headword: row.headword,
    meanings: parseStringArray(row.meanings_json),
    source: SUPPORTED_SOURCES.has(row.source) ? (row.source as CardDraftSource) : 'agent',
    kind,
    cardType:
      parsedType && parsedType.success
        ? parsedType.data
        : kind === 'sentence'
          ? 'SENTENCE'
          : 'VOCABULARY',
    status: SUPPORTED_STATUSES.has(row.status) ? (row.status as CardDraftStatus) : 'pending',
    editedFields: parseStringArray(row.edited_fields_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.reading) draft.reading = row.reading;
  if (row.part_of_speech) draft.partOfSpeech = row.part_of_speech;
  if (row.source_ref) draft.sourceRef = row.source_ref;
  if (row.flashcard_id) draft.flashcardId = row.flashcard_id;
  if (row.selection_context_id) draft.selectionContextId = row.selection_context_id;
  return draft;
}

const DRAFT_COLUMNS = `id, user_id, language, term_key, headword, reading, meanings_json,
  part_of_speech, source, source_ref, kind, card_type, status, edited_fields_json, flashcard_id, selection_context_id, created_at, updated_at`;

interface NarrowedPropose {
  userId: string;
  language: string;
  headword: string;
  reading?: string | undefined;
  meanings: string[];
  partOfSpeech?: string | undefined;
  source: CardDraftSource;
  sourceRef?: string | undefined;
  kind: CardDraftKind;
  cardType: CardType;
  selectionContextId?: string | undefined;
}

function narrowProposeInput(
  input: ProposeCardDraftInput
): { ok: true; value: NarrowedPropose } | { ok: false; error: BusinessError } {
  const userId = input.userId.trim();
  if (!userId || userId.length > 64) {
    return { ok: false, error: new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION') };
  }
  if (!SUPPORTED_LANGUAGES.has(input.language)) {
    return {
      ok: false,
      error: new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'),
    };
  }
  if (input.kind !== undefined && !SUPPORTED_KINDS.has(input.kind)) {
    return { ok: false, error: new BusinessError('E_INVALID_INPUT', 'kind 非法', 'VALIDATION') };
  }
  const kind: CardDraftKind = input.kind ?? 'word';
  // 词面长度按 kind 收敛：单词 64，句子 500（课文长句不断尾；键冲突由去重守卫兜底）。
  const headword = input.headword.trim().slice(0, kind === 'sentence' ? 500 : 64);
  if (!headword) {
    return { ok: false, error: new BusinessError('E_INVALID_INPUT', 'headword 为空', 'VALIDATION') };
  }
  if (!SUPPORTED_SOURCES.has(input.source)) {
    return { ok: false, error: new BusinessError('E_INVALID_INPUT', 'source 非法', 'VALIDATION') };
  }
  if (input.cardType !== undefined) {
    const parsed = CardTypeSchema.safeParse(input.cardType);
    if (!parsed.success) {
      return { ok: false, error: new BusinessError('E_INVALID_INPUT', 'cardType 非法', 'VALIDATION') };
    }
  }
  const cardType: CardType =
    input.cardType ?? (kind === 'sentence' ? 'SENTENCE' : 'VOCABULARY');
  const meanings = input.meanings
    .filter((m) => typeof m === 'string')
    .map((m) => m.trim())
    .filter((m) => m)
    .slice(0, 12);
  if (meanings.length === 0) {
    return {
      ok: false,
      error: new BusinessError('E_INVALID_INPUT', 'meanings 至少一条', 'VALIDATION'),
    };
  }
  const selectionContextId = (input.selectionContextId ?? '').trim() || undefined;
  return {
    ok: true,
    value: {
      userId,
      language: input.language,
      headword,
      meanings,
      source: input.source,
      kind,
      cardType: cardType,
      ...(input.reading !== undefined ? { reading: input.reading } : {}),
      ...(input.partOfSpeech !== undefined ? { partOfSpeech: input.partOfSpeech } : {}),
      ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
      ...(selectionContextId ? { selectionContextId } : {}),
    },
  };
}

/** 批量提议（幂等：同键 pending 已存在则跳过；返回实际新建）。 */
export async function proposeCardDrafts(
  deps: RepoDeps,
  inputs: ProposeCardDraftInput[]
): Promise<Result<CardDraft[], BusinessError>> {
  if (inputs.length === 0 || inputs.length > 50) {
    return err(new BusinessError('E_INVALID_INPUT', '单次提议 1–50 条', 'VALIDATION'));
  }
  const narrowed: NarrowedPropose[] = [];
  for (const input of inputs) {
    const r = narrowProposeInput(input);
    if (!r.ok) return err(r.error);
    narrowed.push(r.value);
  }
  try {
    const now = nowIso();
    const created: CardDraft[] = [];
    const tx = deps.sqlite.transaction(() => {
      for (const value of narrowed) {
        const reading = (value.reading ?? '').trim().slice(0, 64);
        const termKey = buildTermKey(value.headword, reading);
        const sourceRef = (value.sourceRef ?? '').trim().slice(0, 256);
        const existing = deps.sqlite
          .query(
            `SELECT id AS id FROM card_drafts
             WHERE user_id = ? AND language = ? AND term_key = ?
               AND COALESCE(source_ref, '') = ? AND status = 'pending'`
          )
          .get(value.userId, value.language, termKey, sourceRef) as { id: string } | null;
        if (existing) continue;
        // P4-1 选区归属校验：选区须存在且归属提议用户；带文档即验可见性。
        // 跨用户／幽灵选区统一 E_NOT_FOUND，不泄露存在性。
        if (value.selectionContextId) {
          const sel = deps.sqlite
            .query(
              'SELECT user_id AS userId, document_id AS documentId FROM selection_contexts WHERE id = ?'
            )
            .get(value.selectionContextId) as { userId: string; documentId: string | null } | null;
          if (!sel || sel.userId !== value.userId) {
            throw new BusinessError('E_NOT_FOUND', '未找到指定的选区', 'LEARNER_STATE');
          }
          if (sel.documentId && !getVisibleDocument(deps.sqlite, value.userId, sel.documentId)) {
            throw new BusinessError('E_NOT_FOUND', '未找到指定的选区', 'LEARNER_STATE');
          }
        }
        const id = generateId('cdraft');
        deps.sqlite
          .query(
            `INSERT INTO card_drafts
               (id, user_id, language, term_key, headword, reading, meanings_json,
                part_of_speech, source, source_ref, kind, card_type, status, edited_fields_json,
                flashcard_id, selection_context_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', NULL, ?, ?, ?)`
          )
          .run(
            id,
            value.userId,
            value.language,
            termKey,
            value.headword,
            reading ? reading : null,
            JSON.stringify(value.meanings),
            (value.partOfSpeech ?? '').trim() ? (value.partOfSpeech ?? '').trim() : null,
            value.source,
            sourceRef ? sourceRef : null,
            value.kind,
            value.cardType,
            value.selectionContextId ?? null,
            now,
            now
          );
        const row = deps.sqlite
          .query(`SELECT ${DRAFT_COLUMNS} FROM card_drafts WHERE id = ?`)
          .get(id) as CardDraftRow;
        created.push(toCardDraft(row));
      }
    });
    tx();
    return ok(created);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'proposeCardDrafts' })
    );
  }
}

/** 草稿列表（默认 pending；按更新倒序）。 */
export async function listCardDrafts(
  deps: RepoDeps,
  userId: string,
  language: string,
  status: CardDraftStatus = 'pending',
  limit = 50
): Promise<Result<CardDraft[], BusinessError>> {
  const uid = userId.trim();
  if (!uid) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  if (!SUPPORTED_LANGUAGES.has(language)) {
    return err(new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'));
  }
  if (!SUPPORTED_STATUSES.has(status)) {
    return err(new BusinessError('E_INVALID_INPUT', 'status 非法', 'VALIDATION'));
  }
  const take = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 50;
  try {
    const rows = deps.sqlite
      .query(
        `SELECT ${DRAFT_COLUMNS} FROM card_drafts
         WHERE user_id = ? AND language = ? AND status = ?
         ORDER BY updated_at DESC, rowid DESC LIMIT ?`
      )
      .all(uid, language, status, take) as CardDraftRow[];
    return ok(rows.map(toCardDraft));
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listCardDrafts',
        entityId: uid,
      })
    );
  }
}

export interface UpdateCardDraftPatch {
  headword?: string | undefined;
  reading?: string | undefined;
  meanings?: string[] | undefined;
  partOfSpeech?: string | undefined;
}

/** 用户逐字段改草稿（仅 pending；改动字段记入 edited_fields，AI 重提不得覆盖的依据）。 */
export async function updateCardDraft(
  deps: RepoDeps,
  userId: string,
  draftId: string,
  patch: UpdateCardDraftPatch
): Promise<Result<CardDraft, BusinessError>> {
  const uid = userId.trim();
  if (!uid || !draftId.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 或草稿 id 非法', 'VALIDATION'));
  }
  try {
    const row = deps.sqlite
      .query(`SELECT ${DRAFT_COLUMNS} FROM card_drafts WHERE id = ? AND user_id = ?`)
      .get(draftId.trim(), uid) as CardDraftRow | null;
    if (!row) {
      return err(new BusinessError('E_NOT_FOUND', '草稿不存在', 'LEARNER_STATE'));
    }
    if (row.status !== 'pending') {
      return err(new BusinessError('E_INVALID_INPUT', '草稿已处理，不可再改', 'VALIDATION'));
    }
    const draft = toCardDraft(row);
    const sets: string[] = [];
    const args: Array<string | null> = [];
    const touched: string[] = [...draft.editedFields];
    const touch = (f: string) => {
      if (!touched.includes(f)) touched.push(f);
    };
    if (typeof patch.headword === 'string' && patch.headword.trim()) {
      sets.push('headword = ?');
      args.push(patch.headword.trim().slice(0, 64));
      touch('headword');
    }
    if (typeof patch.reading === 'string') {
      const reading = patch.reading.trim().slice(0, 64);
      sets.push('reading = ?');
      args.push(reading ? reading : null);
      touch('reading');
    }
    if (Array.isArray(patch.meanings)) {
      const meanings = patch.meanings
        .filter((m) => typeof m === 'string')
        .map((m) => m.trim())
        .filter((m) => m)
        .slice(0, 12);
      if (meanings.length === 0) {
        return err(new BusinessError('E_INVALID_INPUT', 'meanings 至少一条', 'VALIDATION'));
      }
      sets.push('meanings_json = ?');
      args.push(JSON.stringify(meanings));
      touch('meanings');
    }
    if (typeof patch.partOfSpeech === 'string') {
      const pos = patch.partOfSpeech.trim().slice(0, 32);
      sets.push('part_of_speech = ?');
      args.push(pos ? pos : null);
      touch('partOfSpeech');
    }
    if (sets.length === 0) {
      return err(new BusinessError('E_INVALID_INPUT', '没有可更新的字段', 'VALIDATION'));
    }
    // 改表记/读音即改键：新键若撞其他 pending 同源草稿则拒绝（防分叉）。
    const headLimit = draft.kind === 'sentence' ? 500 : 64;
    const newHeadword =
      typeof patch.headword === 'string' && patch.headword.trim()
        ? patch.headword.trim().slice(0, headLimit)
        : draft.headword;
    const newReading =
      typeof patch.reading === 'string' ? patch.reading.trim().slice(0, 64) : (draft.reading ?? '');
    const newKey = buildTermKey(newHeadword, newReading);
    if (newKey !== row.term_key) {
      const clash = deps.sqlite
        .query(
          `SELECT id AS id FROM card_drafts
           WHERE user_id = ? AND language = ? AND term_key = ?
             AND COALESCE(source_ref, '') = COALESCE(?, '') AND status = 'pending' AND id != ?`
        )
        .get(uid, draft.language, newKey, draft.sourceRef ?? null, draft.id) as {
        id: string;
      } | null;
      if (clash) {
        return err(new BusinessError('E_INVALID_INPUT', '改后与另一条待确认草稿重复', 'VALIDATION'));
      }
      sets.push('term_key = ?');
      args.push(newKey);
    }
    // 改表记/读音即改键：新键若撞已有 pending 同源草稿则拒绝（防分叉）。
    const now = nowIso();
    const tx = deps.sqlite.transaction(() => {
      deps.sqlite
        .query(
          `UPDATE card_drafts SET ${sets.join(', ')}, edited_fields_json = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
        .run(...args, JSON.stringify(touched), now, draftId.trim(), uid);
    });
    tx();
    const updated = deps.sqlite
      .query(`SELECT ${DRAFT_COLUMNS} FROM card_drafts WHERE id = ?`)
      .get(draftId.trim()) as CardDraftRow;
    return ok(toCardDraft(updated));
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'updateCardDraft',
        entityId: draftId,
      })
    );
  }
}

/**
 * 接受草稿入库（仅 pending）：按草稿 cardType 建卡 + 相遇词回填 + 草稿 accepted 同事务。
 * 用改后字段建卡；用户编辑过的字段即最终值，AI 不再有机会覆盖。
 * 句子草稿不回填相遇词（整句进“见过”信号是污染）。
 */
export async function acceptCardDraft(
  deps: RepoDeps,
  userId: string,
  draftId: string
): Promise<Result<{ draft: CardDraft; cardId: string }, BusinessError>> {
  const uid = userId.trim();
  if (!uid || !draftId.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 或草稿 id 非法', 'VALIDATION'));
  }
  try {
    const row = deps.sqlite
      .query(`SELECT ${DRAFT_COLUMNS} FROM card_drafts WHERE id = ? AND user_id = ?`)
      .get(draftId.trim(), uid) as CardDraftRow | null;
    if (!row) {
      return err(new BusinessError('E_NOT_FOUND', '草稿不存在', 'LEARNER_STATE'));
    }
    if (row.status !== 'pending') {
      return err(new BusinessError('E_INVALID_INPUT', '草稿已处理，不可重复接受', 'VALIDATION'));
    }
    const draft = toCardDraft(row);
    const now = nowIso();
    const cardId = generateId('card_draft');
    // M6：NEW 初始化走 canonical initFsrsState；dueAt 沿用本函数同一 now
    //（与 studied_at/updated_at 同一时钟，避免三处时间戳毫秒漂移）。
    const fsrs = JSON.stringify({ ...initFsrsState(), dueAt: now });
    const tx = deps.sqlite.transaction(() => {
      deps.sqlite
        .query(
          `INSERT INTO flashcards
             (id, user_id, language, type, front, back, phonetic, audio_url,
              source_entry_id, tags, fsrs, studied_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
        )
        .run(
          cardId,
          uid,
          draft.language,
          draft.cardType,
          draft.headword,
          draft.meanings.join('；'),
          draft.reading ?? null,
          JSON.stringify([
            '草稿接受',
            draft.source,
            draft.partOfSpeech ?? (draft.kind === 'sentence' ? '句子' : '词汇'),
          ]),
          fsrs,
          // 草稿接受=用户逐字段确认过，天然讲透
          now
        );
      deps.sqlite
        .query(
          `UPDATE card_drafts SET status = 'accepted', flashcard_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(cardId, now, draftId.trim());
    });
    tx();
    // 相遇词回填与 collect 漏斗同级：失败只 warn，不推翻已建的卡。
    // 句子草稿跳过（整句不是“词”，进相遇词是污染）。
    if (draft.kind !== 'sentence') {
      const exposure = await recordTermExposure(deps, {
        userId: uid,
        language: draft.language,
        headword: draft.headword,
        ...(draft.reading ? { reading: draft.reading } : {}),
        source: draft.source === 'import' ? 'import' : 'collect',
        markCollected: true,
        flashcardId: cardId,
      });
      if (!isOk(exposure)) {
        logger.warn('[card-drafts] accept exposure hook failed', {
          code: exposure.error.code,
          draftId,
        });
      }
    }
    const updated = deps.sqlite
      .query(`SELECT ${DRAFT_COLUMNS} FROM card_drafts WHERE id = ?`)
      .get(draftId.trim()) as CardDraftRow;
    return ok({ draft: toCardDraft(updated), cardId });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'acceptCardDraft',
        entityId: draftId,
      })
    );
  }
}

/** 驳回草稿（仅 pending→dismissed；审计保留行，不删）。 */
export async function dismissCardDraft(
  deps: RepoDeps,
  userId: string,
  draftId: string
): Promise<Result<CardDraft, BusinessError>> {
  const uid = userId.trim();
  if (!uid || !draftId.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 或草稿 id 非法', 'VALIDATION'));
  }
  try {
    const row = deps.sqlite
      .query(`SELECT ${DRAFT_COLUMNS} FROM card_drafts WHERE id = ? AND user_id = ?`)
      .get(draftId.trim(), uid) as CardDraftRow | null;
    if (!row) {
      return err(new BusinessError('E_NOT_FOUND', '草稿不存在', 'LEARNER_STATE'));
    }
    if (row.status !== 'pending') {
      return err(new BusinessError('E_INVALID_INPUT', '草稿已处理', 'VALIDATION'));
    }
    deps.sqlite
      .query(`UPDATE card_drafts SET status = 'dismissed', updated_at = ? WHERE id = ?`)
      .run(nowIso(), draftId.trim());
    const updated = deps.sqlite
      .query(`SELECT ${DRAFT_COLUMNS} FROM card_drafts WHERE id = ?`)
      .get(draftId.trim()) as CardDraftRow;
    return ok(toCardDraft(updated));
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'dismissCardDraft',
        entityId: draftId,
      })
    );
  }
}
