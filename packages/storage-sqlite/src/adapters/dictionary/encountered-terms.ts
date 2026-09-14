import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';
import type { Database } from 'bun:sqlite';

/**
 * 相遇词（EncounteredTerm）域：用户在查词/收藏/阅读中真实见过的词。
 *
 * D3 起家在 storage-sqlite（前身 gateway modules/dictionary/persistence/encountered-terms.ts，
 * 逻辑不变）。参数收窄为 `{ sqlite }`（本文件只用原生连接，不用 drizzle/repo 回指）：
 * 调用方传完整 RepoDeps 依然兼容（结构化类型）。
 * - term_key 用「表记 + 读音」归一化，跨词典包稳定（entryId 换包即变，不可用）；
 * - encountered_terms 是聚合（幂等 upsert），term_occurrences 是审计（只插不改）；
 * - 记录失败走 Result 由调用方定级：收藏漏斗内降级为 warn（不挡建卡），
 *   查词漏斗内与 history 同级 fire-and-forget。
 */

export type TermExposureSource = 'lookup' | 'collect' | 'reading' | 'import';
export type EncounteredTermStatus = 'new' | 'collected' | 'reviewing' | 'mastered';

const SUPPORTED_LANGUAGES = new Set(['ja', 'en', 'ko']);
const SUPPORTED_SOURCES: ReadonlySet<string> = new Set(['lookup', 'collect', 'reading', 'import']);
const SUPPORTED_STATUSES: ReadonlySet<string> = new Set(['new', 'collected', 'reviewing', 'mastered']);

export interface EncounteredTerm {
  userId: string;
  language: string;
  termKey: string;
  headword: string;
  reading?: string | undefined;
  status: EncounteredTermStatus;
  exposureCount: number;
  /** CI-2：lookup 事件数（source='lookup'）。 */
  lookupCount: number;
  /** CI-2：read 事件数（source IN ('reading','import')；'collect' 只贡献 exposure）。 */
  readCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  flashcardId?: string | undefined;
}

export interface RecordTermExposureInput {
  userId: string;
  /** DB/调用侧原始语种字符串；白名单收敛，非 ja/en/ko 直接拒绝。 */
  language: string;
  headword: string;
  reading?: string | undefined;
  source: TermExposureSource;
  documentId?: string | undefined;
  quote?: string | undefined;
  /** 收藏漏斗传入：升级 status=collected 并回填卡 id。 */
  flashcardId?: string | undefined;
  markCollected?: boolean | undefined;
}

/** 「表记 + 读音」归一键：去首尾空；读音缺省为空串（同形异读即不同键）。 */
export function buildTermKey(headword: string, reading?: string): string {
  return `${headword.trim()}\u0001${(reading ?? '').trim()}`;
}

interface EncounteredTermRow {
  user_id: string;
  language: string;
  term_key: string;
  headword: string;
  reading: string | null;
  status: string;
  exposure_count: number;
  lookup_count: number;
  read_count: number;
  first_seen_at: string;
  last_seen_at: string;
  flashcard_id: string | null;
}

