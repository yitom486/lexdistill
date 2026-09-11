import { EXERCISE_RE, LESSON_TOKEN_RE, TRAILING_PAGE_RE, stripMarkdownLineMarkers } from './toc-discovery.js';
import { isSemanticOutlineTitle } from './embedded-outline-quality.js';
import type { TocGeometrySpan } from './toc-baseline.js';

/**
 * CMD-LINGUA-P3.2B：目录页版式块匹配（只读，纯函数）。
 *
 * 动机（实测）：课标题与印刷页码常被 OCR/行切分拆到不同文本行（`第3課 さんぽ ……` +
 * 独立 `30` 行），或页码列整体偏右（双栏目录），或黏连（`復習A42`）——此时
 * markdown 单行尾数正则必然 0 entries。凡有坐标（OCR spans / native
 * `extractTextWithPositions`，同坐标系 y-up）即按几何关联补回；无坐标调用方
 * 直接降级旧文本路径（本模块不对空输入编造任何条目）。
 *
 * Block-matching contract（调用方与单测共同锁定）：
 * - heading：含课号 token（第N課/復習A-B/LESSON/UNIT n）+ 语义标题 + 非习题 +
 *   全行数字 run < 3 + 自身不带尾页码（带尾页码的完整行归文本路径，避免双计）；
 * - page 候选：剥离点线装饰后为独立 `1–1500` 数字的单行（年份/超大值天然排除）；
 * - 关联（1:1 消费）：同行（|Δy| ≤ 0.6×字高且页码中心在右）优先，再邻行
 *   （|Δy| ≤ 2.2×页字高中位数，页码左缘不甩出标题左缘）；同行多 heading 竞争
 *   按水平最近归属，落败者转邻行再找，仍无则 contested；
 * - 页眉页脚带（页 y 跨度上下各 12%，与 folio 同口径）内的独立数字一律视为
 *   folio 排除——页眉页脚永不当页码；
 * - 黏连形（标题末尾无空格紧跟数字，如 `復習A42`/`第3課 さんぽ42`）直接拆分，
 *   标题部无课号 token 的不拆（`Unit 10` 类不受影响）；
 * - 点线/注音/例句/页眉页脚：无课号 token 即非 heading（例句纵有数字也配不上）；
 *   黏连与关联前先剥点线 run；例句形 heading（問N/練習N）由 EXERCISE_RE 拒；
 * - 证据不足（无候选/超容差/低置信/被消费）一律 unresolved 计数，绝不猜页码；
 *   unresolved 只记原因计数，不存原文。
 */

export type TocBlockUnresolvedReason = 'no-page' | 'contested' | 'low-confidence';

/** 版式块产出的确定性条目（kind/level/source 由组装层定：lesson/1/geometry-block）。 */
export interface TocBlockEntry {
  title: string;
  printedPage: number;
}

export interface TocBlockMatchOutput {
  entries: TocBlockEntry[];
  /** 未定位的 heading 数（= 原因计数之和；无一猜测）。 */
  unresolved: number;
  unresolvedReasons: Record<TocBlockUnresolvedReason, number>;
}

/** 同行判定：|Δy| ≤ 此倍数字高（实测同行 OCR 切分抖动远小于此）。 */
export const TOC_BLOCK_ROW_Y_RATIO = 0.6;
/** 邻行判定：|Δy| ≤ 此倍数 × 页字高中位数（双倍行距目录的相邻行≈2.0×字高，仍命中；隔行 4× 不命中）。 */
export const TOC_BLOCK_ADJACENT_Y_RATIO = 2.2;
/** 上下边带占页 y 跨度比例（folio 同口径 0.12；带内独立数字=folio，永不当页码）。 */
export const TOC_BLOCK_EDGE_BAND_RATIO = 0.12;
/** 印刷页码上限（folio 同口径 1500：年份/异常大值天然排除）。 */
export const TOC_BLOCK_PAGE_MAX = 1500;
/** 边带/容差计算的最少行数（行太少时内容跨度推不出页边距，不做边带排除；
 * 稀疏页的 heading+number 纯靠容差+1:1+语义兜住）。 */
