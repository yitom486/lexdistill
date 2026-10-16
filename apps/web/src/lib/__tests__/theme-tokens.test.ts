import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(HERE, '..', '..', 'index.css');

/**
 * UI-R01 基础 token 门禁（结构不断言具体色值，只锁契约）：
 * 1. @theme 导出的每个 color/shadow token 都必须在 :root 与 .dark 双块有定义，
 *    否则某一主题下工具类取不到值；
 * 2. @theme 必须声明 sans/serif/mono 三个字体角色且指向 Geist/Newsreader/Geist Mono，
 *    否则 font-* 工具类回落到 Tailwind 系统默认栈（UI-R01 根因）；
 * 3. 亮色弱化文字 token 在纸面底上的真实对比度至少 4.5:1（oklch 解析 + 实际计算，
 *    不是复述 CSS 文本）。
 */

function blockOf(css: string, selector: string): string {
  const re = new RegExp(`${selector}\\s*\\{([\\s\\n\\S]*?)\\n\\}`, 'gm');
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) parts.push(m[1] ?? '');
  return parts.join('\n');
}

function oklchToSrgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const H = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (v: number): number => {
    const c = Math.min(1, Math.max(0, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return [enc(r), enc(g), enc(bl)];
}

function luminance(rgb: [number, number, number]): number {
  const f = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function tokenColor(block: string, token: string): [number, number, number] {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  if (!value) throw new Error(`Missing ${token}`);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const code = hex[1]!;
    return [0, 2, 4].map(offset => Number.parseInt(code.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  }
  const lch = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  if (lch) return oklchToSrgb(Number(lch[1]) / 100, Number(lch[2]), Number(lch[3]));
  throw new Error(`Unsupported color value for ${token}: ${value}`);
}

describe('UI-R01 theme token 契约', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const rootBlock = blockOf(css, ':root');
  const darkBlock = blockOf(css, '\\.dark');

  it('@theme 导出的 color/shadow token 在亮暗双块均有定义', () => {
    const missing: string[] = [];
    for (const m of css.matchAll(/--(?:color|shadow)-([a-z][a-z0-9-]*):\s*var\(--([a-z][a-z0-9-]*)\)/g)) {
      const v = m[2] ?? '';
      if (!rootBlock.includes(`--${v}:`)) missing.push(`:root 缺 --${v}`);
      if (!darkBlock.includes(`--${v}:`)) missing.push(`.dark 缺 --${v}`);
    }
    expect(missing).toEqual([]);
  });

  it('sans/serif/mono 字体角色指向设计字体而非系统默认', () => {
    const themeBlock = blockOf(css, '@theme');
    const sans = /--font-sans:\s*([^;]+);/.exec(themeBlock)?.[1] ?? '';
    const serif = /--font-serif:\s*([^;]+);/.exec(themeBlock)?.[1] ?? '';
    const mono = /--font-mono:\s*([^;]+);/.exec(themeBlock)?.[1] ?? '';
    expect(sans, 'sans 缺 Geist').toContain('Geist');
    expect(serif, 'serif 缺 Newsreader').toContain('Newsreader');
    expect(mono, 'mono 缺 Geist Mono').toContain('Geist Mono');
    // 首选字体必须是设计字体（回退栈里含系统字体是正常的，不算 Tailwind 默认）
    for (const [name, stack, first] of [
      ['sans', sans, 'Geist'],
      ['serif', serif, 'Newsreader'],
      ['mono', mono, 'Geist Mono'],
    ] as const) {
      expect(
        stack.trim().replace(/^['"]/, '').startsWith(first),
        `${name} 首选字体不是 ${first}`
      ).toBe(true);
    }
  });

  it('亮色弱化文字在纸面底对比度至少 4.5:1', () => {
    const paper = tokenColor(rootBlock, '--paper');
    for (const token of ['--ink-stone-400', '--ink-hint']) {
      const fg = tokenColor(rootBlock, token);
      const ratio = contrastRatio(fg, paper);
      expect(ratio, `${token} 对比度 ${ratio.toFixed(2)} < 4.5`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
