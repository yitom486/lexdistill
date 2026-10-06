import { eq, and, or, like, sql } from 'drizzle-orm';
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
import type { Flashcard } from '@study-studio/protocol';
import { localDictionaryEntries, flashcards, dictionarySearchHistory, dictionarySources, dictionaryTermMeta, collectVocabularyCardInTx } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import type { TrackLanguage } from '@study-studio/shared';
import { normalizeTrackLanguage } from '@study-studio/shared';
import { recordTermExposure, buildTermKey } from '@study-studio/storage-sqlite';

/**
 * 词典域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 词典内容保持公共只读资产；收集操作只创建用户自己的 FSRS 状态。
 */

export interface LocalDictionaryEntry {
  id: string;
  language: TrackLanguage;
  headword: string;
  reading?: string | undefined;
  romanization?: string | undefined;
  meanings: string[];
  pronunciation?: Record<string, unknown> | undefined;
  partOfSpeech?: string | undefined;
  sourceLabel: string;
  licenseNote: string;
  /** 活用形还原注记（如「食べた」→「食べる（た形）」），直击中时为空 */
  inflectionNote?: string | undefined;
  /** 词频（数字越小越常用；无词频数据时为空） */
  frequency?: number | undefined;
  /** 按来源的词频行（值升序，最多 4 条；无数据时为空） */
  frequencies?: Array<{ source: string; value: number }> | undefined;
}

/** 词典资产被收集为用户 FSRS 生词卡后的领域结果；不依赖任何具体界面。 */
export interface DictionaryEntryCollection {
  card: Flashcard;
  created: boolean;
}

type LocalDictionaryRow = typeof localDictionaryEntries.$inferSelect;

/** DB 行 → 领域条目（读侧永不抛；meanings 解析失败回退空数组）。 */function toLocalDictionaryEntry(row: LocalDictionaryRow): LocalDictionaryEntry {
  let meanings: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.meaningsJson);
    if (Array.isArray(parsed)) {
      meanings = parsed.filter((m): m is string => typeof m === 'string');
    }
  } catch {
    meanings = [];
  }
  const entry: LocalDictionaryEntry = {
    id: row.id,
    language: row.language as TrackLanguage,
    headword: row.headword,
    meanings,
    sourceLabel: row.sourceLabel,
    licenseNote: row.licenseNote,
  };
  if (row.reading) entry.reading = row.reading;
  if (row.romanization) entry.romanization = row.romanization;
  if (row.pronunciationJson) {
    try {
      entry.pronunciation = JSON.parse(row.pronunciationJson) as Record<string, unknown>;
    } catch {
      entry.pronunciation = undefined;
    }
  }
  if (row.partOfSpeech) entry.partOfSpeech = row.partOfSpeech;
  return entry;
}

import { getMorphAnalyzer, type MorphCandidate } from '@study-studio/lexicon';
import { coarsePosOfLabel, coarsePosName } from '@study-studio/lexicon';

/**
 * 查询本地、可再分发的词典资产。第三方词典只可作为外链兜底，绝不在此抓取。
 */
export async function searchLocalDictionary(
  deps: RepoDeps,
  language: TrackLanguage,
  query: string,
  limit = 20
): Promise<Result<LocalDictionaryEntry[], BusinessError>> {
  try {
    const normalized = query.trim();
    if (!normalized) return ok([]);

    const pattern = `%${normalized}%`;
    const rows = await deps.db
      .select()
      .from(localDictionaryEntries)
      .where(
        and(
          eq(localDictionaryEntries.language, language),
          or(
            like(localDictionaryEntries.headword, pattern),
            like(localDictionaryEntries.reading, pattern),
            like(localDictionaryEntries.romanization, pattern)
          )
        )
      )
      .limit(Math.min(Math.max(limit, 1), 50));

    const direct = rows.map(toLocalDictionaryEntry);
    if (direct.length > 0) return ok(await rankDictionaryEntries(deps, direct));

    // 词形还原回退（日语活用 / 英语屈折）：收集全部候选的命中，按“词性一致→跳数→词频”排，
    // 首个命中即返回的旧逻辑会漏掉更优候选。注记保留完整分析路径（表层→原形·链条·词性）。
    const morphHits = await collectMorphHits(deps, language, normalized, limit);
    if (morphHits) return ok(await rankDictionaryEntries(deps, morphHits.entries, morphHits.signals));

    // 释义全文搜索（FTS5）：按中文/关键词找释义；FTS 不可用时静默空结果
    const meanings = await searchDictionaryMeanings(deps, language, normalized, limit);
    if (!isOk(meanings)) return meanings;
    return ok(await rankDictionaryEntries(deps, meanings.value));
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'searchLocalDictionary',
        entityId: query,
      })
    );
  }
}

