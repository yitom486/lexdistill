/**
 * M8-3 自 Gateway 迁入 document-ingest-pdf（字节一致，行为不变）。
 * 目录/标题抽取（纯函数）：Markdown → 每页标题 + 目录条目。
 * 有目录的书：目录条目（第N課 + 印刷页码）即 ground truth；
 * 无目录的书：调用方先扫全书标题建地图（见 mapPdfPages），再按标题页导入。
 */

export interface PageHeading {
  page: number;
  level: number;
  text: string;
  /** 版式特征（layout-headings 补上；只有观测，没有时缺席） */
  relSize?: number;
  bold?: boolean;
  centered?: boolean;
  standalone?: boolean;
  hasNumbering?: boolean;
  structRole?: string;
}

export interface TocEntry {
  label: string;
  lessonNo: string;
  printedPage: number;
}

const HEADING_LINE = /^(#{1,6})\s+(.+)$/;
const LESSON_HEAD = /第\s*[0-9一二三四五六七八九十百]+\s*[課课]|Lesson\s*\d+|Unit\s*\d+|復習|复习|練習|练习|会話|かいわ/;
// 目录行：第N課/復習A/付録 ... 数字（点线/空格分隔；页码可能在同一行）
// 分支二分隔符放宽到 *（OCR 常把"復習A42"粘在一起，中间零分隔）
// 分支三种 covers 页码前置同行（"31 第4課"，inspector 按视觉流合并时 J2 拼行逻辑够不着）
const NON_LESSON_SECTION = '(?:復習|复习|付録|付录|前言|序言|索引)';
const TOC_LINE = new RegExp(
  `^第\\s*([0-9一二三四五六七八九十百]+)\\s*[課课]\\s*(.{0,30}?)\\s*[.…·\\s]{2,}(\\d{1,4})\\s*$` +
  `|^(${NON_LESSON_SECTION}\\s*[A-Z]?)\\s*(.{0,30}?)\\s*[.…·\\s]*(\\d{1,4})\\s*$` +
  `|^(\\d{1,4})\\s+(第\\s*[0-9一二三四五六七八九十百]+\\s*[課课].{0,30}?)\\s*$`
);
/** 页码前置分支的课号回抽（label 里必含 第N課，取数字部分） */
const LEADING_PAGE_LESSON_NO = /第\s*([0-9一二三四五六七八九十百]+)\s*[課课]/;
/** 课标题行（拼接后回贴页码用：本身无页码、无点线才是"裸标题"） */
const LESSON_TITLE_HEAD = /第\s*[0-9一二三四五六七八九十百]+\s*[課课]|(?:復習|复习)\s*[A-Z]?/;
/** 裸页码行（OCR 把行末页码甩到下一行/上一行） */
const BARE_PAGE = /^\d{1,4}$/;
/** 行末点线（页码断行信号） */
const TRAILING_DOTS = /[…·.．]{2,}\s*$/;

export function extractHeadingsFromMarkdown(markdown: string, page: number): PageHeading[] {
  const out: PageHeading[] = [];
  for (const raw of markdown.split('\n')) {
    const m = HEADING_LINE.exec(raw.trim());
    if (!m) continue;
    const text = (m[2] ?? '').trim().slice(0, 40);
    if (!text || !LESSON_HEAD.test(text)) continue;
    out.push({ page, level: m[1]?.length ?? 1, text });
  }
  return out;
}

/** 目录条目抽取（尽力而为；无目录返回空数组，调用方改走全书标题地图）。
 *
 * 扫描版 OCR 两大致命伤在此缝合（纯规则，不调模型）：
 * - J1 点线断行：标题行以点线结尾、页码掉到后面 1-2 个非空行（`第3課 ………` + `30`）；
 * - J2 页码前置：裸页码行紧贴在裸课标题之前（`30` + `第3課`，OCR 先吐了右端数字）；
 * - 復習A 等非"第N課"单元与点线缺失（单空格）同样放行，页码只认行末/拼接后的数字。
 */
export function extractTocEntries(markdown: string): TocEntry[] {
  const cleaned: string[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw
      .replace(/^#{1,6}\s+/, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line || line.length > 80) continue;
    cleaned.push(line);
  }
  // 拼接遍：产出逻辑行（consumed 裸页码行不再独立参与）
  const logical: string[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < cleaned.length; i++) {
    if (consumed.has(i)) continue;
    const line = cleaned[i] as string;
    // J1：点线结尾 → 向后找 2 行内的裸页码
    if (TRAILING_DOTS.test(line) && !BARE_PAGE.test(line)) {
      let joined: string | null = null;
      for (let k = i + 1, seen = 0; k < cleaned.length && seen < 2; k++) {
        const nxt = cleaned[k] as string;
        if (consumed.has(k)) continue;
        seen++;
        if (BARE_PAGE.test(nxt)) {
          joined = `${line} ${nxt}`;
          consumed.add(k);
          break;
        }
      }
      if (joined) {
        logical.push(joined);
        continue;
      }
    }
    // J2：裸页码行 → 若下一非空行是无页码无点线的裸课标题，回贴
    if (BARE_PAGE.test(line)) {
      const nxt = cleaned[i + 1];
      if (
        nxt !== undefined &&
        !consumed.has(i + 1) &&
        LESSON_TITLE_HEAD.test(nxt) &&
        !TRAILING_DOTS.test(nxt) &&
        !/\d{1,4}\s*$/.test(nxt)
      ) {
        logical.push(`${nxt} … ${line}`);
        consumed.add(i + 1);
        i++;
        continue;
      }
    }
    logical.push(line);
  }
  const out: TocEntry[] = [];
  const seen = new Set<string>();
  for (const line of logical) {
    if (line.length > 80) continue;
    const m = TOC_LINE.exec(line);
    if (!m) continue;
    // 分支三（页码前置）：m[7]=页码，m[8]=含 第N課 的 label，课号回抽
    const leadingNo = m[8] ? (LEADING_PAGE_LESSON_NO.exec(m[8])?.[1] ?? '') : '';
    const lessonNo = ((m[1] ?? m[4] ?? leadingNo ?? '') as string).trim();
    const printedPage = Number(m[3] ?? m[6] ?? m[7]);
    const key = `${lessonNo}@${printedPage}`;
    if (!lessonNo || !Number.isFinite(printedPage) || seen.has(key)) continue;
    seen.add(key);
    out.push({ label: line.slice(0, 40), lessonNo, printedPage });
  }
  return out;
}
