import { ok, err, BusinessError, type Result } from '@study-studio/shared';
import type { StructureClass } from '@study-studio/protocol';
import type { TextbookAST } from '@study-studio/document-model';
import type { PageHeading, TocEntry } from './extract-headings.js';

/** M8-3 自 Gateway 迁入 document-ingest-pdf（字节一致，行为不变；ID 生成口径保留）。 */

/**
 * PDF 提取 Markdown → TextbookAST 初版结构化（纯函数）。
 *
 * 诚实边界（MVP）：
 * - 只结构化「课 / 对话句」：标题切课，说话人前缀（A：/B：/甲：）或引号/陈述句成句；
 * - 生词 / 语法点返回空数组 —— 细粒度抽取走后续「划线转卡」与 AI 结构化，不臆造；
 * - 中文译文填空字符串（PDF 里没有对照译文时不编造）。
 */

const MAX_LESSONS = 64;
const MAX_DIALOGUES_PER_LESSON = 300;
const MAX_MARKDOWN_CHARS = 2000000;

/**
 * provisional bookId（P1-A0 取证：`pdf-<ms时间戳>` 在快速连调下可碰撞，
 * 曾导致同内容两次 parse 产出完全相同的 lesson id 集合）。
 * 构成：时间戳（跨进程分散）+ 进程内单调计数器（同进程必唯一）+ 4 位随机（跨进程同 ms 兜底）。
 * 显式 bookId（测试/种子）不受影响；`pdf-` 前缀保留，旧前缀断言兼容。
 */
let provisionalCounter = 0;
export function newProvisionalBookId(): string {
  provisionalCounter += 1;
  const rand = Math.floor(Math.random() * 36 * 36 * 36 * 36).toString(36).padStart(4, '0');
  return `pdf-${Date.now().toString(36)}-${provisionalCounter.toString(36)}${rand}`;
}

const KANA_CLASS = '[぀-ヿｦ-ﾟ]';
const HANGUL_CLASS = '[가-힣ㄱ-ㅎㅏ-ㅣ]';
const HAN_CLASS = '[一-鿿]';

export function detectDocScript(text: string): 'JA' | 'KO' | 'EN' {
  const kana = (text.match(new RegExp(KANA_CLASS, 'g')) ?? []).length;
  const hangul = (text.match(new RegExp(HANGUL_CLASS, 'g')) ?? []).length;
  if (hangul > kana && hangul > 0) return 'KO';
  if (kana > 0) return 'JA';
  if (/[A-Za-z]/.test(text)) return 'EN';
  return 'JA';
}

interface RawSection {
  title: string;
  lines: string[];
}

/** 标题取课序号 N（阿拉伯/汉字数字；題/练习等前缀杂音不影响） */
function lessonNoOf(title: string): number | null {
  const m = /第\s*([0-9一二三四五六七八九十百]+)\s*[課课章节節回話话]/.exec(title);
  if (!m) return null;
  const raw = (m[1] ?? '').trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const digit: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  let n = 0;
  if (raw.includes('十')) {
    const [a, b] = raw.split('十');
    n = (a ? (digit[a] ?? 1) : 1) * 10 + (b ? (digit[b] ?? 0) : 0);
  } else {
    n = digit[raw] ?? 0;
  }
  if (raw.includes('百')) return null; // 超纲教材不猜
  return n > 0 ? n : null;
}

/** 标题取復習单元键（復習A/B…；非復習回 null） */
function reviewKeyOf(title: string): string | null {
  const m = /((?:復習|复习)\s*[A-Z]?)/.exec(title);
  return m ? (m[1] ?? '').replace(/\s+/g, '') : null;
}

/** 干净标题（裸 `第N課` 优先，否则首个标题） */
function pickGroupTitle(titles: string[]): string {
  for (const t of titles) {
    if (/^第\s*[0-9一二三四五六七八九十百]+\s*[課课章节節回話话]\s*$/.test(t.trim())) return t.trim();
  }
  return (titles[0] ?? '').trim();
}

interface LessonGroup {
  title: string;
  sections: RawSection[];
}

