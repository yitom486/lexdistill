import { BusinessError } from '@study-studio/shared';
// zip 安全解包（炸弹/加密守卫）走 @study-studio/archive 唯一实现；只读内存，不写盘。
import { extractZip, normalizeZipEntryPaths } from '@study-studio/archive';

/**
 * EPUB 文本提取（clean-room，自研解析）。
 * E2b 起家在 content/src/document（前身 gateway modules/library/...；逻辑不变；
 * 走 document 子入口：用 Buffer 全局，禁入浏览器安全根表面）。
 * EPUB = zip：container.xml 定 OPF → manifest/spine 定章节顺序 → XHTML 脱衣成 markdown。
 * 只取正文（跳封面/NCX/样式/字体/图片）；章节上限 200，总字符上限 2MB（后级 markdownToAst 另有上限）。
 */

const MAX_CHAPTERS = 200;
const MAX_TOTAL_CHARS = 2 * 1024 * 1024;

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m?.[1] ?? undefined;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : '';
    });
}

/** 单章 XHTML → markdown（标题/段落/换行保留，其余脱衣）。 */
export function xhtmlToMarkdown(xhtml: string): string {  let html = xhtml.replace(/<head[\s\S]*?<\/head>/gi, '');
  html = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const hashes = '#'.repeat(Math.min(6, Number(level) || 1));
    return `\n\n${hashes} ${inner}\n\n`;
  });
  html = html.replace(/<\/(p|div|section|article|li|tr|h\d)>/gi, '\n\n');
  html = html.replace(/<[^>]+>/g, '');
  const lines = decodeEntities(html)
    .split('\n')
    .map((line) => line.replace(/[ \t\u3000]+/g, ' ').trim())
    .filter((line) => line.length > 0);
  return lines.join('\n');
}

function resolveRelative(baseDir: string, href: string): string {
  const hashIndex = href.indexOf('#');
  const fragment = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const path = (hashIndex >= 0 ? href.slice(0, hashIndex) : href).split('?')[0] ?? '';
  if (!path || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return href;
  const parts: string[] = [...baseDir.split('/').filter((p) => p.length > 0), ...path.split('/')];
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/') + fragment;
}

/** 目录项（扁平带层级；children 保留给未来导航 UI，现阶段只用扁平）。 */
export interface EpubTocItem {
  label: string;
  href: string;
  level: number;
}

/** 纯目录页判定（nav/toc 文件本身不进正文，避免链接表污染课文）。 */
function isTocLikeFile(path: string): boolean {
  const base = (path.split('/').pop() ?? path).toLowerCase();
  return /^(nav|toc|contents|cover)([._-]|$)/i.test(base);
}

function hrefBase(href: string): string {
  return href.split('#')[0] ?? href;
}

function innerText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

/** NCX 目录（EPUB2）：navLabel+content 成对出现，层级按 navPoint 嵌套计数。 */
export function parseNcxToc(ncx: string, opfDir: string): EpubTocItem[] {
  const items: EpubTocItem[] = [];
  const pairPattern = /<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content[^>]*src="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = pairPattern.exec(ncx)) !== null) {
    const index = m.index;
    const before = ncx.slice(0, index);
    const opens = (before.match(/<navPoint\b/gi) ?? []).length;
    const closes = (before.match(/<\/navPoint>/gi) ?? []).length;
    const label = innerText(m[1] ?? '');
    const href = m[2] ?? '';
    if (!label || !href) continue;
    items.push({ label, href: resolveRelative(opfDir, href), level: Math.max(0, opens - closes - 1) });
  }
  return items;
}

