import { sql } from 'drizzle-orm';
import type { Database } from 'bun:sqlite';
import { BusinessError, err, ok, type Result, nowIso } from '@study-studio/shared';
import type { TextbookAST } from '@study-studio/document-model';
import { documents, seedMaterialization } from '../../../infrastructure/db/schema.js';
import { shredIntoTransaction, termMapDedupKey } from './textbook-shred.js';
import { fingerprintCanonical } from '../../../infrastructure/db/canonical-fingerprint.js';
import { eq } from 'drizzle-orm';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * Seed materialization gating（P1-D1）。
 *
 * fingerprint 语义：“任何会改变 seed derived projection 的输入变化，fp 就变化”：
 * - deterministic semantic seed AST 全量（含手写静态但位置性的 seed lesson id——id 变即 fp 变，Task 4）；
 * - mapping 切片：seed 词面/文法标题 → local_dictionary_entries 精确命中 entry id
 *  （与 shred.findEntry 同口径 `language/headword`；只 hash 引用到的映射，不 hash 35 万全文）；
 * - SEED_MATERIALIZER_VERSION（算法/语义变更显式 bump，见下）。
 *
 * 依赖 map（Task 2，实测 shredIntoTransaction）：
 * - lessons/lines/vocab/grammar/exercises ← 纯 AST；
 * - term_map.entry_id ← AST 词面/标题 × local_dictionary_entries(language, headword) 精确存在性；
 * - FTS ← projected vocab/line 行（无外部依赖）。
 * 因此 AST fp == materialization fp **不成立**（词典变化会改 term_map），必须三者组合。
 */

/**
 * Materializer 版本：凡改以下任一必须 bump（否则 gating 认不出输出语义变化）：
 * - shredIntoTransaction 的行/列/切片/归一语义（含 P1-D1 term_map 去重语义 → v2）；
 * - findEntry 的匹配语义（language 映射、相等定义）；
 * - 本文件 mapping 切片口径。
 * 不要把 app version / package version 纳入（无依据的全局失效）。
 */
export const SEED_MATERIALIZER_VERSION = 2;

export interface SeedMaterializationInput {
  /** canonical seed AST 全量（含 generation-local 的位置性 ids） */
  ast: TextbookAST;
  /** [kind, surface, entryId|null][] 已排序 */
  mapping: Array<{ kind: string; surface: string; entryId: string | null }>;
  materializerVersion: number;
}

function dictLanguage(bookLanguage: unknown): string | null {
  if (bookLanguage === 'JA') return 'ja';
  if (bookLanguage === 'EN') return 'en';
  if (bookLanguage === 'KO') return 'ko';
  return null;
}

/** mapping 切片：与 shred 同口径查命中（只读）。 */
export function computeSeedMapping(
  sqlite: Database,
  book: TextbookAST
): Array<{ kind: string; surface: string; entryId: string | null }> {
  const lang = dictLanguage(book.language);
  const out = new Map<string, { kind: string; surface: string; entryId: string | null }>();
  const lookup = (surface: string): string | null => {
    if (!lang) return null;
    const rows = sqlite
      .query('SELECT id FROM local_dictionary_entries WHERE language = ? AND headword = ? ORDER BY id LIMIT 1')
      .all(lang, surface) as Array<{ id: string }>;
    const first = rows[0];
    return first && typeof first.id === 'string' ? first.id : null;
  };
  for (const lesson of book.lessons ?? []) {
    for (const v of lesson.vocabularies ?? []) {
      const surface = (v.kanji ?? '').trim().slice(0, 64);
      if (!surface) continue;
      const key = `vocab|${surface}`;
      if (!out.has(key)) out.set(key, { kind: 'vocab', surface, entryId: lookup(surface) });
    }
    for (const g of lesson.grammarPoints ?? []) {
      const title = (g.title ?? '').trim().slice(0, 200);
      if (!title) continue;
      const key = `grammar|${title}`;
      if (!out.has(key)) out.set(key, { kind: 'grammar', surface: title, entryId: lookup(title) });
    }
  }
  return [...out.values()].sort((a, b) =>
    a.kind === b.kind ? (a.surface < b.surface ? -1 : 1) : a.kind < b.kind ? -1 : 1
  );
}