/**
 * 词形还原候选收集（日语活用 / 英语屈折共用评分管线）。
 * 返回命中条目（附注记）与评分信号；无命中返回 null，调用方继续 FTS。
 */
async function collectMorphHits(
  deps: RepoDeps,
  language: TrackLanguage,
  normalized: string,
  limit: number
): Promise<{ entries: LocalDictionaryEntry[]; signals: Map<string, { posRank: number; depth: number }> } | null> {
  type MorphHit = MorphCandidate & { verb: string };
  let candidates: MorphHit[] = [];
  const analyzer = getMorphAnalyzer(language);
  if (analyzer && analyzer.supports(normalized)) {
    candidates = analyzer.analyze(normalized).map((c) => ({ ...c, verb: analyzer.verb }));
  }
  if (candidates.length === 0) return null;
  const best = new Map<string, { entry: LocalDictionaryEntry; note: string; posRank: number; depth: number }>();
  for (const candidate of candidates.slice(0, 8)) {
    const hitRows = await deps.db
      .select()
      .from(localDictionaryEntries)
      .where(
        and(
          eq(localDictionaryEntries.language, language),
          or(
            eq(localDictionaryEntries.headword, candidate.base),
            eq(localDictionaryEntries.reading, candidate.base)
          )
        )
      )
      .limit(Math.min(Math.max(limit, 1), 50));
    for (const row of hitRows) {
      const entry = toLocalDictionaryEntry(row);
      const hasPos = !!entry.partOfSpeech?.trim();
      const posRank = !hasPos ? 1 : coarsePosOfLabel(entry.partOfSpeech) === candidate.pos ? 0 : 2;
      const prev = best.get(entry.id);
      if (prev && (prev.posRank < posRank || (prev.posRank === posRank && prev.depth <= candidate.depth))) {
        continue;
      }
      let note = `「${normalized}」${candidate.verb}「${candidate.base}」（${candidate.note}·${coarsePosName(candidate.pos)}）`;
      if (posRank === 2 && entry.partOfSpeech) {
        note += `（词条词性：${entry.partOfSpeech}，仅供参考）`;
      }
      best.set(entry.id, { entry: { ...entry, inflectionNote: note }, note, posRank, depth: candidate.depth });
    }
  }
  if (best.size === 0) return null;
  const signals = new Map<string, { posRank: number; depth: number }>();
  const entries: LocalDictionaryEntry[] = [];
  for (const [id, hit] of best) {
    signals.set(id, { posRank: hit.posRank, depth: hit.depth });
    entries.push(hit.entry);
  }
  return { entries, signals };
}

/**
 * 查词后处理：开关过滤 + 优先级/词性/词频排序（内存内完成，源表极小）。
 * - 未在 dictionary_sources 登记者：一律保留（种子/旧数据不受影响）；
 * - enabled=0 的来源：条目过滤；
 * - 排序：来源 priority 降序 → 词性一致（还原候选与词条词性一致优先，无信号时持平）
 *   → 还原跳数升序 → 词频升序（NULL 最后）→ 原顺序稳定。
 */