/** 课单元标题判定（与 markdownToAst 内联正则同一口径，提升为模块级供双路径共用）。 */
const LESSON_HEAD_RE = /第\s*[0-9一二三四五六七八九十百]+\s*[課课章节節回話话]|lesson\s*\d+|unit\s*\d+|(?:復習|复习)\s*[A-Z]?/i;

/**
 * 节 → 课归组（纯函数，可单测）：
 * - 同 N 合并（本文 + 題 + 页眉复读，不论是否相邻）；
 * - 復習X 按字母各自成组；其他无编号节各自成组（練習A 等复习单元保留）；
 * - 开篇无编号节：全书有编号节时丢弃（封面/CIP/前言），否则保留（无标题文档整篇一课）。
 */
export function groupSectionsByLesson(sections: RawSection[]): LessonGroup[] {
  const hasKeyed = sections.some(
    (s) => lessonNoOf(s.title) !== null || reviewKeyOf(s.title) !== null
  );
  const groups: LessonGroup[] = [];
  const byNo = new Map<number, LessonGroup>();
  const byReview = new Map<string, LessonGroup>();
  let leading = true;
  for (const s of sections) {
    const no = lessonNoOf(s.title);
    const rk = no === null ? reviewKeyOf(s.title) : null;
    if (no !== null) {
      leading = false;
      let g = byNo.get(no);
      if (!g) {
        g = { title: s.title, sections: [] };
        byNo.set(no, g);
        groups.push(g);
      }
      g.sections.push(s);
      continue;
    }
    if (rk !== null) {
      leading = false;
      let g = byReview.get(rk);
      if (!g) {
        g = { title: s.title, sections: [] };
        byReview.set(rk, g);
        groups.push(g);
      }
      g.sections.push(s);
      continue;
    }
    // 无编号节
    if (leading && hasKeyed) continue; // 开篇杂页丢弃
    leading = false;
    groups.push({ title: s.title, sections: [s] });
  }
  for (const g of groups) {
    const titles = g.sections.map((s) => s.title).filter((t) => t);
    if (titles.length > 1) g.title = pickGroupTitle(titles);
  }
  return groups;
}

/** map 阶段标题候选的文本截断上限（extractHeadingsFromMarkdown 同值；grounding 需容忍它）。 */
const CLASS_TEXT_TRUNCATE_CAP = 40;

/** markdown `#` 标题行提取（切课预扫描用；与主 split 同一正则）。 */
const MD_HEADING_RE = /^(#{1,6})\s+(.+)$/;

function collectHeadingTitles(markdown: string): string[] {
  const out: string[] = [];
  for (const l of markdown.split('\n')) {
    const m = MD_HEADING_RE.exec(l.trim());
    if (m?.[2] && m[2].trim()) out.push(m[2].trim());
  }
  return out;
}

/**
 * CMD-01：已确认分类接地（纯函数）。
 * - class.text（trim 后）必须等于本 markdown 切出的某个 `#` 标题才算接地；
 * - map 阶段 40 字截断的标题允许前缀 grounding（section 标题以 class 文本开头）；
 * - 对不上的 class 直接丢弃，绝不臆造课；同一标题多个 class 取数组首个。
 */
export function groundClassesByTitle(
  sections: RawSection[],
  classes: StructureClass[]
): Map<string, StructureClass> {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const s of sections) {
    const t = s.title.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      titles.push(t);
    }
  }
  const usable = classes.filter(
    (c): c is StructureClass =>
      !!c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string'
  );
  const out = new Map<string, StructureClass>();
  for (const c of usable) {
    const text = c.text.trim();
    if (!text || out.has(text)) continue;
    if (seen.has(text)) out.set(text, c);
  }
  for (const c of usable) {
    const text = c.text.trim();
    if (!text || text.length < CLASS_TEXT_TRUNCATE_CAP) continue;
    for (const t of titles) {
      if (!out.has(t) && t.startsWith(text)) {
        out.set(t, c);
        break;
      }
    }
  }
  return out;
}

interface KeyedLessonGroup extends LessonGroup {
  key: string;
}