const MIN_LINES_FOR_EDGE = 6;
/** 数字汤：全行数字 run 达此数即拒绝（与行抽取同口径 3）。 */
const SOUP_NUMBERS = 3;

/** 点线 run（省略号/点列/中点/横线，半角全角）：匹配前剥离，不参与标题/数字判定。 */
const LEADER_RUN_RE = /[…⋯․・·∙•.]{2,}|[-－—─]{2,}/g;
/** 独立页码行：剥装饰后恰为 1–4 位数字。 */
const PAGE_ONLY_RE = /^\d{1,4}$/;
/**
 * 黏连形：标题末尾无空格紧跟 ≤3 位数字（`復習A42`/`第3課42`/`第3課 さんぽ42`）。
 * 守卫：标题部须含课号 token（`Unit 10` 回溯只分出 `Unit` 无课号 → 拒绝；
 * `第3課2024` 等年份黏连被 PAGE_MAX 挡）。
 */
const FUSED_PAGE_RE = /^(.*\D)(\d{1,3})$/;
/** 边带/首尾装饰符（folio 同口径子集：只剥标点空白，不动课号与数字）。 */
const EDGE_STRIP_RE = /^[\s\-–—·•.。,、()（）[\]]+|[\s\-–—·•.。,、()（）[\]]+$/g;

interface LayoutLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lowConfidence: boolean;
}

function cleanLineText(raw: string): string {
  return stripMarkdownLineMarkers(raw.replace(LEADER_RUN_RE, ' ').replace(/\s+/g, ' ').trim());
}

/**
 * 块/行标题归一化（纯函数）：剥点线 run + Markdown 残留 + 表格竖线→空格 +
 * 空白折叠。组装层 claimed 去重键用它，保证“同一标题不同证据形”只计一次
 * （如块标题 `第1課 はじめまして` vs 行标题 `第1課 はじめまして ……`）。
 */
