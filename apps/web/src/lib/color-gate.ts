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

/** arbitrary 颜色工具类（[#hex]/[rgb(...)]，可带 /opacity；尺寸类放行）。 */
export function arbitraryColorUtility(source: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(`(?:${UTILITY})-\\[([^\\]]+)\\]${OPACITY}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const inner = (m[1] ?? '').trim();
    // 尺寸/布局类 arbitrary（text-[10px] 等）不是颜色，放行
    if (!/^#/.test(inner) && !/^rgba?\(/.test(inner) && !/^hsla?\(/.test(inner)) continue;
    if (/^var\(--(toc|background|foreground|muted|border|primary|secondary|accent|card|popover|destructive|ring|input|chart)-/.test(inner)) continue;
    if (/^var\(--toc-/.test(inner)) continue;
    if (/^(transparent|currentColor|inherit)$/.test(inner)) continue;
    hits.push(m[0]);
  }
  return hits;
}

/** className / inline style 上下文中的 hex/rgb。 */
export function styleContextColor(source: string): string[] {
  const hits: string[] = [];
  // className="..." 双引号字面量内的 hex
  for (const m of source.matchAll(/className="([^"]*)"/g)) {
    const inner = m[1] ?? '';
    for (const h of inner.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) hits.push(`className hex ${h[0]}`);
    for (const h of inner.matchAll(/\brgba?\(/g)) hits.push(`className rgb ${h[0]}`);
  }
  // style={{ ... }} 单层对象内的 hex（多行，非贪婪到首个 }}）
  for (const m of source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    const inner = m[1] ?? '';
    for (const h of inner.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) hits.push(`style hex ${h[0]}`);
    for (const h of inner.matchAll(/\brgba?\(/g)) hits.push(`style rgb ${h[0]}`);
  }
  return hits;
}