export async function rankDictionaryEntries(
  deps: RepoDeps,
  entries: LocalDictionaryEntry[],
  signals?: Map<string, { posRank: number; depth: number }>
): Promise<LocalDictionaryEntry[]> {
  if (entries.length === 0) return entries;
  let sourceRows: Array<{ id: string; enabled: number; priority: number; provider: string }>;
  try {
    sourceRows = await deps.db
      .select({
        id: dictionarySources.id,
        enabled: dictionarySources.enabled,
        priority: dictionarySources.priority,
        provider: dictionarySources.provider,
      })
      .from(dictionarySources);
  } catch {
    return entries;
  }
  const config = new Map(sourceRows.map((r) => [r.id, r]));
  // entry.id 形如 <sourceId>:<localId>，据此前缀判定来源；无前缀的一律保留
  const withSource = entries.map((entry, index) => {
    const sep = entry.id.indexOf(':');
    const sourceId = sep > 0 ? entry.id.slice(0, sep) : undefined;
    return { entry, index, sourceId };
  });
  const filtered = withSource.filter(({ sourceId }) => {
    if (!sourceId) return true;
    const conf = config.get(sourceId);
    return !conf || conf.enabled !== 0;
  });
  // 词频：按（词面，读音）取最小值；同时收集按来源的频率行（供面板多来源展示）
  let freqByKey = new Map<string, number>();
  let freqRowsByKey = new Map<string, Array<{ source: string; value: number }>>();
  try {
    const terms = [...new Set(filtered.map(({ entry }) => entry.headword))];
    if (terms.length > 0) {
      const placeholders = terms.map(() => '?').join(',');
      const rows = deps.sqlite
        .query(`SELECT term, reading, source_id, freq_value FROM dictionary_term_meta WHERE term IN (${placeholders}) AND freq_value IS NOT NULL`)
        .all(...terms) as Array<{ term: string; reading: string; source_id: string; freq_value: number }>;
      const byKey = new Map<string, Array<{ source: string; value: number }>>();
      for (const r of rows) {
        if (typeof r.freq_value !== 'number') continue;
        const key = `${r.term}\n${r.reading ?? ''}`;
        const list = byKey.get(key) ?? [];
        list.push({ source: r.source_id, value: r.freq_value });
        byKey.set(key, list);
      }
      for (const [key, list] of byKey) {
        list.sort((a, b) => a.value - b.value);
        if (list[0]) freqByKey.set(key, list[0].value);
        freqRowsByKey.set(key, list.slice(0, 4));
      }
    }
  } catch {
    freqByKey = new Map();
    freqRowsByKey = new Map();
  }
  const freqOf = (e: LocalDictionaryEntry): number | null => {
    const reading = e.reading ?? '';
    return freqByKey.get(`${e.headword}\n${reading}`) ?? freqByKey.get(`${e.headword}\n`) ?? null;
  };
  const decorated = filtered.map(({ entry, index, sourceId }) => {
    const conf = sourceId ? config.get(sourceId) : undefined;
    const frequency = freqOf(entry);
    // 按来源频率行：来源名用短 provider（过长回退 source_id，保证可读）
    const freqKey = `${entry.headword}\n${entry.reading ?? ''}`;
    const rawRows = freqRowsByKey.get(freqKey) ?? freqRowsByKey.get(`${entry.headword}\n`) ?? [];
    const frequencies = rawRows.map((r) => {
      const provider = config.get(r.source)?.provider;
      const source = provider && provider.length <= 16 ? provider : r.source;
      return { source, value: r.value };
    });
    const withFreq = frequency === null ? entry : { ...entry, frequency };
    return {
      entry: frequencies.length > 0 ? { ...withFreq, frequencies } : withFreq,
      index,
      priority: conf?.priority ?? 0,
      frequency,
    };
  });
  decorated.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aSignal = signals?.get(a.entry.id);
    const bSignal = signals?.get(b.entry.id);
    const aPos = aSignal?.posRank ?? 1;
    const bPos = bSignal?.posRank ?? 1;
    if (aPos !== bPos) return aPos - bPos;
    const aDepth = aSignal?.depth ?? 0;
    const bDepth = bSignal?.depth ?? 0;
    if (aDepth !== bDepth) return aDepth - bDepth;
    if (a.frequency !== null && b.frequency !== null && a.frequency !== b.frequency) {
      return a.frequency - b.frequency;
    }
    if (a.frequency !== null) return -1;
    if (b.frequency !== null) return 1;
    return a.index - b.index;
  });
  return decorated.map((d) => d.entry);
}
export async function searchDictionaryMeanings(
  deps: RepoDeps,
  language: TrackLanguage,
  query: string,
  limit = 20
): Promise<Result<LocalDictionaryEntry[], BusinessError>> {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/["*:()^+-]/g, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 5);
  if (terms.length === 0) return ok([]);
  const match = terms.map((t) => `"${t}"`).join(' AND ');
  try {
    const sqlite = deps.sqlite;
    // 原生 SQL 返回 snake_case 列，需显式映射为 drizzle 行形状再进 toLocalDictionaryEntry
    const rawRows = sqlite
      .query(
        `SELECT e.id, e.language, e.headword, e.reading, e.romanization,
                e.meanings_json, e.pronunciation_json, e.part_of_speech,
                e.source_id, e.source_label, e.license_note, e.created_at
         FROM local_dictionary_entries e
         JOIN local_dictionary_fts f ON f.entry_id = e.id
         WHERE e.language = ? AND local_dictionary_fts MATCH ?
         ORDER BY bm25(local_dictionary_fts) LIMIT ?`
      )
      .all(language, match, Math.min(Math.max(limit, 1), 50)) as Array<Record<string, unknown>>;
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    return ok(
      rawRows.map((r) =>
        toLocalDictionaryEntry({
          id: String(r['id'] ?? ''),
          language: String(r['language'] ?? ''),
          headword: String(r['headword'] ?? ''),
          reading: (r['reading'] as string | null) ?? null,
          romanization: (r['romanization'] as string | null) ?? null,
          meaningsJson: String(r['meanings_json'] ?? '[]'),
          pronunciationJson: (r['pronunciation_json'] as string | null) ?? null,
          partOfSpeech: (r['part_of_speech'] as string | null) ?? null,
          sourceId: str(r['source_id']) ?? '',
          sourceLabel: str(r['source_label']) ?? '',
          licenseNote: str(r['license_note']) ?? '',
          createdAt: str(r['created_at']) ?? '',
        })
      )
    );
  } catch {
    return ok([]);
  }
}

export interface DictionarySearchRecord {
  query: string;
  hitCount: number;
  topEntryId?: string | undefined;
  createdAt: string;
}

const MAX_HISTORY_PER_LANG = 200;

/** 记录一次用户查词（画像“查过什么”信号源；失败永不抛，调用方无需处理）。 */
export async function recordDictionarySearch(
  deps: RepoDeps,
  userId: string,
  language: TrackLanguage,
  query: string,
  hitCount: number,
  topEntryId?: string
): Promise<void> {
  try {
    const normalized = query.trim().slice(0, 64);
    if (!normalized) return;
    const now = nowIso();
    await deps.db.insert(dictionarySearchHistory).values({
      id: generateId('dsh'),
      userId,
      language,
      query: normalized,
      hitCount,
      topEntryId: topEntryId ?? null,
      createdAt: now,
    });
    // 修剪：每用户每语种只保留最近 200 条（单条 SQL，不读全表；按 rowid 判定新旧，毫秒级同批也不乱序）
    deps.sqlite
      .prepare(
        `DELETE FROM dictionary_search_history
         WHERE user_id = ? AND language = ?
           AND id NOT IN (
             SELECT id FROM dictionary_search_history
             WHERE user_id = ? AND language = ?
             ORDER BY rowid DESC LIMIT ?
           )`
      )
      .run(userId, language, userId, language, MAX_HISTORY_PER_LANG);
  } catch {
    // 历史记录失败不影响查词主路径
  }
}

/** 最近查词（去重取最新，默认 10 条，供面板快捷入口与画像消费）。 */
export async function getDictionarySearchHistory(
  deps: RepoDeps,
  userId: string,
  language: TrackLanguage,
  limit = 10
): Promise<Result<DictionarySearchRecord[], BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(dictionarySearchHistory)
      .where(
        and(
          eq(dictionarySearchHistory.userId, userId),
          eq(dictionarySearchHistory.language, language)
        )
      )
      .orderBy(sql`rowid DESC`)
      .limit(Math.min(Math.max(limit * 3, 1), 60));
    const seen = new Set<string>();
    const out: DictionarySearchRecord[] = [];
    for (const r of rows) {
      if (seen.has(r.query)) continue;
      seen.add(r.query);
      out.push({
        query: r.query,
        hitCount: r.hitCount,
        ...(r.topEntryId ? { topEntryId: r.topEntryId } : {}),
        createdAt: r.createdAt,
      });
      if (out.length >= Math.min(Math.max(limit, 1), 20)) break;
    }
    return ok(out);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'getDictionarySearchHistory', entityId: userId })
    );
  }
}
/**
 * 词典包配置更新（用户开关 enabled / 排序权重 priority）。
 * 不存在的 id 返回 E_NOT_FOUND；只更新传入字段。
 */
