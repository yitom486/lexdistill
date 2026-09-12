/**
 * P3.5-FIX2 颜色门禁匹配器（纯函数，可单测；门禁测试与 codemod 共用口径）。
 *
 * 识别范围（逐步收紧，历史教训）：
 * - 直接色值工具类：含小数 opacity（/0.04）、bracket opacity（/[0.04]）；
 * - arbitrary 颜色：[#hex]（可带 /opacity）、[rgb(...)]；
 * - variant 前缀（hover:/dark:/data-[...]: 等）一律穿透识别；
 * - transparent / currentColor / inherit 永远放行；
 * - 语义 token（-toc- / var(--*)）放行。
 */

const PALETTE =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITY =
  'bg|text|border|ring|ring-offset|shadow|divide|placeholder|stroke|fill|from|via|to|outline|decoration|accent|caret';

const OPACITY = String.raw`(?:\/(?:\d+(?:\.\d+)?|\[[^\]]+\]))?`;
const COLOR_VALUE = `(?:${PALETTE})(?:-\\d{2,3})?${OPACITY}`;

/** 常见 CSS 命名色（transparent/currentColor/inherit 永远放行，不在此表）。 */
const NAMED_COLORS =
  'red|blue|green|white|black|yellow|orange|purple|pink|brown|cyan|magenta|lime|teal|navy|maroon|olive|silver|gray|grey|aqua|fuchsia|violet|indigo|gold|salmon|coral|khaki|plum|tomato';

/** 函数色：rgb/hsl/oklch（含 alpha 变体）。 */
const FN_COLOR = String.raw`(?:rgba?|hsla?|oklch|oklab)\(`;

/** 直接色值工具类（含 variant 前缀穿透、小数/bracket opacity）。 */
export function utilityColorLiteral(source: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(`(?:^|["'\\s:(\\\`])(?:${UTILITY})-${COLOR_VALUE}(?=["'\\s\\\`}!]|$)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const hit = m[0].replace(/^["'\s:(`]+/, '');
    if (/-toc-/.test(hit)) continue;
    if (/(transparent|current|inherit)/.test(hit)) continue;
    hits.push(hit);
  }
  return hits;
}

/** arbitrary 颜色工具类（[#hex]/[rgb(...)]/[named]，可带 /opacity；尺寸类放行）。 */
export function arbitraryColorUtility(source: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(`(?:${UTILITY})-\\[([^\\]]+)\\]${OPACITY}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const inner = (m[1] ?? '').trim();
    // 尺寸/布局类 arbitrary（text-[10px] 等）不是颜色，放行
    if (!/^#/.test(inner) && !new RegExp(`^${FN_COLOR}`).test(inner) && !new RegExp(`^(${NAMED_COLORS})$`).test(inner)) continue;
    if (/^var\(--(toc|background|foreground|muted|border|primary|secondary|accent|card|popover|destructive|ring|input|chart)-/.test(inner)) continue;
    if (/^var\(--toc-/.test(inner)) continue;
    if (/^(transparent|currentColor|inherit)$/.test(inner)) continue;
    hits.push(m[0]);
  }
  return hits;
}

/** className / inline style 上下文中的 hex、函数色与命名色。 */
export function styleContextColor(source: string): string[] {
  const hits: string[] = [];
  const fnRe = new RegExp(`\\b${FN_COLOR}`, 'g');
  const namedRe = new RegExp(`['"]\\s*(${NAMED_COLORS})\\s*['"]`, 'g');
  // className="..." 双引号字面量内的颜色
  for (const m of source.matchAll(/className="([^"]*)"/g)) {
    const inner = m[1] ?? '';
    for (const h of inner.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) hits.push(`className hex ${h[0]}`);
    for (const h of inner.matchAll(fnRe)) hits.push(`className fn ${h[0]}`);
    for (const h of inner.matchAll(namedRe)) hits.push(`className named ${h[1]}`);
  }
  // style={{ ... }} 单层对象内的颜色（多行，非贪婪到首个 }}）
  for (const m of source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    const inner = m[1] ?? '';
    for (const h of inner.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) hits.push(`style hex ${h[0]}`);
    for (const h of inner.matchAll(fnRe)) hits.push(`style fn ${h[0]}`);
    for (const h of inner.matchAll(namedRe)) hits.push(`style named ${h[1]}`);
  }
  return hits;
}

/**
 * 可静态识别的动态 class 拼接（P3.5-FIX2-A4）。
 * 颜色工具前缀后直接跟模板插值（`bg-${tone}`）或引号包裹的前缀参与字符串拼接
 * （`'text-' + x），运行时值不可审计，一律视为违规；正确做法是查表映射到
 * 完整语义 class（如 { primary: 'bg-accent-ink' }[intent]）。
 * 注意：`text-${size}` 这类布局插值同样会被拦截——尺寸也请查表，禁止动态拼 class。
 */
export function dynamicColorConcat(source: string): string[] {
  const hits: string[] = [];
  const interpRe = new RegExp(`(?:${UTILITY})-\\$\\{`, 'g');
  let m: RegExpExecArray | null;
  while ((m = interpRe.exec(source))) hits.push(`dynamic interpolation ${m[0]}}`);
  const concatRe = new RegExp(`['"\`]\\s*(?:${UTILITY})-['"\`\\s]*\\+`, 'g');
  while ((m = concatRe.exec(source))) hits.push(`dynamic concat ${m[0].slice(0, 24)}`);
  return hits;
}