export function normalizeTocBlockText(raw: string): string {
  return cleanLineText(raw).replace(/[|｜]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pageValueOf(text: string): number | null {
  const core = text.replace(EDGE_STRIP_RE, '');
  if (!PAGE_ONLY_RE.test(core)) return null;
  const value = Number(core);
  if (!Number.isSafeInteger(value) || value < 1 || value > TOC_BLOCK_PAGE_MAX) return null;
  return value;
}

function isHeadingText(text: string): boolean {
  if (!LESSON_TOKEN_RE.test(text)) return false;
  if (EXERCISE_RE.test(text)) return false;
  if ((text.match(/\d+/g) ?? []).length >= SOUP_NUMBERS) return false;
  if (TRAILING_PAGE_RE.test(text)) return false;
  return isSemanticOutlineTitle(stripMarkdownLineMarkers(text));
}

function emptyReasons(): Record<TocBlockUnresolvedReason, number> {
  return { 'no-page': 0, contested: 0, 'low-confidence': 0 };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const high = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return high;
  return ((sorted[mid - 1] ?? 0) + high) / 2;
}

/**
 * 版式块匹配（纯函数）：输入单页全部坐标行（OCR spans 或 native 定位条目，
 * 同坐标系；调用方保证同页），输出确定性条目 + 未定位计数。
 * 无坐标行（空数组/全低置信）即零条目零 unresolved——调用方降级文本路径。
 * satisfiedTitles：文本路径已认领的归一化标题集合——命中的行直接忽略
 * （不产出、不计 unresolved；文本证据优先，块只补缺口）。
 */
export function matchTocLayoutBlocks(
  spans: TocGeometrySpan[],
  satisfiedTitles?: ReadonlySet<string>
): TocBlockMatchOutput {
  const reasons = emptyReasons();
  const lines: LayoutLine[] = [];
  for (const span of spans) {
    if (!span || typeof span.text !== 'string') continue;
    const text = cleanLineText(span.text);
    if (!text) continue;
    if (![span.x, span.y, span.width, span.height].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    if (span.height <= 0) continue;
    lines.push({
      text,
      x: span.x,
      y: span.y,
      width: span.width,
      height: span.height,
      lowConfidence:
        span.confidence !== undefined &&
        (typeof span.confidence !== 'number' || span.confidence < 0.5),
    });
  }
  if (lines.length === 0) return { entries: [], unresolved: 0, unresolvedReasons: reasons };

  const entries: TocBlockEntry[] = [];
  const consumedLine = new Set<number>();

  // 1) 黏连形：单行内解决，不占几何关联名额。
  const fusedLine = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as LayoutLine;
    if (line.lowConfidence) continue;
    if (satisfiedTitles?.has(normalizeTocBlockText(line.text))) continue;
    // 与行抽取同口径：全行数字 run ≥3 先拒（标题+页码正常行为 ≤2 个）。
    if ((line.text.match(/\d+/g) ?? []).length >= SOUP_NUMBERS) continue;
    const fused = FUSED_PAGE_RE.exec(line.text);
    if (!fused) continue;
    const title = stripMarkdownLineMarkers((fused[1] ?? '').trim());
    const page = Number(fused[2]);
    if (!title || !Number.isSafeInteger(page) || page < 1 || page > TOC_BLOCK_PAGE_MAX) continue;
    if (!LESSON_TOKEN_RE.test(title) || EXERCISE_RE.test(title)) continue;
    if ((title.match(/\d+/g) ?? []).length >= SOUP_NUMBERS) continue;
    if (!isSemanticOutlineTitle(title)) continue;
    entries.push({ title, printedPage: page });
    fusedLine.add(i);
    consumedLine.add(i);
  }

  // 2) heading / 页码候选划分（低置信 heading 只计 unresolved，不参与配对）。
  const headings: number[] = [];
  const lowConfidenceHeadings: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fusedLine.has(i)) continue;
    const line = lines[i] as LayoutLine;
    if (!LESSON_TOKEN_RE.test(line.text)) continue;
    if (satisfiedTitles?.has(normalizeTocBlockText(line.text))) continue;
    if (!isHeadingText(line.text)) continue;
    if (line.lowConfidence) lowConfidenceHeadings.push(i);
    else headings.push(i);
  }
  reasons['low-confidence'] += lowConfidenceHeadings.length;

  const pageOf = new Map<number, number>();
  for (let i = 0; i < lines.length; i++) {
    if (consumedLine.has(i)) continue;
    const line = lines[i] as LayoutLine;
    if (line.lowConfidence) continue;
    const value = pageValueOf(line.text);
    if (value !== null) pageOf.set(i, value);
  }

  // 3) folio 边带：页 y 跨度上下各 12% 内的独立数字排除（页眉页脚永不当页码）。
  const eligiblePages = new Set(pageOf.keys());
  if (lines.length >= MIN_LINES_FOR_EDGE) {
    const centers = lines.map((line) => line.y + line.height / 2);
    const minY = Math.min(...centers);
    const maxY = Math.max(...centers);
    const span = maxY - minY;
    if (span > 0) {
      const band = span * TOC_BLOCK_EDGE_BAND_RATIO;
      for (const i of pageOf.keys()) {
        const line = lines[i] as LayoutLine;
        const center = line.y + line.height / 2;
        if (center >= maxY - band || center <= minY + band) eligiblePages.delete(i);
      }
    }
  }

  const medianH = median(lines.map((line) => line.height));
  const rowTol = Math.max(2, medianH * TOC_BLOCK_ROW_Y_RATIO);
  const adjacentTol = Math.max(2, medianH * TOC_BLOCK_ADJACENT_Y_RATIO);
  const centerY = (i: number): number => (lines[i] as LayoutLine).y + (lines[i] as LayoutLine).height / 2;
  const centerX = (i: number): number => (lines[i] as LayoutLine).x + (lines[i] as LayoutLine).width / 2;

  // 4a) 同行优先：页码中心在标题中心之右；多 heading 竞争按水平最近归属。
  const lostRow = new Set<number>();
  const rowPages = [...eligiblePages].filter((p) => !consumedLine.has(p));
  const claimedHeading = new Set<number>();
  for (const p of rowPages) {
    let best = -1;
    let bestDx = Number.POSITIVE_INFINITY;
    for (const h of headings) {
      if (claimedHeading.has(h)) continue;
      if (Math.abs(centerY(p) - centerY(h)) > rowTol) continue;
      if (centerX(p) <= centerX(h)) continue;
      const dx = Math.abs(centerX(p) - centerX(h));
      if (dx < bestDx) {
        bestDx = dx;
        best = h;
      }
    }
    if (best >= 0) {
      const line = lines[best] as LayoutLine;
      entries.push({ title: line.text, printedPage: pageOf.get(p) as number });
      claimedHeading.add(best);
      consumedLine.add(p);
      eligiblePages.delete(p);
    }
  }
  // 同行落败者标记（其同行页码被更近 heading 取走 → 转邻行再找，仍无则 contested）。
  for (const h of headings) {
    if (claimedHeading.has(h)) continue;
    for (const p of pageOf.keys()) {
      if (!consumedLine.has(p)) continue;
      if (Math.abs(centerY(p) - centerY(h)) <= rowTol && centerX(p) > centerX(h)) {
        lostRow.add(h);
        break;
      }
    }
  }

  // 4b) 邻行：上/下对称容差；页码左缘不得甩出标题左缘（半字高宽容）；最近优先，1:1 消费。
  // y-up 页顶为大 y：阅读序从大到小（轴向假设只影响竞争优先级，不影响配对证据本身）。
  const ordered = [...headings].filter((h) => !claimedHeading.has(h)).sort((a, b) => centerY(b) - centerY(a));
  for (const h of ordered) {
    const line = lines[h] as LayoutLine;
    let best = -1;
    let bestDy = Number.POSITIVE_INFINITY;
    let bestDx = Number.POSITIVE_INFINITY;
    let contestedNearby = false;
    for (const p of eligiblePages) {
      if (consumedLine.has(p)) continue;
      const pline = lines[p] as LayoutLine;
      if (pline.x < line.x - line.height * 0.5) continue;
      const dy = Math.abs(centerY(p) - centerY(h));
      if (dy > adjacentTol) continue;
      const dx = Math.abs(centerX(p) - centerX(h));
      if (dy < bestDy || (dy === bestDy && dx < bestDx)) {
        best = p;
        bestDy = dy;
        bestDx = dx;
      }
    }
    if (best < 0) {
      // 被消费的邻行页码本可配对 → contested，否则 no-page（绝不猜）。
      // 注意：被消费页已从 eligiblePages 摘除，故此处只看 consumedLine。
      for (const p of pageOf.keys()) {
        if (!consumedLine.has(p)) continue;
        const pline = lines[p] as LayoutLine;
        if (pline.x < line.x - line.height * 0.5) continue;
        if (Math.abs(centerY(p) - centerY(h)) <= adjacentTol) {
          contestedNearby = true;
          break;
        }
      }
      const reason: TocBlockUnresolvedReason = contestedNearby || lostRow.has(h) ? 'contested' : 'no-page';
      reasons[reason]++;
      continue;
    }
    entries.push({ title: line.text, printedPage: pageOf.get(best) as number });
    consumedLine.add(best);
    eligiblePages.delete(best);
  }

  return { entries, unresolved: reasons['no-page'] + reasons.contested + reasons['low-confidence'], unresolvedReasons: reasons };
}