/** EPUB3 nav 目录（层级不计，单元去重只用首项；够课程切分用）。 */
export function parseNavToc(navXhtml: string, navPath: string): EpubTocItem[] {
  const opfDir = navPath.includes('/') ? navPath.slice(0, navPath.lastIndexOf('/')) : '';
  const block = navXhtml.match(/<nav\b[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/i)?.[1];
  if (!block) return [];
  const items: EpubTocItem[] = [];
  for (const m of block.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = innerText(m[2] ?? '');
    if (!label || !m[1]) continue;
    items.push({ label, href: resolveRelative(opfDir, m[1]), level: 0 });
  }
  return items;
}

/** 每 spine 文件取首个目录项（无碎片优先、层级浅优先）；纯目录页跳过。 */
function buildUnitLabels(toc: EpubTocItem[]): Map<string, string> {
  const units = new Map<string, string>();
  const ranked = [...toc]
    .filter((t) => !isTocLikeFile(hrefBase(t.href)))
    .sort((a, b) => {
      const aFrag = a.href.includes('#') ? 1 : 0;
      const bFrag = b.href.includes('#') ? 1 : 0;
      if (aFrag !== bFrag) return aFrag - bFrag;
      return a.level - b.level;
    });
  for (const item of ranked) {
    const base = hrefBase(item.href);
    if (!units.has(base)) units.set(base, item.label);
  }
  return units;
}

/** zip 条目 → EPUB 正文 markdown（抛中文 BusinessError）。 */
export function extractEpubText(
  bytes: Uint8Array,
  filename: string
): { title: string; markdown: string; units: string[] } {
  void filename;
  let entries;
  try {
    entries = extractZip(bytes);
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError('E_INVALID_INPUT', '不是有效的 EPUB 文件（zip 解析失败）', 'VALIDATION', false);
  }
  const byPath = new Map(normalizeZipEntryPaths(entries).map((e) => [e.path, e.data]));
  const containerRaw = byPath.get('META-INF/container.xml');
  if (!containerRaw) {
    throw new BusinessError('E_INVALID_INPUT', 'EPUB 缺少 container.xml', 'VALIDATION', false);
  }
  const container = Buffer.from(containerRaw).toString('utf8');
  const rootfile = container.match(/<rootfile\b[^>]*full-path="([^"]+)"/i)?.[1];
  if (!rootfile) {
    throw new BusinessError('E_INVALID_INPUT', 'EPUB 未声明 OPF 入口', 'VALIDATION', false);
  }
  const opfRaw = byPath.get(rootfile);
  if (!opfRaw) {
    throw new BusinessError('E_INVALID_INPUT', 'EPUB 的 OPF 文件缺失', 'VALIDATION', false);
  }
  const opf = Buffer.from(opfRaw).toString('utf8');
  const opfDir = rootfile.includes('/') ? rootfile.slice(0, rootfile.lastIndexOf('/')) : '';
  const title =
    opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() || '未命名电子书';
  // manifest 全量（spine 定位需要非正文条目 href）
  const hrefById = new Map<string, string>();
  let ncxPath: string | undefined;
  let navPath: string | undefined;
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0] ?? '';
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (!id || !href) continue;
    const resolved = resolveRelative(opfDir, decodeEntities(href));
    hrefById.set(id, resolved);
    const mediaType = (attr(tag, 'media-type') ?? '').toLowerCase();
    if (mediaType.includes('dtbncx')) ncxPath = resolved;
    if (/\bnav\b/.test(attr(tag, 'properties') ?? '')) navPath = resolved;
  }
  // 目录：NCX 优先，EPUB3 nav 回退；都没有则靠章内标题
  let toc: EpubTocItem[] = [];
  if (ncxPath) {
    const ncxRaw = byPath.get(ncxPath);
    if (ncxRaw) toc = parseNcxToc(Buffer.from(ncxRaw).toString('utf8'), opfDir);
  }
  if (toc.length === 0 && navPath) {
    const navRaw = byPath.get(navPath);
    if (navRaw) toc = parseNavToc(Buffer.from(navRaw).toString('utf8'), navPath);
  }
  const unitLabels = buildUnitLabels(toc);
  // spine 顺序即阅读顺序；非线性（封面）与纯目录页跳过
  const spine: Array<{ href: string; linear: boolean }> = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const tag = m[0] ?? '';
    const idref = attr(tag, 'idref');
    if (!idref) continue;
    const href = hrefById.get(idref);
    if (!href) continue;
    const linear = (attr(tag, 'linear') ?? 'yes').toLowerCase() !== 'no';
    spine.push({ href, linear });
  }
  if (spine.length === 0) {
    throw new BusinessError('E_INVALID_INPUT', 'EPUB 没有可读章节', 'VALIDATION', false);
  }
  const chapters: string[] = [];
  const unitNames: string[] = [];
  let total = 0;
  for (const item of spine.slice(0, MAX_CHAPTERS)) {
    if (!item.linear) continue;
    if (isTocLikeFile(item.href)) continue;
    const data = byPath.get(item.href);
    if (!data) continue;
    let text = xhtmlToMarkdown(Buffer.from(data).toString('utf8'));
    if (!text) continue;
    const label = unitLabels.get(hrefBase(item.href));
    if (label && !unitNames.includes(label)) unitNames.push(label);
    // 有目录标签且章内无一级标题时，用目录标签起课（供 markdownToAst 切课）
    if (label && !/^#\s+.+$/m.test(text)) {
      text = `# ${label}\n\n${text}`;
    }
    total += text.length;
    if (total > MAX_TOTAL_CHARS) break;
    chapters.push(text);
  }
  if (chapters.length === 0) {
    throw new BusinessError('E_CONTENT_EMPTY', 'EPUB 章节均为空', 'VALIDATION', false);
  }
  return { title, markdown: `# ${title}\n\n${chapters.join('\n\n')}`, units: unitNames };
}
