import { afterEach, describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  PLATFORM_ARTIFACTS,
  PDF_INSPECTOR_MAIN,
  PDF_INSPECTOR_VERSION,
  currentRuntimePlatform,
} from '../../../infrastructure/pdf-runtime/pdf-artifacts.js';
import { ensurePdfRuntime } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { testRuntimeDir } from './pdf-test-runtime.js';

/**
 * CMD-LINGUA-P4A-2：needPdfium 只准备 PDFium（不要 ORT/模型）。
 *
 * - 下载集合测试走真实网络（与 native E2E 同策略：离线即大声失败），
 *   断言 URL 精确集合，复制 pin 的测试运行时找真 pdfium.dll 预置。
 * - 稳态测试全 hermetic（预置目录 + 必抛 fetch），断言零网络调用。
 */

const savedEnv: Record<string, string | undefined> = {};
for (const key of ['PDFIUM_LIB_PATH', 'ORT_DYLIB_PATH', 'PDF_INSPECTOR_MODEL_CACHE']) {
  savedEnv[key] = process.env[key];
}
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const tmpRoots: string[] = [];
afterEach(async () => {
  for (const dir of tmpRoots.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

async function freshTmp(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), 'cmd-p4a2-rt-'));
  tmpRoots.push(dir);
  return dir;
}

function recordingFetch(
  calls: string[],
  delegate: (url: string, init?: RequestInit) => Promise<Response>
): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    calls.push(href);
    return delegate(href, init);
  }) as unknown as typeof fetch;
}

async function findPinnedPdfiumLib(): Promise<string> {
  const platform = currentRuntimePlatform();
  const libName = PLATFORM_ARTIFACTS[platform].pdfiumLibName;
  const stack = [path.join(testRuntimeDir(), 'pdfium')];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === libName) return full;
    }
  }
  throw new Error(`pinned 测试运行时缺 ${libName}，先跑一次 test:all 完成 bootstrap`);
}

describe('P4A-2 needPdfium 下载集合（真实网络，与 native E2E 同策略）', () => {
  it('精确集合 = [主包, napi 包, pdfium 包]，无 ORT/模型；env 只立 PDFIUM', async () => {
    const platform = currentRuntimePlatform();
    const pins = PLATFORM_ARTIFACTS[platform];
    delete process.env.PDFIUM_LIB_PATH;
    delete process.env.ORT_DYLIB_PATH;
    // 固定探测目录（本进程加载真 .node 后 Windows 会锁文件，结尾不删；
    // 开头先清上一次残留，保证下载集合断言确定性）。
    const dir = path.join(tmpdir(), 'lingua-p4a2-download-probe');
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    const calls: string[] = [];
    const fetchImpl = recordingFetch(calls, (url, init) => fetch(url, init));
    const result = await ensurePdfRuntime({ runtimeDir: dir, needPdfium: true, fetchImpl, platform });
    // 精确断言下载集合：inspector 主包 + napi 包 + pdfium 包，无 ORT/模型。
    // （主包与 napi 包并发下载，比较集合；pdfium 在后。12MB 量级，与 native E2E 同策略。）
    expect(new Set(calls)).toEqual(new Set([PDF_INSPECTOR_MAIN.url, pins.napi.url, pins.pdfiumUrl]));
    expect(calls.some((u) => u.includes('onnxruntime'))).toBe(false);
    expect(calls.some((u) => u.includes('models'))).toBe(false);
    expect(typeof process.env.PDFIUM_LIB_PATH).toBe('string');
    const ortEnv: unknown = process.env.ORT_DYLIB_PATH;
    expect(ortEnv).toBeUndefined();
    const pdfiumEnv: unknown = process.env.PDFIUM_LIB_PATH;
    expect(pdfiumEnv).toBe(result.paths.pdfiumLib);
    expect('ortLib' in result.paths).toBe(false);
  }, 60000);
});

describe('P4A-2 needPdfium 稳态（预置目录，必抛 fetch）', () => {
  it('零网络调用即成功（不重复下载，更不碰 ORT）', async () => {
    const platform = currentRuntimePlatform();
    const pins = PLATFORM_ARTIFACTS[platform];
    delete process.env.PDFIUM_LIB_PATH;
    delete process.env.ORT_DYLIB_PATH;
    const dir = await freshTmp();
    // 预置：inspector 主包（stub 可加载）+ manifest（新 pin）+ 真 pdfium 库文件。
    const inspectorDir = path.join(dir, 'node_modules', '@firecrawl', 'pdf-inspector');
    await fsp.mkdir(inspectorDir, { recursive: true });
    await fsp.writeFile(
      path.join(inspectorDir, 'package.json'),
      JSON.stringify({ name: '@firecrawl/pdf-inspector', version: PDF_INSPECTOR_VERSION })
    );
    await fsp.writeFile(
      path.join(inspectorDir, 'index.js'),
      'module.exports = { processPdf: () => ({}), renderPdfPages: async () => [] };'
    );
    await fsp.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ version: 1, pdfInspector: PDF_INSPECTOR_VERSION, platform })
    );
    const realLib = await findPinnedPdfiumLib();
    const pdfiumDir = path.join(dir, 'pdfium');
    await fsp.mkdir(pdfiumDir, { recursive: true });
    const libPath = path.join(pdfiumDir, pins.pdfiumLibName);
    await fsp.copyFile(realLib, libPath);
    const calls: string[] = [];
    const fetchImpl = recordingFetch(calls, () => {
      throw new Error('must not fetch');
    });
    const result = await ensurePdfRuntime({ runtimeDir: dir, needPdfium: true, fetchImpl, platform });
    expect(calls).toEqual([]);
    expect(result.paths.pdfiumLib).toBe(libPath);
    const pdfiumEnv: unknown = process.env.PDFIUM_LIB_PATH;
    expect(pdfiumEnv).toBe(libPath);
    const ortEnv: unknown = process.env.ORT_DYLIB_PATH;
    expect(ortEnv).toBeUndefined();
    expect('ortLib' in result.paths).toBe(false);
  });
});
