import type { EmbeddedOutlineResult, PdfInspectorLike } from './pdf-runtime.js';
import type { EmbeddedOutlineEntry } from './pdf-import-service.js';

/**
 * CMD-LINGUA-P2.2：内嵌目录质量门（全仓唯一判定）。
 *
 * 背景：某 371 页真书的 embedded outline 全是 `1/2/3...` 纯数字书签，
 * 旧判定（“有可用条目即命中”）把它当成原生教材目录，导致 OCR 全跳过、
 * 目录发现直接截断。PDF 有书签 ≠ 有可用教材目录。
 *
 * 三态（唯一复用，禁止各处复制不同判断）：
 * - none：根本没有内嵌目录（无方法/抛错/畸形/空目录）→ 走 OCR；
 * - usable：有可用于教材的语义目录 → 保留 embedded 短路；
 * - unusable：有书签但不能作为教材目录 → 回退 OCR，并如实告诉用户。
 *
 * 语义标题规则（明确、可测试）：
 * - 非语义：纯 ASCII 数字、纯全角数字、数字+分隔符（1.2/1-3）、页码式
 *   （Page 5/5 页/5ページ）、仅符号、仅空白；
 * - 其余含真实文字的一律语义（第1課/復習A/Lesson 1/第１章 はじめまして、
 *   以及任何章节文字标题——单条宽松，由下面的计数门槛收紧）；
 * - 保守门槛：语义标题 ≥ 2 条，且占有效条目 ≥ 60%（“只有一条文字条目”
 *   或“5 条语义混在 300 条数字里”一律不得通过）；
 * - truncated / 零有效条目（无可解析 physicalPage 等）/ 零语义标题：一律 unusable。
 *
 * 输出只允许状态、reason code、计数；日志调用方只许打这三类，严禁标题
 * 正文、路径、文件名、用户标识（本模块不记任何日志）。
 */

/** 语义标题最少条数（保守门槛其一）。 */
export const MIN_SEMANTIC_TITLES = 2;
/** 语义标题占有效条目最小比例（保守门槛其二）。 */
export const MIN_SEMANTIC_RATIO = 0.6;

export type EmbeddedOutlineQuality = 'none' | 'usable' | 'unusable';

export type EmbeddedOutlineQualityReason =
  | 'no-method'
  | 'threw'
  | 'malformed'
  | 'empty'
  | 'truncated'
  | 'no-valid-entries'
  | 'no-semantic-titles'
  | 'below-threshold'
  | 'ok';

export interface EmbeddedOutlineQualityReport {
  quality: EmbeddedOutlineQuality;
  reason: EmbeddedOutlineQualityReason;
  /** native 返回的条目总数（畸形/缺席时为 0）。 */
  totalItems: number;
  /** 标题非空 + level 合法 + physicalPage 可解析落界的条目数。 */
  validEntries: number;
  /** 有效条目中的语义标题数。 */
  semanticEntries: number;
  /** 有效条目（与旧 readEmbeddedOutlineEntries 同口径，供 map 透传）。 */
  entries: EmbeddedOutlineEntry[];
}