/**
 * CMD-01：已确认分类驱动归组（纯函数）。
 * - `kind === 'lesson'` 才另起一课（同键全局归并，首见序：显式 lessonNo 优先，
 *   其次旧正则 N/復習键，最后标题；与旧逻辑同 N 全局归并一致，页眉复读不碎课）；
 * - `section` 不另起一课，正文并入当前课；
 * - `toc` / `noise` 不另起一课：丢弃噪声标题，正文行并入当前课，开篇（尚无课）则整体丢弃；
 * - 未标记标题沿用旧正则口径；无标题/开篇杂项沿用旧口径（有课并入，无课丢弃）。
 * - 生效前提：至少一个接地的 lesson 标记；否则返回 null，调用方回退旧正则归组。
 */
export function groupSectionsByClasses(
  sections: RawSection[],
  classOf: Map<string, StructureClass>
): LessonGroup[] | null {
  let hasLesson = false;
  for (const s of sections) {
    const t = s.title.trim();
    if (t !== '' && classOf.get(t)?.kind === 'lesson') {
      hasLesson = true;
      break;
    }
  }
  if (!hasLesson) return null;

  const lessonKeyOf = (title: string, cls: StructureClass | undefined): string => {
    const explicit = cls?.lessonNo?.trim();
    if (explicit) return `no:${explicit}`;
    const mNo = lessonNoOf(title);
    if (mNo !== null) return `no:${mNo}`;
    const rk = reviewKeyOf(title);
    if (rk !== null) return `rk:${rk}`;
    return `title:${title}`;
  };
  const groups: KeyedLessonGroup[] = [];
  // 同键全局归并（首见序，与旧逻辑同 N 归并一致）+ 当前课恒为数组尾。
  const byKey = new Map<string, KeyedLessonGroup>();
  // 当前课恒为数组尾（只追加不删减；避免“闭包内赋值、外层收窄失效”的 CFA 陷阱）。
  const top = (): KeyedLessonGroup | undefined => groups[groups.length - 1];
  const startOrMergeLesson = (s: RawSection, key: string): void => {
    const g = byKey.get(key);
    if (g) {
      g.sections.push(s);
      return;
    }
    const ng: KeyedLessonGroup = { key, title: s.title, sections: [s] };
    byKey.set(key, ng);
    groups.push(ng);
  };
  for (const s of sections) {
    const title = s.title.trim();
    if (title === '') {
      top()?.sections.push(s);
      continue;
    }
    const cls = classOf.get(title);
    if (cls !== undefined) {
      if (cls.kind === 'lesson') {
        startOrMergeLesson(s, lessonKeyOf(title, cls));
        continue;
      }
      if (cls.kind === 'section') {
        top()?.sections.push(s);
        continue;
      }
      top()?.sections.push({ title: '', lines: s.lines });
      continue;
    }
    if (LESSON_HEAD_RE.test(title)) {
      startOrMergeLesson(s, lessonKeyOf(title, undefined));
      continue;
    }
    top()?.sections.push(s);
  }
  for (const g of groups) {
    const titles = g.sections.map((x) => x.title).filter((t) => t);
    if (titles.length > 1) g.title = pickGroupTitle(titles);
  }
  return groups;
}