export function buildSeedMaterializationInput(
  sqlite: Database,
  book: TextbookAST,
  materializerVersion: number = SEED_MATERIALIZER_VERSION
): SeedMaterializationInput {
  return { ast: book, mapping: computeSeedMapping(sqlite, book), materializerVersion };
}

export function fingerprintSeedMaterialization(input: SeedMaterializationInput): string {
  return fingerprintCanonical(input);
}

export function computeSeedMaterializationFingerprint(
  sqlite: Database,
  book: TextbookAST,
  materializerVersion: number = SEED_MATERIALIZER_VERSION
): string {
  return fingerprintSeedMaterialization(buildSeedMaterializationInput(sqlite, book, materializerVersion));
}

export interface ProjectionHealth {
  healthy: boolean;
  reasons: string[];
}

/**
 * P1-D1a：期望 term_map 行数（与 shredIntoTransaction 完全同规则）。
 * 清洗/截断与 shred 一字相同（vocab kanji trim+slice(0,64) 跳空；
 * grammar title trim+slice(0,200) 跳空），键为完整持久化 PK 四元组。
 * 只计行数健康，不查 entry_id（词典正确性由 fingerprint mapping 切片 + 版本管，
 * 行数健康与 entry 正确性是两种检查，不得混淆）。
 */
export function expectedTermMapCountForLesson(
  documentId: string,
  lessonId: string,
  vocabs: unknown[],
  grammars: unknown[]
): number {
  const seen = new Set<string>();
  for (const v of vocabs) {
    if (!v || typeof v !== 'object') continue;
    const kanji = (v as Record<string, unknown>).kanji;
    if (typeof kanji !== 'string' || !kanji.trim()) continue;
    seen.add(termMapDedupKey(documentId, lessonId, 'vocab', kanji.trim().slice(0, 64)));
  }
  for (const g of grammars) {
    if (!g || typeof g !== 'object') continue;
    const title = (g as Record<string, unknown>).title;
    if (typeof title !== 'string' || !title.trim()) continue;
    seen.add(termMapDedupKey(documentId, lessonId, 'grammar', title.trim().slice(0, 200)));
  }
  return seen.size;
}

/**
 * Projection health（只读轻量，不跑全 doctor）。
 * - derived lesson 集合/数量与 AST 一致；
 * - sort_order = index+1（1-based dense 按文档）；
 * - lesson_number/title 与 AST 一致（shred 透传语义）；
 * - 非空数组有行、空数组无行（lines/vocab/grammar/exercises）；
 * - FTS：每个 vocab/line 行有对应 kind/ref 索引行；
 * - term_map：每课 map 行数 == 按最终 PK 去重后的期望桥行数（P1-D1a；
 *   不是 vocab+grammar occurrence 总数，同课重复面只计一行）。
 * term_map mapping *正确性*（entry 对不对）不在此验证——由 materializer/dependency
 * version 保证 freshness（全量比对等于重做 mapping，不廉价）。
 */
