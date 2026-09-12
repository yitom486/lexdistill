import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', '..', '..');
const CSS_PATH = join(SRC_ROOT, 'index.css');

/**
 * CMD-LINGUA-P3.5 颜色门禁（静态，违反即失败）。
 *
 * 规则（任务验收项）：
 * - 受检文件（目录结果新 UI）的 TSX 禁止直接 Tailwind 色值、hex/rgb/hsl、
 *   arbitrary color；所有颜色只许引用 CSS 语义变量；
 * - 亮色/暗色必须同时定义（:root 与 .dark 双块）。
 *
 * 口径说明（渐进式收敛；旧文件不在此表，有意为之）：
 * - 全仓存量（TocReviewPanel/ui/* 等）仍含 stone/amber 字面量，一次性迁移
 *   回归风险过高；本门禁是棘轮——新文件只许进表，不许出表；旧文件迁移逐项跟进。
 */
const GATED_FILES = [
  'components/toc/TocResultDialog.tsx',
  'components/toc/TocReviewDialogs.tsx',
] as const;

const PALETTE =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITY = 'bg|text|border|ring|divide|placeholder|stroke|fill|from|via|to|outline|decoration|accent|caret|shadow';

function utilityColorLiteral(source: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(`(?:^|["'\\s:(\`])(?:${UTILITY})-(?:${PALETTE})(?:-\\d{3})?(?:\\/\\d+)?(?=["'\\s\`])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) hits.push(m[0].trim());
  return hits;
}

function rawColorLiteral(source: string): string[] {
  const hits: string[] = [];
  const stripped = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .join('\n');
  for (const re of [/#[0-9a-fA-F]{3,8}\b/g, /\brgba?\(/g, /\bhsla?\(/g, /\[[^\]\n]*#[^\]\n]*\]/g]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped))) hits.push(m[0]);
  }
  return hits;
}

function arbitraryColorUtility(source: string): string[] {
  const hits: string[] = [];
  const re = /(?:bg|text|border|ring|from|via|to)-\[var\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) hits.push(m[0]);
  return hits;
}

function networkImport(source: string): string[] {
  const hits: string[] = [];
  const re = /from\s+['"]((\.\.\/)*queries\/[^'"]+|@tanstack\/react-query)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) hits.push(m[1]!);
  return hits;
}

function fetchCall(source: string): string[] {
  const hits: string[] = [];
  const stripped = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .join('\n');
  const re = /\bfetch\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) hits.push('fetch(');
  return hits;
}

describe('P3.5 颜色与零写静态门禁', () => {
  it('受检文件无色值字面量/hex/arbitrary color/网络调用', () => {
    const problems: string[] = [];
    for (const rel of GATED_FILES) {
      const path = join(SRC_ROOT, rel);
      const text = readFileSync(path, 'utf8');
      for (const hit of utilityColorLiteral(text)) problems.push(`${rel}: 色值工具类 ${hit}`);
      for (const hit of rawColorLiteral(text)) problems.push(`${rel}: 原始色值 ${hit}`);
      for (const hit of arbitraryColorUtility(text)) problems.push(`${rel}: arbitrary 颜色 ${hit}（请用 @theme 语义工具类）`);
      for (const hit of networkImport(text)) problems.push(`${rel}: 网络 import ${hit}（结果 Dialog 禁止）`);
      for (const hit of fetchCall(text)) problems.push(`${rel}: 直接 fetch 调用（结果 Dialog 禁止）`);
    }
    expect(problems).toEqual([]);
  });

  it('语义变量在 :root 与 .dark 双块定义；工具类被 @theme 导出', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const used = new Set<string>();
    for (const rel of GATED_FILES) {
      const text = readFileSync(join(SRC_ROOT, rel), 'utf8');
      const re = /(?:bg|text|border)-toc-([a-z-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) used.add(`toc-${m[1]}`);
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
