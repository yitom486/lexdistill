import { ok, err, BusinessError, type Result } from '@study-studio/shared';
import type { TextbookAST } from '@study-studio/protocol';

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
  options: { title?: string; bookId?: string } = {}
): Result<TextbookAST, BusinessError> {
  if (!markdown || !markdown.trim()) {
    return err(new BusinessError('E_CONTENT_EMPTY', 'PDF 未提取到任何文字（可能是纯图片扫描页且 OCR 无输出）', 'VALIDATION'));
  }
  const capped = markdown.length > MAX_MARKDOWN_CHARS ? markdown.slice(0, MAX_MARKDOWN_CHARS) : markdown;
  const language = detectDocScript(capped);

  // 按课标题切课（MinerU/OCR 方言：只有课单元标题才另起一课；
  // 普通 # 标题如会話/目次/页眉是课内行，不切——否则一本书碎成几十片）。
  // 单元字覆盖 課/章/節/回/話（教材课、语法书章、小说回都值得另起一课）。
  const LESSON_HEAD = /第\s*[0-9一二三四五六七八九十百]+\s*[課课章节節回話话]|lesson\s*\d+|unit\s*\d+|(?:復習|复习)\s*[A-Z]?/i;
  const lines = capped.split('\n');
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  for (const l of lines) {
    const trimmed = l.trim();
    const h = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (h?.[2] && LESSON_HEAD.test(h[2])) {
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

  const bookId = options.bookId ?? `pdf-${Date.now().toString(36)}`;
  const bookTitle = options.title ?? sections.find((s) => s.title)?.title ?? 'PDF 导入教材';

  // 按课归组（扫描版方言）：同一课的本文/练习/题目页标题各异
  // （`第1課` / `だい 円第1課`），按课序号 N 归并；復習X 自成单元；
  // 开篇无编号节（封面/CIP/前言）仅在全书无编号节时保留，否则丢弃。
  const grouped = groupSectionsByLesson(sections);

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
