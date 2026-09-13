/**
 * M5.1 起家在 content/src/pdf（前身 M8-7 纯规则抽取；检测逻辑不变）。
 *
 * CMD-LINGUA-P5B：受限 folio 候选抽取之纯检测闭包（只读，从不自动成 anchor）。
 *
 * 只回答“单页的页眉/页脚位置可能看见了什么印刷页码”，绝不回答
 * “这就是 anchor / 全书 offset / 该导哪一课”。输出 candidate 只是弱证据，
 * 必须经双源印证或用户确认才能成为 anchor——本模块在类型层面
 * 就不产出 anchor 形状（无 printedPage/physicalPage 映射字段）。
 *
 * 证据来源（弱→更弱，由 Gateway 编排按序供给本页条目）：
 * - native：行级条目（有坐标；实测 y-up，见下）；
 * - ocr：仅 native 缺失/无命中时对相同选择页 fallback（spans 同坐标系）。
 *
 * 纯解析层：零 import，不依赖 Gateway、SQLite/Drizzle、learner-core、Agent、
 * Web、网络或 PDF runtime。运行时编排（extractFolioCandidates：运行时准备、
 * 页窗、native/OCR fallback、输入校验、日志）留在 Gateway。
 */

// y 方向 Verified fact（pdf-lib 探针实测锁定）：
// TOPMARK@pdf-lib-y750 → native y=750，BOTMARK@pdf-lib-y50 → native y=50，
// 即 y 越大越靠页顶。header = 高 y 边带，footer = 低 y 边带。

/** 单次页数上限（与 review 材料窗同量级；超限 fail-closed，不截断）。 */
export const FOLIO_CANDIDATE_MAX_PAGES = 8;

/** 上下边带占页面 y 跨度的比例（启发式，见契约文档 §6）。 */
const FOLIO_EDGE_BAND_RATIO = 0.12;

/** 同行合并的 y 容差下限（pt；字高过小/缺失时的保底）。 */
const FOLIO_LINE_TOL_MIN_PT = 2;

/** Arabic folio 上限（启发式：教材印刷页极少超此数；年份 19xx–20xx 一并排除）。 */
const FOLIO_ARABIC_MAX = 1500;

/** OCR span 置信度下限（同 P3 口径；低于此只弃候选，不毙整页）。 */
export const FOLIO_OCR_MIN_CONFIDENCE = 0.5;

/** 同页最少文本条目数（证据不足直接无候选，不猜边带）。 */
const FOLIO_MIN_ITEMS_PER_PAGE = 3;

export type FolioNormalized =
  | { kind: 'arabic'; value: number }
  | { kind: 'roman'; value: string };

export type FolioLocation = 'header' | 'footer';
export type FolioSource = 'native' | 'ocr';
export type FolioConfidence = 'low' | 'medium';

export interface FolioCandidate {
  /** 观测到的原始 token（含装饰符，如 `·12`； discrimination 依据）。 */
  raw: string;
  /**
   * 归一化：arabic 给数字，roman **只给大写原形、绝不转数字**
   *（类型层面就没有 roman→number 的位置，误转写不出来）。
   */
  normalized: FolioNormalized;
  location: FolioLocation;
  source: FolioSource;
  /** native → medium；ocr → low（识别链更长一律降级）。 */
  confidence: FolioConfidence;
}

/** 几何输入最小形状（native 条目与 OCR span 的交集；只取定位需要的字段）。 */
export interface FolioGeometryItem {
  text: string;
  x: number;
  y: number;
  height: number;
  confidence?: number;
}

const ROMAN_RE = /^(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
const ARABIC_RE = /^\d{1,4}$/;
const EDGE_STRIP_RE = /^[\s\-–—·•.。,、()（）[\]]+|[\s\-–—·•.。,、()（）[\]]+$/g;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const high = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return high;
  return ((sorted[mid - 1] ?? 0) + high) / 2;
}

function normalizeToken(raw: string): FolioNormalized | null {
  const core = raw.replace(EDGE_STRIP_RE, '');
  if (!core || core.length > 20) return null;
  if (ARABIC_RE.test(core)) {
    const value = Number(core);
    if (!Number.isSafeInteger(value) || value < 1 || value > FOLIO_ARABIC_MAX) return null;
    return { kind: 'arabic', value };
  }
  if (ROMAN_RE.test(core)) {
    return { kind: 'roman', value: core.toUpperCase() };
  }
  return null;
}

/**
 * 单页 folio 候选检测（纯函数）：边带孤立 token → 归一化候选。
 * - 边带按本页 y 跨度相对划分（无页尺寸 API，只能相对，见契约 §6）；
 * - 同行条目按 y 容差合并后仍须**恰好一个 token**（多 token 行如目录/表格/正文直接弃）；
 * - header/footer 冲突并列保留，绝不仲裁；同位置同归一值去重。
 */
export function detectFolioCandidates(
  items: FolioGeometryItem[],
  source: FolioSource
): FolioCandidate[] {
  const usable = items.filter(
    (item) =>
      item &&
      typeof item.text === 'string' &&
      item.text.trim() &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      Number.isFinite(item.height)
  );
  if (usable.length < FOLIO_MIN_ITEMS_PER_PAGE) return [];
  const ys = usable.map((item) => item.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY;
  if (!Number.isFinite(span) || span <= 0) return [];
  const band = span * FOLIO_EDGE_BAND_RATIO;
  // y-up：高 y 为 header，低 y 为 footer。
  const headerItems = usable.filter((item) => item.y >= maxY - band);
  const footerItems = usable.filter((item) => item.y <= minY + band);
  const lineTol = Math.max(
    FOLIO_LINE_TOL_MIN_PT,
    median(usable.map((item) => (item.height > 0 ? item.height : 0))) * 0.5
  );
  const out: FolioCandidate[] = [];
  const seen = new Set<string>();
  const collect = (zone: FolioGeometryItem[], location: FolioLocation): void => {
    const ordered = [...zone].sort((a, b) => a.y - b.y || a.x - b.x);
    let current: FolioGeometryItem[] = [];
    const flush = (): void => {
      if (current.length > 0) emitLine(current, location);
      current = [];
    };
    for (const item of ordered) {
      const last = current[current.length - 1];
      if (last && Math.abs(item.y - last.y) <= lineTol) {
        current.push(item);
      } else {
        flush();
        current = [item];
      }
    }
    flush();
  };
  const emitLine = (line: FolioGeometryItem[], location: FolioLocation): void => {
    const text = line
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tokens = text.split(' ').filter((t) => t.length > 0);
    // 孤立 token：整行恰好一个词（目录行/表格行/正文行天然多词，直接弃）。
    if (tokens.length !== 1) return;
    const raw = tokens[0] as string;
    const normalized = normalizeToken(raw);
    if (!normalized) return;
    const core = raw.replace(EDGE_STRIP_RE, '');
    const key = `${location}｜${core}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      raw,
      normalized,
      location,
      source,
      confidence: source === 'native' ? 'medium' : 'low',
    });
  };
  collect(headerItems, 'header');
  collect(footerItems, 'footer');
  return out;
}
