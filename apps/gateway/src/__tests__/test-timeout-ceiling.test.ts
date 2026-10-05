import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 测试超时天花板锁（用户铁律）：全仓任何单测超时超过 60 秒即视为失败，
 * 不允许以调大超时来掩盖 hanging。显式超时参数一律不得超过 60000ms；
 * 未显式声明的走 bun 默认 5s，只会更严。
 */
const ROOTS = ['apps', 'packages'];
const TIMEOUT_ARG = /},\s*(\d+)\s*\)\s*;?\s*$/;
const TIMEOUT_OPTION = /timeout\s*:\s*(\d+)/;

async function collectTestFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target' || entry.name === '.git' || entry.name === '.fingerprint') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectTestFiles(full, out);
    else if (/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
}

describe('测试超时天花板 60s', () => {
  it('任何测试文件的显式超时都不超过 60000ms', async () => {
    const files: string[] = [];
    for (const root of ROOTS) await collectTestFiles(root, files);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const text = await Bun.file(file).text();
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        if (line.includes('firstResponseTimeoutMs') || line.includes('stallTimeoutMs') || line.includes('pollMs')) return;
        const arg = TIMEOUT_ARG.exec(line.trim());
        if (arg && Number(arg[1]) > 60000) violations.push(`${file}:${index + 1} 超时 ${arg[1]}ms`);
        const opt = TIMEOUT_OPTION.exec(line);
        if (opt && Number(opt[1]) > 60000 && !line.includes('TimeoutMs')) violations.push(`${file}:${index + 1} 超时 ${opt[1]}ms`);
      });
    }
    expect(violations).toEqual([]);
  });
});
