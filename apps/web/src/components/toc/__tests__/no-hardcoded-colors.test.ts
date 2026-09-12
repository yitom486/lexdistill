import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arbitraryColorUtility, dynamicColorConcat, styleContextColor, utilityColorLiteral } from '../../../lib/color-gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', '..', '..');
const CSS_PATH = join(SRC_ROOT, 'index.css');

/**
 * P3.5-FIX 全仓颜色门禁（apps/web/src 全覆盖，无白名单文件）。
 *
 * 规则（匹配器见 lib/color-gate.ts，可单测）：
 * - TS/TSX（非测试）禁止直接 Tailwind 色值工具类（含 white/black/stone/gray/amber/
 *   rose/emerald 等全色板，light 与 dark:/hover: 等 variant 一视同仁；
 *   opacity 含小数与 bracket 形式）；
 * - 禁止 arbitrary 颜色（bg-[#...]/text-[rgb(...)] 等，可带 /opacity；
 *   var(--toc-*) 等语义引用除外）；
 * - 禁止 className / inline style 上下文中的 hex/rgb（JS 纯逻辑颜色如 confetti
 *   调色不在此限，但不得出现在 class/style 上下文）；
 * - transparent / currentColor / inherit 永远放行；
 * - 所有颜色只许引用 index.css 语义变量（:root 与 .dark 双块定义，@theme 导出工具类）。
 */

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
      for (const hit of [...utilityColorLiteral(code), ...arbitraryColorUtility(code), ...styleContextColor(code), ...dynamicColorConcat(code)]) {
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
