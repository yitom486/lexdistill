import { afterEach, describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { PLATFORM_ARTIFACTS, PDF_INSPECTOR_MAIN, PDF_INSPECTOR_VERSION, currentRuntimePlatform } from '../../../infrastructure/pdf-runtime/pdf-artifacts.js';
import { defaultPdfRuntimeDir, ensurePdfRuntime } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { fetchRuntimeArtifact, preparePdfRuntime } from '../../../infrastructure/pdf-runtime/pdf-runtime-provision.js';

const platform = currentRuntimePlatform();
const pins = PLATFORM_ARTIFACTS[platform];
const roots: string[] = [];
const originalFetch = globalThis.fetch;
const envKeys = ['PDFIUM_LIB_PATH', 'STUDY_STUDIO_PDF_RUNTIME_DIR', 'STUDY_STUDIO_RUNTIME_DIR'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  for (const root of roots.splice(0)) await fsp.rm(root, { recursive: true, force: true });
});

async function fresh(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'lingua-pdf-bundle-'));
  roots.push(root);
  return root;
}

/** 受控安装资源验证路径/只读行为；真实原生组件另由 native PDF 用例覆盖。 */
async function fixture(root: string): Promise<string> {
  const inspectorDir = path.join(root, 'node_modules', '@firecrawl', 'pdf-inspector');
  const napiDir = path.join(root, 'node_modules', pins.napiPkg);
  await fsp.mkdir(inspectorDir, { recursive: true });
  await fsp.mkdir(napiDir, { recursive: true });
  await fsp.writeFile(path.join(inspectorDir, 'index.js'), 'module.exports = { processPdf: () => ({ pageCount: 1 }), renderPdfPages: async () => [] };');
  await fsp.writeFile(path.join(napiDir, 'fixture.node'), 'fixture only');
  await fsp.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, pdfInspector: PDF_INSPECTOR_VERSION, platform }));
  const lib = path.join(root, 'pdfium', pins.pdfiumLibName);
  await fsp.mkdir(path.dirname(lib), { recursive: true });
  await fsp.writeFile(lib, 'fixture only');
  return lib;
}

describe('随安装包交付的 PDF 组件', () => {
  it('新安装位置断网加载；不写 manifest、不创建用户缓存，并覆盖旧库路径', async () => {
    const source = await fresh();
    await fixture(source);
    const installation = path.join(await fresh(), '安装目录 with spaces');
    await fsp.cp(source, installation, { recursive: true });
    const userCache = path.join(await fresh(), 'never-created');
    process.env.STUDY_STUDIO_RUNTIME_DIR = userCache;
    process.env.STUDY_STUDIO_PDF_RUNTIME_DIR = installation;
    process.env.PDFIUM_LIB_PATH = 'stale-pdfium-library';
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error('network must not be used'); }) as unknown as typeof fetch;
    const manifest = path.join(installation, 'manifest.json');
    const before = await fsp.stat(manifest);
    const result = await ensurePdfRuntime({ needPdfium: true });
    expect(defaultPdfRuntimeDir()).toBe(installation);
    expect(result.inspector.processPdf(new Uint8Array()).pageCount).toBe(1);
    expect(result.paths.pdfiumLib).toBe(path.join(installation, 'pdfium', pins.pdfiumLibName));
    expect(process.env.PDFIUM_LIB_PATH).toBe(result.paths.pdfiumLib!);
    expect((await fsp.stat(manifest)).mtimeMs).toBe(before.mtimeMs);
    expect(await fsp.access(userCache).then(() => true, () => false)).toBe(false);
    expect(calls).toBe(0);
  });

  it('组件缺失、旧版本、平台错误、缺 PDFium 均直接失败，不联网补装', async () => {
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error('must not fetch'); }) as unknown as typeof fetch;
    const root = await fresh();
    await expect(ensurePdfRuntime({ runtimeDir: root })).rejects.toMatchObject({ code: 'E_RUNTIME_MISSING' });
    const lib = await fixture(root);
    await fsp.unlink(lib);
    await expect(ensurePdfRuntime({ runtimeDir: root, needPdfium: true })).rejects.toMatchObject({ code: 'E_RUNTIME_MISSING' });
    for (const override of [{ pdfInspector: 'old', platform }, { pdfInspector: PDF_INSPECTOR_VERSION, platform: 'other' }]) {
      await fsp.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, ...override }));
      await expect(ensurePdfRuntime({ runtimeDir: root })).rejects.toMatchObject({ code: 'E_RUNTIME_MISSING' });
    }
    expect(calls).toBe(0);
  });

  it('缺平台原生绑定时失败；取消在加载前生效', async () => {
    const root = await fresh();
    await fixture(root);
    await fsp.unlink(path.join(root, 'node_modules', pins.napiPkg, 'fixture.node'));
    await expect(ensurePdfRuntime({ runtimeDir: root })).rejects.toMatchObject({ code: 'E_RUNTIME_MISSING' });
    await expect(ensurePdfRuntime({ runtimeDir: root, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'E_CANCELLED' });
  });
});

describe('PDF 构建准备', () => {
  it('请求精确的三个固定构件；摘要错误让构建失败，不写未验证文件', async () => {
    const root = await fresh();
    const calls: string[] = [];
    const fetchImpl = (async (url: unknown) => { calls.push(String(url)); return new Response('invalid artifact'); }) as unknown as typeof fetch;
    await expect(preparePdfRuntime({ runtimeDir: root, fetchImpl })).rejects.toMatchObject({ code: 'E_RUNTIME_VERIFY' });
    expect(new Set(calls)).toEqual(new Set([PDF_INSPECTOR_MAIN.url, pins.napi.url, pins.pdfiumUrl]));
    expect(await fsp.readdir(root)).toEqual([]);
  });

  it('下载失败阻断构建，不留 manifest', async () => {
    const root = await fresh();
    await expect(preparePdfRuntime({ runtimeDir: root, fetchImpl: (() => { throw new Error('offline'); }) as unknown as typeof fetch })).rejects.toMatchObject({ code: 'E_RUNTIME_DOWNLOAD' });
    expect(await fsp.readdir(root)).toEqual([]);
  });

  it('已准备组件先验证可加载再复用；损坏缓存不能生成安装包', async () => {
    const root = await fresh();
    const lib = await fixture(root);
    const fetchImpl = (() => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
    await preparePdfRuntime({ runtimeDir: root, fetchImpl });
    await fsp.unlink(lib);
    await expect(preparePdfRuntime({ runtimeDir: root, fetchImpl })).rejects.toMatchObject({ code: 'E_RUNTIME_MISSING' });
  });

  it('缺少已登记摘要的平台在请求前阻断', async () => {
    await expect(preparePdfRuntime({ runtimeDir: await fresh(), platform: 'linux-arm64', fetchImpl: (() => { throw new Error('must not fetch'); }) as unknown as typeof fetch })).rejects.toMatchObject({ code: 'E_RUNTIME_PIN_MISSING' });
  });

  it('HTTP 错误和错误摘要均不接收为有效组件', async () => {
    const badStatus = await fetchRuntimeArtifact(PDF_INSPECTOR_MAIN.url, { sha256: PDF_INSPECTOR_MAIN.sha256!, fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch });
    expect(badStatus.ok).toBe(false);
    const badDigest = await fetchRuntimeArtifact(PDF_INSPECTOR_MAIN.url, { sha256: PDF_INSPECTOR_MAIN.sha256!, fetchImpl: (async () => new Response('wrong')) as unknown as typeof fetch });
    expect(badDigest.ok).toBe(false);
  });
});
