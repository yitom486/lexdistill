import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', '..', '..');
const CSS_PATH = join(SRC_ROOT, 'index.css');

/**
 * P3.5-FIX 全仓颜色门禁（apps/web/src 全覆盖，无白名单文件）。
 *
 * 规则：
 * - TSX（非测试）禁止直接 Tailwind 色值工具类（含 white/black/stone/gray/amber/
 *   rose/emerald 等全色板，light 与 dark: 一视同仁）；
 * - 禁止 arbitrary 颜色（bg-[#...]/text-[rgb(...)] 等；var(--toc-*) 等语义引用除外）；
 * - 禁止 className / inline style 上下文中的 hex/rgb（JS 纯逻辑颜色如 confetti
 *   调色不在此限，但不得出现在 class/style 上下文）；
 * - transparent / currentColor / inherit 永远放行；
 * - 所有颜色只许引用 index.css 语义变量（:root 与 .dark 双块定义，@theme 导出工具类）。
 */

const PALETTE =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITY =
  'bg|text|border|ring|ring-offset|shadow|divide|placeholder|stroke|fill|from|via|to|outline|decoration|accent|caret';

function listSrc(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...listSrc(path));
      continue;
    }
    if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !name.endsWith('.test.tsx') && !name.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

function utilityColorLiteral(source: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(`(?:^|["'\\s:(\`])(?:${UTILITY})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?(?=["'\\s\`])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const hit = m[0].trim();
    if (/-toc-/.test(hit)) continue;
    if (/(transparent|current|inherit)/.test(hit)) continue;
    hits.push(hit);
  }
  return hits;
}

function arbitraryColorUtility(source: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(`(?:${UTILITY})-\\[([^\\]]+)\\]`, 'g');
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

function styleContextColor(source: string): string[] {
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

describe('P3.5-FIX 全仓颜色门禁', () => {
  it('apps/web/src 无直接色值工具类/arbitrary颜色/style色值', () => {
    const problems: string[] = [];
    const files = listSrc(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const rel = path.slice(SRC_ROOT.length + 1).replace(/\\/g, '/');
      const text = readFileSync(path, 'utf8');
      const code = text
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          return !trimmed.startsWith('*') && !trimmed.startsWith('//');
        })
        .join('\n');
      const seen = new Set<string>();
      for (const hit of [...utilityColorLiteral(code), ...arbitraryColorUtility(code), ...styleContextColor(code)]) {
        if (seen.has(hit)) continue;
        seen.add(hit);
        problems.push(`${rel}: ${hit}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('语义变量在 :root 与 .dark 双块定义；工具类被 @theme 导出', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const used = new Set<string>();
    for (const path of listSrc(SRC_ROOT)) {
      const text = readFileSync(path, 'utf8');
      const re = /(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|placeholder|accent|caret|shadow)-([a-z][a-z0-9-]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const name = m[1] ?? '';
        if (name.startsWith('toc-')) used.add(name);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const blockOf = (selector: string): string => {
      const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'gm');
      const parts: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) parts.push(m[1] ?? '');
      return parts.join('\n');
    };
    const rootBlock = blockOf(':root');
    const darkBlock = blockOf('\\.dark');
    expect(rootBlock.length).toBeGreaterThan(0);
    expect(darkBlock.length).toBeGreaterThan(0);
    for (const name of used) {
      expect(rootBlock, `:root 缺 ${name}`).toContain(`--${name}:`);
      expect(darkBlock, `.dark 缺 ${name}`).toContain(`--${name}:`);
      expect(css, `@theme 缺 --color-${name}`).toContain(`--color-${name}: var(--${name})`);
    }
  });
});