function toEncounteredTerm(row: EncounteredTermRow): EncounteredTerm {
  const status: EncounteredTermStatus = SUPPORTED_STATUSES.has(row.status)
    ? (row.status as EncounteredTermStatus)
    : 'new';
  const term: EncounteredTerm = {
    userId: row.user_id,
    language: row.language,
    termKey: row.term_key,
    headword: row.headword,
    status,
    exposureCount: row.exposure_count,
    lookupCount: row.lookup_count,
    readCount: row.read_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
  if (row.reading) term.reading = row.reading;
  if (row.flashcard_id) term.flashcardId = row.flashcard_id;
  return term;
}

/** 批量入口的单条归一词（调用方已做长度收敛）。 */
export interface ReadingExposureTerm {
  headword: string;
  reading?: string | undefined;
}

interface AppliedExposure {
  userId: string;
  language: string;
  termKey: string;
  headword: string;
  reading: string;
  status: EncounteredTermStatus;
  flashcardId: string | null;
  source: TermExposureSource;
  documentId: string | null;
  quote: string;
  /** CI-2 分计数增量（由调用方按 source 折算，applyExposure 只做加法）。 */
  lookupInc: number;
  readInc: number;
  now: string;
}

/**
 * 单条写入核心（无事务边界，由调用方包 tx；批量与单条复用同一 SQL，语义一致）。
 * bun:sqlite 不允许事务嵌套，故 tx 边界一律上移一层。
 */
function applyExposure(sqlite: Database, e: AppliedExposure): void {
  sqlite
    .query(
      `INSERT INTO encountered_terms
         (user_id, language, term_key, headword, reading, status,
          exposure_count, lookup_count, read_count,
          first_seen_at, last_seen_at, flashcard_id)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, language, term_key) DO UPDATE SET
         exposure_count = encountered_terms.exposure_count + 1,
         lookup_count = encountered_terms.lookup_count + excluded.lookup_count,
         read_count = encountered_terms.read_count + excluded.read_count,
         last_seen_at = excluded.last_seen_at,
         status = CASE WHEN excluded.status = 'collected'
           THEN 'collected' ELSE encountered_terms.status END,
         flashcard_id = COALESCE(excluded.flashcard_id, encountered_terms.flashcard_id)`
    )
    .run(
      e.userId,
      e.language,
      e.termKey,
      e.headword,
      e.reading ? e.reading : null,
      e.status,
      e.lookupInc,
      e.readInc,
      e.now,
      e.now,
      e.flashcardId
    );
  sqlite
    .query(
      `INSERT INTO term_occurrences
         (id, user_id, language, term_key, source, document_id, quote, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateId('tocc'),
      e.userId,
      e.language,
      e.termKey,
      e.source,
      e.documentId,
      e.quote ? e.quote : null,
      e.now
    );
}

/** 记录一次相遇：聚合 upsert + 审计插入同事务（调用方决定失败定级）。 */
export async function recordTermExposure(
  deps: { sqlite: Database },
  input: RecordTermExposureInput
): Promise<Result<EncounteredTerm, BusinessError>> {
  const userId = input.userId.trim();
  if (!userId || userId.length > 64) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  if (!SUPPORTED_LANGUAGES.has(input.language)) {
    return err(new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'));
  }
  if (!SUPPORTED_SOURCES.has(input.source)) {
    return err(new BusinessError('E_INVALID_INPUT', 'source 非法', 'VALIDATION'));
  }
  const headword = input.headword.trim().slice(0, 64);
  if (!headword) {
    return err(new BusinessError('E_INVALID_INPUT', 'headword 为空', 'VALIDATION'));
  }
  const reading = (input.reading ?? '').trim().slice(0, 64);
  const quote = (input.quote ?? '').trim().slice(0, 500);
  const termKey = buildTermKey(headword, reading);
  const now = nowIso();
  const nextStatus: EncounteredTermStatus = input.markCollected ? 'collected' : 'new';
  // CI-2：分计数由事件来源折算（'collect' 只贡献 exposure）。
  const lookupInc = input.source === 'lookup' ? 1 : 0;
  const readInc = input.source === 'reading' || input.source === 'import' ? 1 : 0;
  try {
    const tx = deps.sqlite.transaction(() => {
      applyExposure(deps.sqlite, {
        userId,
        language: input.language,
        termKey,
        headword,
        reading,
        status: nextStatus,
        flashcardId: input.flashcardId ?? null,
        source: input.source,
        documentId: input.documentId ?? null,
        quote,
        lookupInc,
        readInc,
        now,
      });
    });
    tx();
    const row = deps.sqlite
      .query(
        `SELECT user_id, language, term_key, headword, reading, status,
                exposure_count, lookup_count, read_count,
                first_seen_at, last_seen_at, flashcard_id
         FROM encountered_terms
         WHERE user_id = ? AND language = ? AND term_key = ?`
      )
      .get(userId, input.language, termKey) as EncounteredTermRow | null;
    if (!row) {
      return err(
        new BusinessError('E_INTERNAL', '相遇词写入后回读失败，请重试。', 'DATABASE', true)
      );
    }
    return ok(toEncounteredTerm(row));
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'recordTermExposure',
        entityId: termKey,
      })
    );
  }
}

/** 相遇词列表（按最近相遇倒序，供仪表盘热力与复习选题消费）。 */
export async function listEncounteredTerms(
  deps: { sqlite: Database },
  userId: string,
  language: string,
  limit = 50
): Promise<Result<EncounteredTerm[], BusinessError>> {
  const uid = userId.trim();
  if (!uid) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  if (!SUPPORTED_LANGUAGES.has(language)) {
    return err(new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'));
  }
  const take = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 50;
  try {
    const rows = deps.sqlite
      .query(
        `SELECT user_id, language, term_key, headword, reading, status,
                exposure_count, lookup_count, read_count,
                first_seen_at, last_seen_at, flashcard_id
         FROM encountered_terms
         WHERE user_id = ? AND language = ?
         ORDER BY last_seen_at DESC, rowid DESC LIMIT ?`
      )
      .all(uid, language, take) as EncounteredTermRow[];
    return ok(rows.map(toEncounteredTerm));
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'listEncounteredTerms',
        entityId: uid,
      })
    );
  }
}

interface HistoryBackfillRow {
  query: string;
  top_entry_id: string | null;
  headword: string | null;
  reading: string | null;
  n: number;
  first_at: string;
  last_at: string;
}

/**
 * 冷启动回填：把 dictionary_search_history（每用户每语种上限 200）倒进相遇词。
 * - 有 top_entry 关联的用条目表记/读音，无的用查询原文当表记；
 * - 聚合同词：exposure_count=历史次数，first/last_seen 取极值；
 * - 审计只补一条 occurrence（source=lookup），避免历史膨胀；
 * - 已有相遇词的行跳过计数合并（回填只做一次，重复调用幂等无害）。
 */
export async function backfillEncounteredTermsFromHistory(
  deps: { sqlite: Database },
  userId: string,
  language: string
): Promise<Result<{ terms: number; occurrences: number }, BusinessError>> {
  const uid = userId.trim();
  if (!uid) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  if (!SUPPORTED_LANGUAGES.has(language)) {
    return err(new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'));
  }
  try {
    const groups = deps.sqlite
      .query(
        `SELECT h.query AS query, h.top_entry_id AS top_entry_id,
                e.headword AS headword, e.reading AS reading,
                COUNT(*) AS n, MIN(h.created_at) AS first_at, MAX(h.created_at) AS last_at
         FROM dictionary_search_history h
         LEFT JOIN local_dictionary_entries e ON e.id = h.top_entry_id
         WHERE h.user_id = ? AND h.language = ?
         GROUP BY h.query, h.top_entry_id, e.headword, e.reading`
      )
      .all(uid, language) as HistoryBackfillRow[];
    let terms = 0;
    let occurrences = 0;
    const tx = deps.sqlite.transaction(() => {
      for (const g of groups) {
        const headword = (g.headword ?? g.query).trim().slice(0, 64);
        if (!headword) continue;
        const reading = (g.reading ?? '').trim().slice(0, 64);
        const termKey = buildTermKey(headword, reading);
        const existing = deps.sqlite
          .query(
            'SELECT term_key AS term_key FROM encountered_terms WHERE user_id = ? AND language = ? AND term_key = ?'
          )
          .get(uid, language, termKey) as { term_key: string } | null;
        if (!existing) {
          deps.sqlite
            .query(
              `INSERT INTO encountered_terms
                 (user_id, language, term_key, headword, reading, status,
                  exposure_count, lookup_count, read_count,
                  first_seen_at, last_seen_at, flashcard_id)
               VALUES (?, ?, ?, ?, ?, 'new', ?, 1, 0, ?, ?, NULL)`
            )
            .run(
              uid,
              language,
              termKey,
              headword,
              reading ? reading : null,
              g.n,
              g.first_at,
              g.last_at
            );
          terms += 1;
        }
        deps.sqlite
          .query(
            `INSERT INTO term_occurrences
               (id, user_id, language, term_key, source, document_id, quote, created_at)
             VALUES (?, ?, ?, ?, 'lookup', NULL, NULL, ?)`
          )
          .run(generateId('tocc'), uid, language, termKey, g.last_at);
        occurrences += 1;
      }
    });
    tx();
    return ok({ terms, occurrences });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'backfillEncounteredTermsFromHistory',
        entityId: uid,
      })
    );
  }
}

export interface RecordReadingExposuresInput {
  userId: string;
  language: string;
  documentId: string;
  lessonId: string;
  terms: ReadingExposureTerm[];
}

/**
 * 打开课次即记（reading 源）：把该课生词表（调用方取自 AST，非 NLP）记为见过。
 * - 同课同天只记一次（按 document_id=`文档/课` + 当天 reading 审计判定；重复调用返回 skipped）；
 * - 单课上限 50 词；已收藏的不降级（与单条同一 SQL 语义）。
 */
export async function recordReadingExposures(
  deps: { sqlite: Database },
  input: RecordReadingExposuresInput
): Promise<Result<{ recorded: number; skipped: boolean }, BusinessError>> {
  const uid = input.userId.trim();
  if (!uid || uid.length > 64) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  if (!SUPPORTED_LANGUAGES.has(input.language)) {
    return err(new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'));
  }
  const documentId = input.documentId.trim().slice(0, 128);
  const lessonId = input.lessonId.trim().slice(0, 128);
  if (!documentId || !lessonId) {
    return err(new BusinessError('E_INVALID_INPUT', 'documentId 或 lessonId 非法', 'VALIDATION'));
  }
  if (!Array.isArray(input.terms) || input.terms.length === 0 || input.terms.length > 50) {
    return err(new BusinessError('E_INVALID_INPUT', '单次记录 1–50 词', 'VALIDATION'));
  }
  const cleaned: Array<{ headword: string; reading: string }> = [];
  for (const t of input.terms) {
    if (!t || typeof t.headword !== 'string') {
      return err(new BusinessError('E_INVALID_INPUT', '某词条 headword 非法', 'VALIDATION'));
    }
    const headword = t.headword.trim().slice(0, 64);
    if (!headword) {
      return err(new BusinessError('E_INVALID_INPUT', '某词条 headword 为空', 'VALIDATION'));
    }
    cleaned.push({ headword, reading: (typeof t.reading === 'string' ? t.reading : '').trim().slice(0, 64) });
  }
  const docRef = `${documentId}/${lessonId}`;
  try {
    const todayStart = `${nowIso().slice(0, 10)}T00:00:00.000Z`;
    const hit = deps.sqlite
      .query(
        `SELECT id AS id FROM term_occurrences
         WHERE user_id = ? AND language = ? AND document_id = ?
           AND source = 'reading' AND created_at >= ? LIMIT 1`
      )
      .get(uid, input.language, docRef, todayStart) as { id: string } | null;
    if (hit) return ok({ recorded: 0, skipped: true });
    const now = nowIso();
    const tx = deps.sqlite.transaction(() => {
      for (const t of cleaned) {
        applyExposure(deps.sqlite, {
          userId: uid,
          language: input.language,
          termKey: buildTermKey(t.headword, t.reading),
          headword: t.headword,
          reading: t.reading,
          status: 'new',
          flashcardId: null,
          source: 'reading',
          documentId: docRef,
          quote: '',
          lookupInc: 0,
          readInc: 1,
          now,
        });
      }
    });
    tx();
    return ok({ recorded: cleaned.length, skipped: false });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'recordReadingExposures',
        entityId: docRef,
      })
    );
  }
}