export async function updateDictionarySourceConfig(
  deps: RepoDeps,
  sourceId: string,
  patch: { enabled?: boolean; priority?: number }
): Promise<Result<{ id: string; enabled: boolean; priority: number }, BusinessError>> {
  try {
    if (patch.enabled === undefined && patch.priority === undefined) {
      return err(new BusinessError('E_INVALID_INPUT', '请提供 enabled 或 priority', 'VALIDATION'));
    }
    if (patch.priority !== undefined && (!Number.isInteger(patch.priority) || patch.priority < 0 || patch.priority > 999)) {
      return err(new BusinessError('E_INVALID_INPUT', 'priority 必须为 0–999 整数', 'VALIDATION'));
    }
    const existing = await deps.db
      .select()
      .from(dictionarySources)
      .where(eq(dictionarySources.id, sourceId))
      .limit(1);
    if (existing.length === 0) {
      return err(new BusinessError('E_NOT_FOUND', '词典包不存在', 'LEARNER_STATE'));
    }
    if (patch.enabled !== undefined) {
      await deps.db
        .update(dictionarySources)
        .set({ enabled: patch.enabled ? 1 : 0 })
        .where(eq(dictionarySources.id, sourceId));
    }
    if (patch.priority !== undefined) {
      await deps.db
        .update(dictionarySources)
        .set({ priority: patch.priority })
        .where(eq(dictionarySources.id, sourceId));
    }
    const updated = await deps.db
      .select({ enabled: dictionarySources.enabled, priority: dictionarySources.priority })
      .from(dictionarySources)
      .where(eq(dictionarySources.id, sourceId))
      .limit(1);
    const row = updated[0];
    return ok({ id: sourceId, enabled: (row?.enabled ?? 1) !== 0, priority: row?.priority ?? 0 });
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'updateDictionarySourceConfig', entityId: sourceId })
    );
  }
}