const PURE_ASCII_DIGITS = /^\d+$/;
const PURE_FULLWIDTH_DIGITS = /^[０-９]+$/;
/** 数字+分隔符（1.2/1-3/1/2，要求至少含一个数字，纯符号另有专判）。 */
const DIGITS_WITH_SEPARATORS = /^(?=.*[\d０-９])[\d０-９\s.\-–—/、，。．·:：]+$/;
const PAGE_LABEL_BEFORE = /^(p\.?|pp\.?|page|pages|页|ページ|頁)\s*[\d０-９]+$/i;
const PAGE_LABEL_AFTER = /^[\d０-９]+\s*(页|ページ|頁)$/;
/** 内容字符：数字/拉丁/假名/CJK/谚文——命中其一即含真实文字。 */
const CONTENT_CHAR = /[0-9０-９A-Za-z\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

/**
 * 单标题语义判定（纯函数）：非语义仅限数字形/页码形/符号形/空白，
 * 其余一律语义（单条宽松，靠计数门槛收紧，见模块头）。
 */
export function isSemanticOutlineTitle(title: string): boolean {
  const text = title.trim();
  if (!text) return false;
  if (PURE_ASCII_DIGITS.test(text)) return false;
  if (PURE_FULLWIDTH_DIGITS.test(text)) return false;
  if (DIGITS_WITH_SEPARATORS.test(text)) return false;
  if (PAGE_LABEL_BEFORE.test(text)) return false;
  if (PAGE_LABEL_AFTER.test(text)) return false;
  if (!CONTENT_CHAR.test(text)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractValidEntries(result: EmbeddedOutlineResult, pageCount: number): EmbeddedOutlineEntry[] {
  const kept: EmbeddedOutlineEntry[] = [];
  if (!Array.isArray(result.items)) return kept;
  for (const entry of result.items) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as { title?: unknown; level?: unknown; physicalPage?: unknown };
    if (typeof rec.title !== 'string' || !rec.title.trim()) continue;
    if (typeof rec.level !== 'number' || !Number.isInteger(rec.level) || rec.level < 1) continue;
    if (
      typeof rec.physicalPage !== 'number' ||
      !Number.isInteger(rec.physicalPage) ||
      rec.physicalPage < 1 ||
      rec.physicalPage > pageCount
    ) {
      continue;
    }
    kept.push({ title: rec.title.trim(), level: rec.level, physicalPage: rec.physicalPage });
  }
  return kept;
}

/**
 * 内嵌目录质量判定（只读，唯一入口）：raw 读取 → 截断/空门 →
 * 有效条目 → 语义计数门槛。永不抛（native 异常即 none），永不记日志。
 */
export function classifyEmbeddedOutline(
  inspector: PdfInspectorLike,
  bytes: Uint8Array,
  pageCount: number
): EmbeddedOutlineQualityReport {
  if (typeof inspector.extractEmbeddedOutline !== 'function') {
    return { quality: 'none', reason: 'no-method', totalItems: 0, validEntries: 0, semanticEntries: 0, entries: [] };
  }
  let result: EmbeddedOutlineResult;
  try {
    result = inspector.extractEmbeddedOutline(bytes);
  } catch {
    return { quality: 'none', reason: 'threw', totalItems: 0, validEntries: 0, semanticEntries: 0, entries: [] };
  }
  if (!isRecord(result) || !Array.isArray(result.items)) {
    return { quality: 'none', reason: 'malformed', totalItems: 0, validEntries: 0, semanticEntries: 0, entries: [] };
  }
  const totalItems = result.items.length;
  if (totalItems === 0) {
    return { quality: 'none', reason: 'empty', totalItems: 0, validEntries: 0, semanticEntries: 0, entries: [] };
  }
  if (result.truncated === true) {
    return { quality: 'unusable', reason: 'truncated', totalItems, validEntries: 0, semanticEntries: 0, entries: [] };
  }
  const entries = extractValidEntries(result, pageCount);
  if (entries.length === 0) {
    return { quality: 'unusable', reason: 'no-valid-entries', totalItems, validEntries: 0, semanticEntries: 0, entries: [] };
  }
  const semanticEntries = entries.filter((e) => isSemanticOutlineTitle(e.title)).length;
  if (semanticEntries === 0) {
    return {
      quality: 'unusable',
      reason: 'no-semantic-titles',
      totalItems,
      validEntries: entries.length,
      semanticEntries: 0,
      entries,
    };
  }
  if (semanticEntries < MIN_SEMANTIC_TITLES || semanticEntries / entries.length < MIN_SEMANTIC_RATIO) {
    return {
      quality: 'unusable',
      reason: 'below-threshold',
      totalItems,
      validEntries: entries.length,
      semanticEntries,
      entries,
    };
  }
  return {
    quality: 'usable',
    reason: 'ok',
    totalItems,
    validEntries: entries.length,
    semanticEntries,
    entries,
  };
}