export function isTextbookProjectionHealthy(
  sqlite: Database,
  documentId: string,
  book: TextbookAST
): ProjectionHealth {
  const reasons: string[] = [];
  const lessons = Array.isArray(book?.lessons) ? book.lessons : [];
  const derived = sqlite.query(
    'SELECT lesson_id AS lessonId, lesson_number AS lessonNumber, title AS title, sort_order AS sortOrder FROM textbook_lessons WHERE document_id = ?'
  ).all(documentId) as Array<{ lessonId: string; lessonNumber: number; title: string; sortOrder: number | null }>;
  if (derived.length !== lessons.length) {
    reasons.push(`课数不一致: ast=${lessons.length} derived=${derived.length}`);
    return { healthy: false, reasons };
  }
  const byId = new Map(derived.map((r) => [r.lessonId, r]));
  if (byId.size !== derived.length) {
    reasons.push('derived 侧 lesson_id 重复');
    return { healthy: false, reasons };
  }
  const countOf = (table: string, lessonId: string): number =>
    (sqlite.query(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id = ? AND lesson_id = ?`).get(documentId, lessonId) as { n: number }).n;
  lessons.forEach((lesson, i) => {
    const l = lesson as { id?: unknown; lessonNumber?: unknown; title?: unknown; dialogues?: unknown; vocabularies?: unknown; grammarPoints?: unknown; exercises?: unknown };
    if (typeof l.id !== 'string' || !l.id) {
      reasons.push(`index ${i} 缺 id`);
      return;
    }
    const row = byId.get(l.id);
    if (!row) {
      reasons.push(`缺课行: ${l.id}`);
      return;
    }
    if (row.sortOrder !== i + 1) reasons.push(`sort_order 错位: ${l.id} 期望 ${i + 1} 实际 ${String(row.sortOrder)}`);
    if (typeof l.lessonNumber === 'number' && Number.isInteger(l.lessonNumber) && l.lessonNumber > 0 && row.lessonNumber !== l.lessonNumber) {
      reasons.push(`lesson_number 不一致: ${l.id}`);
    }
    if (typeof l.title === 'string' && row.title !== l.title.slice(0, 200)) reasons.push(`title 不一致: ${l.id}`);
    const dialogues = Array.isArray(l.dialogues) ? l.dialogues : [];
    const vocabs = Array.isArray(l.vocabularies) ? l.vocabularies : [];
    const grammars = Array.isArray(l.grammarPoints) ? l.grammarPoints : [];
    const exercises = Array.isArray(l.exercises) ? l.exercises : [];
    const lines = countOf('textbook_lines', l.id);
    const vocabN = countOf('textbook_vocab', l.id);
    const grammarN = countOf('textbook_grammar', l.id);
    const exN = countOf('textbook_exercises', l.id);
    if (dialogues.length > 0 && lines === 0) reasons.push(`缺行: ${l.id}`);
    if (dialogues.length === 0 && lines > 0) reasons.push(`多余行: ${l.id}`);
    if (vocabs.length > 0 && vocabN === 0) reasons.push(`缺词: ${l.id}`);
    if (vocabs.length === 0 && vocabN > 0) reasons.push(`多余词: ${l.id}`);
    if (grammars.length > 0 && grammarN === 0) reasons.push(`缺文法: ${l.id}`);
    if (grammars.length === 0 && grammarN > 0) reasons.push(`多余文法: ${l.id}`);
    if (exercises.length > 0 && exN === 0) reasons.push(`缺习题: ${l.id}`);
    if (exercises.length === 0 && exN > 0) reasons.push(`多余习题: ${l.id}`);
    // FTS 双向存在性（逐行 ref 对齐 shred 写法 lesson#v{ord}/#d{ord}）
    for (let ord = 0; ord < vocabN; ord++) {
      const hit = sqlite.query(
        "SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id = ? AND lesson_id = ? AND kind = 'vocab' AND ref = ?"
      ).get(documentId, l.id, `${l.id}#v${ord}`) as { n: number };
      if (hit.n === 0) {
        reasons.push(`FTS 缺词索引: ${l.id}#v${ord}`);
        break;
      }
    }
    for (let ord = 0; ord < lines; ord++) {
      const hit = sqlite.query(
        "SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id = ? AND lesson_id = ? AND kind = 'line' AND ref = ?"
      ).get(documentId, l.id, `${l.id}#d${ord}`) as { n: number };
      if (hit.n === 0) {
        reasons.push(`FTS 缺行索引: ${l.id}#d${ord}`);
        break;
      }
    }
    const mapN = (sqlite.query(
      'SELECT COUNT(*) AS n FROM textbook_term_map WHERE document_id = ? AND lesson_id = ?'
    ).get(documentId, l.id) as { n: number }).n;
    const expectedMapN = expectedTermMapCountForLesson(documentId, l.id, vocabs, grammars);
    if (mapN !== expectedMapN) reasons.push(`term_map 行数异常: ${l.id} 期望 ${expectedMapN} 实际 ${mapN}`);
  });
  return { healthy: reasons.length === 0, reasons };
}

export interface SeedStatusEntry {
  documentId: string;
  stateExists: boolean;
  storedVersion: number | null;
  currentVersion: number;
  shouldSkip: boolean;
  reason: string;
}

/**
 * 只读单本状态（status CLI 与单测共用；不 migration、不 materialize、不写库）。
 * state 缺席（表缺/无行）时 storedVersion 为 null，shouldSkip 由 shouldSkipSeedMaterialization 判定。
 */