function cleanLine(raw: string): string | null {
  let line = raw.trim();
  if (!line) return null;
  // 页码标记 / HTML 注释页码
  if (/^<!--\s*Page\s+\d+\s*-->$/i.test(line)) return null;
  // 代码围栏标记行丢弃（内容行照常参与过滤）
  if (/^```/.test(line)) return null;
  // 列表符号（MinerU 习题编号常用无空格的 `1・` 全角点，单列分支）
  line = line.replace(/^(\s*([-*+]|\d+[.)])\s+|\s*\d+・)/, '').trim();
  // Markdown 表格分隔行
  if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes('-')) return null;
  // 标题残留先剥（# 不应成为元行过滤的挡箭牌：`# 目次` 必须被下一行认出来）
  line = line.replace(/^#{1,6}\s+/, '').trim();
  // 目录点线（1 ...... 5）与纯目录标题不进课文
  if (/\.{3,}|…{2,}/.test(line)) return null;
  if (/^(目录|目次|contents?|index)$/i.test(line)) return null;
  // 裸 URL / 图片
  if (/^https?:\/\/\S+$/.test(line)) return null;
  if (/^!\[.*\]\(.*\)$/.test(line)) return null;
  // 表格竖线转空格
  line = line.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  // 引用符号
  line = line.replace(/^>\s*/, '').trim();
  // 加粗/斜体符号
  line = line.replace(/[*_~]{1,3}/g, '').trim();
  if (line.length < 2) return null;
  // 纯数字页码 / 纯标点
  if (/^[\d\s.,;:!?。，；：！？、…—·\-–—]+$/.test(line)) return null;
  // tofu 乱码行（U+FFFD 替换符占比过高，多见于封面/元数据页）不进课文
  const tofu = (line.match(/�/g) ?? []).length;
  if (tofu > 0 && tofu / line.length > 0.1) return null;
  // 实质文字不足 2 个（字母/数字/中日韩文字才算）不进课文
  const substantial = (line.match(/[一-鿿぀-ヿｦ-ﾟ가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]/g) ?? []).length;
  if (substantial < 2) return null;
  return line;
}

const SPEAKER_PREFIX = /^(.{1,12})[：:]\s*(.+)$/;
// 行内多人说话（如提取器把同页多行并成一行）：在句末标点后的说话人前缀 / 独立引号处切分
const MIDLINE_SPEAKER_SPLIT =
  /(?<=[。！？」!?.])\s*(?=[^\s。！？」!?.：:]{1,12}[：:])|(?<=[。！？!?.])\s*(?=[「"“])/;

function splitSpeakerSegments(cleaned: string): string[] {
  if (!MIDLINE_SPEAKER_SPLIT.test(cleaned)) return [cleaned];
  return cleaned
    .split(MIDLINE_SPEAKER_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toDialogue(line: string): { speaker: string; japanese: string; chinese: string } | null {
  const m = SPEAKER_PREFIX.exec(line);
  if (m) {
    const speaker = (m[1] ?? '').trim();
    const text = (m[2] ?? '').trim();
    // 排除 URL / 时间戳类误伤；纯数字说话人（习题编号 2：…）不是说话人
    if (/^https?:/i.test(text)) return null;
    if (speaker.length === 0 || speaker.length > 12 || text.length < 1) return null;
    if (/^\d+$/.test(speaker)) return null;
    const { ja, zh } = splitInlineChinese(text);
    return { speaker, japanese: ja, chinese: zh };
  }
  // 引号独句 → 课文朗读句
  const quoted = /^「(.+)」$/.exec(line) || /^"(.+)"$/.exec(line) || /^“(.+)”$/.exec(line);
  if (quoted?.[1]) {
    const { ja, zh } = splitInlineChinese(quoted[1].trim());
    return { speaker: '课文', japanese: ja, chinese: zh };
  }
  // 普通陈述句（至少含一点实质文字）
  if (line.length >= 2) {
    const { ja, zh } = splitInlineChinese(line);
    return { speaker: '课文', japanese: ja, chinese: zh };
  }
  return null;
}

/** 独立课标题上限（正文长句即使以课号开头也不提升，防碎课）。 */
const PROMOTE_TITLE_MAX = 30;

/** 课单元形态前缀（与 LESSON_HEAD_RE 同口径；返回匹配到的头部）。 */
function lessonPatternHead(cleaned: string): string | null {
  const m =
    /^(第\s*[0-9一二三四五六七八九十百]+\s*[課课章节節回話话]|lesson\s*\d+|unit\s*\d+|(?:復習|复习)\s*[A-Z]?)/i.exec(
      cleaned
    );
  return m ? (m[1] ?? m[0] ?? '') : null;
}

/**
 * CMD-02：无模型标题提升（纯函数，零 I/O，零模型）。
 * 把“像课标题的行”加上 `# ` 前缀，交给现有切课；已是 `#` 的行一字不动。
 * 提升规则（必须同时满足）：
 * 1. 行首即课单元形态（第N課/课/章…、Lesson/Unit N、復習A/复习A 含粘连）；
 * 2. 其后只许空白/页码（`第10課 118`、`復習A42` 可，`第1課 李さん…` 副标题不提升）；
 * 3. 全行 ≤ 30 字（cleanLine 已先滤掉点线目录/目次/页码行）。
 * 外部候选（map 阶段合并：markdown 抽取 + layout 版式 + TOC，只取课形态文本）
 * 仅放行“行文本等于候选文本”的等价行（另容忍 40 字截断：候选在封顶长度上
 * 恰为行前缀时同样放行，与 CMD-01 接地口径一致），不放宽课形态要求，
 * 不发明切课点。无候选时纯规则独立工作。
 */
export function promoteLessonHeadings(
  markdown: string,
  opts: { headings?: PageHeading[]; tocEntries?: TocEntry[] } = {}
): string {
  const evidence: string[] = [];
  const pushEvidence = (raw: unknown): void => {
    if (typeof raw !== 'string') return;
    const text = raw.trim().slice(0, 80);
    if (text && lessonPatternHead(text)) evidence.push(text);
  };
  if (Array.isArray(opts.headings)) {
    for (const h of opts.headings) {
      if (h && typeof h === 'object') pushEvidence((h as { text?: unknown }).text);
    }
  }
  if (Array.isArray(opts.tocEntries)) {
    for (const e of opts.tocEntries) {
      if (e && typeof e === 'object') pushEvidence((e as { label?: unknown }).label);
    }
  }
  let changed = false;
  const out = markdown.split('\n').map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return raw;
    const cleaned = cleanLine(trimmed);
    if (!cleaned) return raw;
    const head = lessonPatternHead(cleaned);
    if (!head) return raw;
    const rest = cleaned.slice(head.length).trim();
    if (rest === '' || /^\d{1,4}$/.test(rest)) {
      if (cleaned.length <= PROMOTE_TITLE_MAX) {
        changed = true;
        return `# ${cleaned}`;
      }
      return raw;
    }
    for (const ev of evidence) {
      if (cleaned === ev || (ev.length >= 40 && cleaned.startsWith(ev))) {
        changed = true;
        return `# ${cleaned}`;
      }
    }
    return raw;
  });
  return changed ? out.join('\n') : markdown;
}

/**
 * 行末中文括号 → 译文（MinerU 方言：`エアコンをつけます（开空调）`）。
 * 保守三条件（缺一不拆）：括号在行末；括号内含汉字；括号内无假名/拉丁
 * （`会社員（かいしゃいん）`是注音不是译文，绝不动）。
 */
export function splitInlineChinese(text: string): { ja: string; zh: string } {
  const m = /^(.*)[（(]\s*([^（）()]{2,200})\s*[）)]\s*[。！？]?\s*$/.exec(text.trim());
  if (!m) return { ja: text, zh: '' };
  const inner = (m[2] ?? '').trim();
  if (!/[一-鿿]/.test(inner)) return { ja: text, zh: '' };
  if (/[぀-ヿｦ-ﾟA-Za-z]/.test(inner)) return { ja: text, zh: '' };
  const ja = (m[1] ?? '').trim();
  if (ja.length < 1) return { ja: text, zh: '' };
  return { ja, zh: inner };
}

export function markdownToAst(
  markdown: string,
  options: {
    title?: string;
    bookId?: string;
    /**
     * CMD-01：用户已确认、已接地的结构分类（`kind === 'lesson'` 才另起一课）。
     * 缺席/空/无接地 lesson 时整体回退旧正则切课（逐课/逐句一致）。
     */
    classes?: StructureClass[];
  } = {}
): Result<TextbookAST, BusinessError> {
  if (!markdown || !markdown.trim()) {
    return err(new BusinessError('E_CONTENT_EMPTY', 'PDF 未提取到任何文字（可能是纯图片扫描页且 OCR 无输出）', 'VALIDATION'));
  }
  const capped = markdown.length > MAX_MARKDOWN_CHARS ? markdown.slice(0, MAX_MARKDOWN_CHARS) : markdown;
  const language = detectDocScript(capped);

  // 按课标题切课（MinerU/OCR 方言：只有课单元标题才另起一课；
  // 普通 # 标题如会話/目次/页眉是课内行，不切——否则一本书碎成几十片）。
  // 单元字覆盖 課/章/節/回/話（教材课、语法书章、小说回都值得另起一课）。
  // CMD-01：调用方给了已确认分类时，被标记的 `#` 标题同样起新节
  //（否则 marked-section 标题会漏成正文行）；课边界改由 classes 判定。
  const hasClasses = !!options.classes && options.classes.length > 0;
  // 预接地：供起节与归组共用同一 map（键为标题文本超集，归组只查实际存在的节）。
  // 生效总开关：必须有接地的 lesson 标记，否则起节/归组整体走旧行为（逐课一致）。
  const classOf: Map<string, StructureClass> | null = hasClasses
    ? groundClassesByTitle(
        collectHeadingTitles(capped).map((t) => ({ title: t, lines: [] })),
        options.classes ?? []
      )
    : null;
  const useClasses =
    !!classOf && [...classOf.values()].some((c) => c.kind === 'lesson');
  const groundedTitles = useClasses && classOf ? new Set(classOf.keys()) : null;
  const lines = capped.split('\n');
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  for (const l of lines) {
    const trimmed = l.trim();
    const h = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (h?.[2] && (LESSON_HEAD_RE.test(h[2]) || groundedTitles?.has(h[2].trim()) === true)) {
      const title = h[2].trim();
      // 页眉重复：与上一节同名（扫描版每页页眉都被抽成标题，页码不同也算同名）则合并
      const norm = (t: string): string => t.replace(/[\s…·.．]*\d{1,4}\s*$/, '').trim();
      if (current && sections.length > 0 && norm(sections[sections.length - 1]?.title ?? '') === norm(title)) {
        continue;
      }
      current = { title, lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { title: '', lines: [] };
      sections.push(current);
    }
    current.lines.push(l);
  }

  const bookId = options.bookId ?? newProvisionalBookId();
  const bookTitle = options.title ?? sections.find((s) => s.title)?.title ?? 'PDF 导入教材';

  // 按课归组（扫描版方言）：同一课的本文/练习/题目页标题各异
  // （`第1課` / `だい 円第1課`），按课序号 N 归并；復習X 自成单元；
  // 开篇无编号节（封面/CIP/前言）仅在全书无编号节时保留，否则丢弃。
  // CMD-01：给了已确认分类则课边界由 classes 判定，否则旧行为一字不动。
  const grouped =
    useClasses && classOf
      ? (groupSectionsByClasses(sections, classOf) ?? groupSectionsByLesson(sections))
      : groupSectionsByLesson(sections);

  const lessons: TextbookAST['lessons'] = [];
  for (const [si, group] of grouped.slice(0, MAX_LESSONS).entries()) {
    const lessonId = `${bookId}-l${si + 1}`;
    const dialogues: TextbookAST['lessons'][number]['dialogues'] = [];
    for (const section of group.sections) {
      for (const raw of section.lines) {
        if (dialogues.length >= MAX_DIALOGUES_PER_LESSON) break;
        const cleaned = cleanLine(raw);
        if (!cleaned) continue;
        for (const segment of splitSpeakerSegments(cleaned)) {
          if (dialogues.length >= MAX_DIALOGUES_PER_LESSON) break;
          const d = toDialogue(segment);
          if (!d) continue;
          dialogues.push({ speaker: d.speaker, japanese: d.japanese, chinese: d.chinese });
        }
      }
      if (dialogues.length >= MAX_DIALOGUES_PER_LESSON) break;
    }
    if (dialogues.length === 0) continue;
    lessons.push({
      id: lessonId,
      lessonNumber: si + 1,
      title: group.title || `第 ${si + 1} 课`,
      vocabularies: [],
      grammarPoints: [],
      dialogues,
      exercises: [],
    });
  }

  if (lessons.length === 0) {
    return err(
      new BusinessError('E_CONTENT_EMPTY', 'PDF 文字可提取，但未能切出课文句（可能全是目录/表格/页眉页脚）', 'VALIDATION')
    );
  }
  return ok({
    id: bookId,
    language,
    title: bookTitle,
    shortTitle: bookTitle.length > 12 ? bookTitle.slice(0, 12) : bookTitle,
    level: 'N5',
    publisher: 'PDF导入（自有资料）',
    lessons,
  });
}