/**
 * 随机抽取本地词典条目（假名单词听写等“系统随机出题”场景用）。
 * 返回原始条目；假名可用性等过滤由调用方按需完成。
 */export async function sampleLocalDictionaryEntries(
  deps: RepoDeps,
  language: TrackLanguage,
  limit = 10
): Promise<Result<LocalDictionaryEntry[], BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(localDictionaryEntries)
      .where(eq(localDictionaryEntries.language, language))
      .orderBy(sql`RANDOM()`)
      .limit(Math.min(Math.max(limit, 1), 50));
    return ok(rows.map(toLocalDictionaryEntry));
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'sampleLocalDictionaryEntries',
        entityId: language,
      })
    );
  }
}

/**
 * 将一个已安装的本地词典条目收集为用户生词卡。
 */
export async function collectDictionaryEntry(
  deps: RepoDeps,
  userId: string,
  entryId: string
): Promise<Result<DictionaryEntryCollection, BusinessError>> {
  try {
    const entryRows = await deps.db
      .select()
      .from(localDictionaryEntries)
      .where(eq(localDictionaryEntries.id, entryId))
      .limit(1);
    const entry = entryRows[0];
    if (!entry) {
      return err(
        new BusinessError('E_NOT_FOUND', '该词典条目不存在或对应词典包尚未安装。', 'LEARNER_STATE')
      );
    }

    const collection = deps.db.transaction(tx => {
      const meanings = JSON.parse(entry.meaningsJson) as string[];
      const reading = entry.reading ?? entry.romanization ?? undefined;
      let exampleJp = '';
      let exampleZh = '';
      try {
        const termKey = buildTermKey(entry.headword, reading ?? '');
        const cached = deps.sqlite
          .query(
            `SELECT sentence AS sentence, translation AS translation FROM term_examples
             WHERE language = ? AND term_key = ? ORDER BY rowid LIMIT 1`
          )
          .get(entry.language, termKey) as { sentence: string; translation: string } | null;
        if (cached) {
          exampleJp = cached.sentence;
          exampleZh = cached.translation;
        }
      } catch {
        // 例句是 enrichment，失败不挡建卡。
      }
      return collectVocabularyCardInTx(tx, {
        userId, language: entry.language, word: entry.headword, reading, meaning: meanings.join('；'),
        sourceEntryId: entry.id, partOfSpeech: entry.partOfSpeech ?? undefined,
        examples: exampleJp ? [{ text: exampleJp, ...(exampleZh ? { translation: exampleZh } : {}) }] : [],
        tags: ['词典生词', `词典：${entry.sourceLabel}`],
      });
    });
    // 相遇词强信号（收藏=见过+要背）：与 history 同级，失败只 warn，永不挡建卡主路径。
    const exposure = await recordTermExposure(deps, {
      userId,
      language: entry.language,
      headword: entry.headword,
      ...(entry.reading || entry.romanization
        ? { reading: entry.reading ?? entry.romanization ?? undefined }
        : {}),
      source: 'collect',
      markCollected: true,
      flashcardId: collection.card.id,
    });
    if (!isOk(exposure)) {
      logger.warn('[encountered-terms] collect hook failed', {
        code: exposure.error.code,
        entryId,
      });
    }
    return ok(collection);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'collectDictionaryEntry',
        entityId: entryId,
      })
    );
  }
}
