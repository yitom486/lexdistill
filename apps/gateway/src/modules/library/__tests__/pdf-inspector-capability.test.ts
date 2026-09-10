import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PDF_INSPECTOR_VERSION } from '../application/pdf-import/pdf-artifacts.js';
import { testRuntimeDir } from './pdf-test-runtime.js';

/**
 * CMD-P1 能力取证：pinned pdf-inspector 是否真实支持读取 PDF embedded outline。
 *
 * 方法（非 mock）：直接 require 测试运行时里的真实构件
 * `@firecrawl/pdf-inspector`（与 E2E 同一 artifact），检查：
 * 1. 包版本 == 代码 pin（pdf-artifacts.ts 的 PDF_INSPECTOR_VERSION）；
 * 2. 可调用 export 列表（函数名）；
 * 3. 有无 outline/bookmark/toc/destination 类 API。
 *
 * 结论（2026-09-10 实测，见 Evidence）：1.18.0 无任何 outline API → P1 BLOCKED。
 * index.js / index.d.ts / README.md 全文零命中；napi 二进制里仅错误文案字符串
 *（`invalid document outline` / `PDF document does not have an outline` /
 * `InvalidOutline` / `NoOutline` 枚举），无可调用导出。
 * 若未来升级 pin 后出现 outline 导出，本文件的“无 outline”断言会变红，
 * 即为 P1 重启信号（届时再按计划实施 A–C）。
 */
function loadRealInspectorModule(): Record<string, unknown> {
  const dir = testRuntimeDir();
  const req = createRequire(path.join(dir, 'index.js'));
  return req(path.join(dir, 'node_modules', '@firecrawl', 'pdf-inspector')) as Record<string, unknown>;
}

function readRealInspectorVersion(): string {
  const dir = testRuntimeDir();
  const req = createRequire(path.join(dir, 'index.js'));
  const pkg = req(path.join(dir, 'node_modules', '@firecrawl', 'pdf-inspector', 'package.json')) as {
    version?: unknown;
  };
  if (typeof pkg.version !== 'string') throw new Error('real pdf-inspector package.json 缺 version');
  return pkg.version;
}

describe('P1 capability forensics（真实构件，非 mock）', () => {
  it('真实构件版本 == 代码 pin', () => {
    expect(readRealInspectorVersion()).toBe(PDF_INSPECTOR_VERSION);
  });

  it('可调用 export 非空，且无 outline/bookmark/toc/destination API', () => {
    const mod = loadRealInspectorModule();
    const fnNames = Object.keys(mod)
      .filter((k) => typeof mod[k] === 'function')
      .sort();
    expect(fnNames.length).toBeGreaterThan(0);
    expect(fnNames.filter((n) => /outline|bookmark|\btoc\b|destination/i.test(n))).toEqual([]);
  });

  it('记录当前真实可用 surface（P1 依赖的四个函数存在）', () => {
    const mod = loadRealInspectorModule();
    for (const name of ['processPdf', 'processPdfWithOcr', 'extractTextWithPositions', 'extractStructureElements']) {
      expect(typeof mod[name]).toBe('function');
    }
  });
});
