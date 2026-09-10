import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PDF_INSPECTOR_VERSION } from '../application/pdf-import/pdf-artifacts.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime, testRuntimeDir } from './pdf-test-runtime.js';

/**
 * CMD-LINGUA-P1A 能力取证：pinned fork runtime 是否真实提供 `extractEmbeddedOutline`。
 *
 * 方法（非 mock）：直接 require 测试运行时里的真实构件
 * `@firecrawl/pdf-inspector`（与 E2E 同一 artifact），并用 ensurePdfTestRuntime
 * 拿到的真实 inspector 在内存 synthetic PDF 上实际调用。
 * P1 前身结论（1.18.0 上游包）：无 outline API → 曾 BLOCKED；
 * 本文件锁定新 pin 1.18.2-inkdown.1 的存在性与可调用性。
 */

pinProcessToTestRuntime();
await ensurePdfTestRuntime();

function realInspectorPackageDir(): string {
  return path.join(testRuntimeDir(), 'node_modules', '@firecrawl', 'pdf-inspector');
}

function buildPdf(objects: string[]): Uint8Array {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xrefAt = Buffer.byteLength(parts.join(''));
  const n = objects.length + 1;
  parts.push(`xref\n0 ${n}\n`);
  parts.push('0000000000 65535 f \n');
  for (let i = 1; i < n; i++) {
    parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return new Uint8Array(Buffer.from(parts.join(''), 'latin1'));
}

/** 内存 synthetic：2 页 + 3 条目（2 可解析 + 1 外部 URI 不可解析），无私人内容。 */
function syntheticOutlinedPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Outlines 2 0 R /Pages 3 0 R >>',
    '<< /Type /Outlines /First 4 0 R /Last 6 0 R /Count 3 >>',
    '<< /Type /Pages /Kids [7 0 R 8 0 R] /Count 2 >>',
    '<< /Title (Alpha) /Parent 2 0 R /Next 5 0 R /Dest [7 0 R /Fit] >>',
    '<< /Title (Beta) /Parent 2 0 R /Prev 4 0 R /Next 6 0 R /Dest [8 0 R /Fit] >>',
    '<< /Title (Gamma Link) /Parent 2 0 R /Prev 5 0 R /A << /S /URI /URI (https://example.com) >> >>',
    '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] >>',
    '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] >>',
  ]);
}

function syntheticPlainPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ]);
}

describe('P1A capability forensics（真实 fork 构件，非 mock）', () => {
  it('真实构件版本 == 代码 pin（1.18.2-inkdown.1）', () => {
    const req = createRequire(path.join(testRuntimeDir(), 'index.js'));
    const pkg = req(path.join(realInspectorPackageDir(), 'package.json')) as { version?: unknown };
    expect(pkg.version).toBe(PDF_INSPECTOR_VERSION);
    expect(PDF_INSPECTOR_VERSION).toBe('1.18.2-inkdown.1');
  });

  it('真实 inspector 暴露可调用的 extractEmbeddedOutline', async () => {
    const { inspector } = await ensurePdfTestRuntime();
    expect(typeof inspector.extractEmbeddedOutline).toBe('function');
  });

  it('有 outline 的 synthetic PDF：title/level/物理页正确，不可解析项缺席页码', async () => {
    const { inspector } = await ensurePdfTestRuntime();
    const read = inspector.extractEmbeddedOutline?.(syntheticOutlinedPdf());
    expect(read).toBeDefined();
    if (!read) return;
    expect(read.truncated).toBe(false);
    expect(read.unresolvedCount).toBe(1);
    expect(read.items.map((e) => e.title)).toEqual(['Alpha', 'Beta', 'Gamma Link']);
    expect(read.items.map((e) => e.level)).toEqual([1, 1, 1]);
    expect(read.items[0]?.physicalPage).toBe(1);
    expect(read.items[1]?.physicalPage).toBe(2);
    expect(read.items[2]?.physicalPage ?? null).toBeNull();
  });

  it('无 outline 的 synthetic PDF：空成功，不抛', async () => {
    const { inspector } = await ensurePdfTestRuntime();
    const read = inspector.extractEmbeddedOutline?.(syntheticPlainPdf());
    expect(read).toEqual({ items: [], unresolvedCount: 0, truncated: false });
  });
});