export function describeSeedStatus(
  sqlite: Database,
  documentId: string,
  book: TextbookAST,
  currentVersion: number = SEED_MATERIALIZER_VERSION
): SeedStatusEntry {
  let stateExists = false;
  let storedVersion: number | null = null;
  try {
    const hasTable = (
      sqlite.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='seed_materialization'").get() as { n: number }
    ).n;
    if (hasTable > 0) {
      const row = sqlite.query(
        'SELECT fingerprint AS fp, materializer_version AS v FROM seed_materialization WHERE document_id = ?'
      ).get(documentId) as { fp: string; v: number } | null;
      if (row) {
        stateExists = true;
        storedVersion = row.v;
      }
    }
  } catch {
    // 表缺失即无 state（只读探测，不建表）。
  }
  const decision = shouldSkipSeedMaterialization(sqlite, documentId, book, currentVersion);
  return {
    documentId,
    stateExists,
    storedVersion,
    currentVersion,
    shouldSkip: decision.skip,
    reason: decision.reason,
  };
}

export interface SeedSkipDecision {
  skip: boolean;
  reason: string;
  fingerprint: string;
}

/**
 * Skip 谓词：persisted fp == current fp（含版本） AND projection healthy，二者缺一即 rebuild。
 * 无 state 行（首建/表缺）→ 不 skip。
 */
export function shouldSkipSeedMaterialization(
  sqlite: Database,
  documentId: string,
  book: TextbookAST,
  materializerVersion: number = SEED_MATERIALIZER_VERSION
): SeedSkipDecision {
  const fingerprint = computeSeedMaterializationFingerprint(sqlite, book, materializerVersion);
  let tables = 0;
  try {
    tables = (sqlite.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='seed_materialization'").get() as { n: number }).n;
  } catch {
    return { skip: false, reason: 'state 表缺失', fingerprint };
  }
  if (tables === 0) return { skip: false, reason: 'state 表缺失', fingerprint };
  const row = sqlite.query('SELECT fingerprint AS fp, materializer_version AS v FROM seed_materialization WHERE document_id = ?').get(documentId) as { fp: string; v: number } | null;
  if (!row) return { skip: false, reason: '无 materialization 记录（首建）', fingerprint };
  if (row.v !== materializerVersion) {
    return { skip: false, reason: `materializer 版本变化: ${row.v} → ${materializerVersion}`, fingerprint };
  }
  if (row.fp !== fingerprint) return { skip: false, reason: 'fingerprint 变化（input/dependency 变）', fingerprint };
  const health = isTextbookProjectionHealthy(sqlite, documentId, book);
  if (!health.healthy) return { skip: false, reason: `projection 不健康: ${health.reasons[0] ?? 'unknown'}`, fingerprint };
  return { skip: true, reason: 'fingerprint 一致且 projection 健康', fingerprint };
}

export interface MaterializeSeedInput {
  docBase: {
    id: string;
    userId: string;
    title: string;
    sourceKind: 'curriculum_textbook';
    language: string;
    content: string;
  };
  book: TextbookAST;
  fingerprint: string;
  materializerVersion: number;
}

/**
 * 原子 materialize（seed 专用）：documents upsert + shredIntoTransaction +
 * seed_materialization state upsert，同一事务。任一步失败整体回滚（含 state）。
 * 复用 shredIntoTransaction，不复制 shred 实现；禁止 save-then-commit-then-shred。
 */
export function materializeSeedIntoTransaction(
  tx: Parameters<Parameters<RepoDeps['db']['transaction']>[0]>[0],
  input: MaterializeSeedInput
): void {
  const { docBase, book, fingerprint, materializerVersion } = input;
  const astJson = JSON.stringify(book);
  const now = nowIso();
  const existing = tx.select().from(documents).where(eq(documents.id, docBase.id)).limit(1).all();
  if (existing.length > 0) {
    tx.update(documents)
      .set({ title: docBase.title, content: docBase.content, astJson, updatedAt: now })
      .where(eq(documents.id, docBase.id))
      .run();
  } else {
    tx.insert(documents)
      .values({
        id: docBase.id,
        userId: docBase.userId,
        title: docBase.title,
        sourceKind: docBase.sourceKind,
        language: docBase.language,
        content: docBase.content,
        astJson,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  shredIntoTransaction(tx, docBase.id, book);
  tx.insert(seedMaterialization)
    .values({ documentId: docBase.id, fingerprint, materializerVersion, updatedAt: now })
    .onConflictDoUpdate({
      target: seedMaterialization.documentId,
      set: { fingerprint, materializerVersion, updatedAt: now },
    })
    .run();
}
