import type { HeadingCandidate } from '@lexdistill/protocol';
import type { PageHeading } from './extract-headings.js';

/**
 * M5.1 起家在 content/src/pdf（前身 M8-6 纯规则抽取；规则不变）。
 *
 * 版式信号 → 标题候选（纯函数，零模型调用）。
 *
 * 输入是 PDF 解析层吐的文本条目（解析器 `extractTextWithPositions`
 * 的最小结构子集 + `extractStructureElements` 的角色表），输出是带版式
 * 特征的 HeadingCandidate。只描述观测、不做判定：模棱两可的行也放行，
 * 由 mini 分类器判为 noise 拒掉（kind=noise 就是为此准备的）。
 *
 * 与解析器解耦：只依赖下面两个最小形状，不 import 任何外部 SDK 类型，
 * 亦不依赖 Gateway 的 PdfInspectorLike 与任何运行时编排（采集与降级
 * 留在 Gateway `layout-headings.ts` 的 `collectLayoutCandidates`）。
 */
export interface LayoutTextItem {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  isBold: boolean;
  /** 内容流 Marked Content ID（标签化 PDF 才有；-1/缺失视为无） */
  mcid?: number;
}

export interface LayoutStructRole {
  page: number;
  mcid: number;
  role: string;
}

export interface LayoutHeadingsOptions {
  /** 页面宽度（pt；给了才能算居中，不给则 centered 保持未知） */
  pageWidthPt?: number;
  /** 每页最多候选（防目录页爆炸；默认 12） */
  maxPerPage?: number;
  /** 全书最多候选（默认 400） */
  maxTotal?: number;
}

interface Line {
  page: number;
  y: number;
  height: number;
  text: string;
  maxFont: number;
  bold: boolean;
  minX: number;
  maxX: number;
  mcids: number[];
}

const NUMBERING_HEAD = /^(第\s*[0-9一二三四五六七八九十百]+\s*[課课章節节回]|Lesson\s*\d+|Unit\s*\d+|[第][0-9]+\s*[課课]|[0-9①②③④⑤⑥⑦⑧⑨⑩]+[、.．\s])/;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** 同页条目按 y 聚成行（阈值取中位字高的 0.4 倍，最小 2pt）。 */
function groupLines(items: LayoutTextItem[]): Line[] {
  const sorted = [...items]
    .filter((it) => it.text.trim().length > 0 && it.fontSize > 0)
    .sort((a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x));
  const heights = sorted.map((it) => (it.height > 0 ? it.height : it.fontSize));
  const tol = Math.max(2, median(heights) * 0.4);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(it.y - last.y) <= tol) {
      last.text += it.text;
      last.maxFont = Math.max(last.maxFont, it.fontSize);
      last.bold = last.bold || it.isBold;
      last.minX = Math.min(last.minX, it.x);
      last.maxX = Math.max(last.maxX, it.x + it.width);
      last.height = Math.max(last.height, it.height > 0 ? it.height : it.fontSize);
      if (typeof it.mcid === 'number' && it.mcid >= 0) last.mcids.push(it.mcid);
    } else {
      lines.push({
        page: it.page,
        y: it.y,
        height: it.height > 0 ? it.height : it.fontSize,
        text: it.text,
        maxFont: it.fontSize,
        bold: it.isBold,
        minX: it.x,
        maxX: it.x + it.width,
        mcids: typeof it.mcid === 'number' && it.mcid >= 0 ? [it.mcid] : [],
      });
    }
  }
  // items 已按 (page,y,x) 排序，同组内追加即 x 序
  return lines;
}

function majorityRole(mcids: number[], roleByKey: Map<string, string>, page: number): string | undefined {
  if (mcids.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const m of mcids) counts.set(m, (counts.get(m) ?? 0) + 1);
  let best = -1;
  let bestCount = 0;
  for (const [m, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      best = m;
    }
  }
  return roleByKey.get(`${page}:${best}`);
}

/**
 * 正则候选 ∪ 版式候选（按 页｜文本 去重；命中同一行时版式特征贴到正则行上，
 * level 保留；纯版式行 level 记 0 表示无 markdown 级别）。
 */
export function mergeHeadingCandidates(
  regex: PageHeading[],
  layout: HeadingCandidate[]
): PageHeading[] {
  const merged = new Map<string, PageHeading>();
  for (const h of regex) {
    if (!h || typeof h.text !== 'string' || !h.text.trim()) continue;
    merged.set(`${h.page}｜${h.text.trim()}`, { ...h, text: h.text.trim().slice(0, 80) });
  }
  for (const c of layout) {
    const key = `${c.page}｜${c.text}`;
    const existing = merged.get(key);
    if (existing) {
      if (c.relSize !== undefined) existing.relSize = c.relSize;
      if (c.bold !== undefined) existing.bold = c.bold;
      if (c.centered !== undefined) existing.centered = c.centered;
      if (c.standalone !== undefined) existing.standalone = c.standalone;
      if (c.hasNumbering !== undefined) existing.hasNumbering = c.hasNumbering;
      if (c.structRole !== undefined) existing.structRole = c.structRole;
      continue;
    }
    merged.set(key, {
      page: c.page,
      level: 0,
      text: c.text,
      ...(c.relSize !== undefined ? { relSize: c.relSize } : {}),
      ...(c.bold !== undefined ? { bold: c.bold } : {}),
      ...(c.centered !== undefined ? { centered: c.centered } : {}),
      ...(c.standalone !== undefined ? { standalone: c.standalone } : {}),
      ...(c.hasNumbering !== undefined ? { hasNumbering: c.hasNumbering } : {}),
      ...(c.structRole !== undefined ? { structRole: c.structRole } : {}),
    });
  }
  return [...merged.values()];
}
/**
 * 文本条目 → 标题候选。
 * 放行规则（任一命中即为候选）：字号>=正文1.15倍 / 加粗 / 标签角色H1-H6 /
 * 带编号 / 独立短行（<=24字且上下留白大）。其余一律不打扰模型。
 */
export function layoutItemsToCandidates(
  items: LayoutTextItem[],
  roles: LayoutStructRole[] = [],
  options: LayoutHeadingsOptions = {}
): HeadingCandidate[] {
  const maxPerPage = options.maxPerPage ?? 12;
  const maxTotal = options.maxTotal ?? 400;
  if (items.length === 0) return [];

  const bodySize = median(items.filter((it) => it.fontSize > 0).map((it) => it.fontSize));
  const roleByKey = new Map(roles.map((r) => [`${r.page}:${r.mcid}`, r.role]));
  const lines = groupLines(items);

  // 按页分组算留白（需要相邻行）
  const byPage = new Map<number, Line[]>();
  for (const ln of lines) {
    const arr = byPage.get(ln.page) ?? [];
    arr.push(ln);
    byPage.set(ln.page, arr);
  }

  const out: HeadingCandidate[] = [];
  for (const [, pageLines] of byPage) {
    let kept = 0;
    for (let i = 0; i < pageLines.length && out.length < maxTotal && kept < maxPerPage; i++) {
      const ln = pageLines[i] as Line;
      const text = ln.text.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!text) continue;
      const prev = pageLines[i - 1];
      const next = pageLines[i + 1];
      const gapBefore = prev ? ln.y - (prev.y + prev.height) : Number.POSITIVE_INFINITY;
      const gapAfter = next ? next.y - (ln.y + ln.height) : Number.POSITIVE_INFINITY;
      const lineGap = Math.max(ln.height, 1);
      const standalone = gapBefore > lineGap * 1.2 && gapAfter > lineGap * 1.2;
      const relSize = bodySize > 0 ? ln.maxFont / bodySize : undefined;
      const structRole = majorityRole(ln.mcids, roleByKey, ln.page);
      const isStructHeading = typeof structRole === 'string' && /^H[1-6]$/i.test(structRole);
      const hasNumbering = NUMBERING_HEAD.test(text);
      const shortStandalone = standalone && text.length <= 24;

      const hit =
        isStructHeading ||
        (typeof relSize === 'number' && relSize >= 1.15) ||
        ln.bold ||
        hasNumbering ||
        shortStandalone;
      if (!hit) continue;

      const cand: HeadingCandidate = { page: ln.page, text };
      if (typeof relSize === 'number' && Number.isFinite(relSize)) {
        cand.relSize = Math.min(10, Math.round(relSize * 100) / 100);
      }
      if (ln.bold) cand.bold = true;
      if (standalone) cand.standalone = true;
      if (hasNumbering) cand.hasNumbering = true;
      if (typeof structRole === 'string' && structRole) cand.structRole = structRole.slice(0, 16);
      if (typeof options.pageWidthPt === 'number' && options.pageWidthPt > 0) {
        const center = (ln.minX + ln.maxX) / 2;
        const pageCenter = options.pageWidthPt / 2;
        // 行中点偏离页中点不超过页宽 8% 视为居中
        if (Math.abs(center - pageCenter) <= options.pageWidthPt * 0.08) cand.centered = true;
      }
      out.push(cand);
      kept++;
    }
  }
  return out;
}
