import { createHash } from 'node:crypto';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { BusinessError, ok, err, type Result } from '@study-studio/shared';
import { extractTarGz, type ArchiveEntry } from '@study-studio/archive';
import { PDF_INSPECTOR_MAIN, PDF_INSPECTOR_VERSION, PLATFORM_ARTIFACTS, assertArtifactUrlAllowed, currentRuntimePlatform, type PdfRuntimePlatform } from './pdf-artifacts.js';
import { ensurePdfRuntime, napiDirName, readManifest } from './pdf-runtime.js';

// 下载仅在构建/显式测试准备阶段执行，应用运行时不导入本模块。
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60000;
function sha512Base64(data: Uint8Array): string {
  return createHash('sha512').update(data).digest('base64');
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function downloadArtifact(
  url: string,
  fetchImpl: typeof fetch,
  integrity?: string,
  sha256?: string
): Promise<Uint8Array> {
  assertArtifactUrlAllowed(url);
  if (!integrity && !sha256) {
    throw new BusinessError(
      'E_RUNTIME_PIN_MISSING',
      '构件缺少完整性 pin，拒绝下载（请先登记官方摘要）',
      'TOOL_EXECUTION'
    );
  }
  let res: Response;
  try {
    // data: URL 不走网络，不挂超时信号（Bun 下 data: + signal 会直接抛错）
    const init = url.startsWith('data:') ? undefined : { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) };
    res = await fetchImpl(url, init);
  } catch {
    throw new BusinessError('E_RUNTIME_DOWNLOAD', '构件下载超时或网络不可达，请检查网络后重试', 'NETWORK');
  }
  if (!res.ok) {
    throw new BusinessError(
      'E_RUNTIME_DOWNLOAD',
      `构件下载失败（HTTP ${res.status}），请稍后重试`,
      'NETWORK'
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_DOWNLOAD_BYTES) {
    throw new BusinessError('E_RUNTIME_DOWNLOAD', '构件体积异常，拒绝写入', 'TOOL_EXECUTION');
  }
  if (integrity) {
    const [algo, expected] = integrity.split('-', 2);
    if (algo !== 'sha512' || sha512Base64(buf) !== expected) {
      throw new BusinessError('E_RUNTIME_VERIFY', '构件完整性校验失败，已丢弃（疑似被篡改或传输出错）', 'TOOL_EXECUTION');
    }
  }
  if (sha256 && sha256Hex(buf) !== sha256.toLowerCase()) {
    throw new BusinessError('E_RUNTIME_VERIFY', '构件完整性校验失败，已丢弃（疑似被篡改或传输出错）', 'TOOL_EXECUTION');
  }
  return buf;
}

async function writeEntries(baseDir: string, entries: ArchiveEntry[]): Promise<void> {
  for (const e of entries) {
    const target = path.resolve(baseDir, e.path);
    if (!target.startsWith(path.resolve(baseDir) + path.sep)) {
      throw new BusinessError('E_RUNTIME_VERIFY', '构件包内含越界路径，拒绝解包', 'TOOL_EXECUTION');
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, e.data);
  }
}


/** 仅构建脚本调用；固定版本构件完整校验后才能写入安装资源目录。 */
export async function preparePdfRuntime(options: {
  runtimeDir: string;
  platform?: PdfRuntimePlatform;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { runtimeDir } = options;
  const platform = options.platform ?? currentRuntimePlatform();
  const pins = PLATFORM_ARTIFACTS[platform];
  if (!PDF_INSPECTOR_MAIN.sha256 || !pins.napi.sha256 || !pins.pdfiumSha256) {
    throw new BusinessError('E_RUNTIME_PIN_MISSING', 'PDF 构件缺少固定摘要，拒绝构建', 'TOOL_EXECUTION');
  }
  const existing = await readManifest(runtimeDir);
  if (existing?.pdfInspector === PDF_INSPECTOR_VERSION && existing.platform === platform) {
    // 缓存也须真实加载；缺失/损坏即让构建失败，不能生成缺组件的安装包。
    await ensurePdfRuntime({ runtimeDir, platform, needPdfium: true });
    return;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const [mainPkg, napiPkg, pdfiumPkg] = await Promise.all([
    downloadArtifact(PDF_INSPECTOR_MAIN.url, fetchImpl, undefined, PDF_INSPECTOR_MAIN.sha256),
    downloadArtifact(pins.napi.url, fetchImpl, undefined, pins.napi.sha256),
    downloadArtifact(pins.pdfiumUrl, fetchImpl, undefined, pins.pdfiumSha256),
  ]);
  // 所有下载均验证成功后才写盘；旧版本文件不混入新安装包。
  const nodeModulesDir = path.join(runtimeDir, 'node_modules', '@firecrawl');
  await fsp.mkdir(runtimeDir, { recursive: true });
  const buildRoot = await fsp.realpath(runtimeDir);
  for (const name of ['node_modules', 'pdfium']) {
    const target = path.resolve(runtimeDir, name);
    const actual = await fsp.realpath(target).catch(() => target);
    if (!actual.startsWith(buildRoot + path.sep)) {
      throw new BusinessError('E_RUNTIME_VERIFY', '构建资源路径越界，拒绝清理', 'TOOL_EXECUTION');
    }
    await fsp.rm(target, { recursive: true, force: true });
  }
  await fsp.rm(path.join(runtimeDir, 'manifest.json'), { force: true });
  await writeEntries(nodeModulesDir, [
    ...extractTarGz(mainPkg).map(e => ({ path: path.join('pdf-inspector', e.path.replace(/^package\//, '')), data: e.data })),
    ...extractTarGz(napiPkg).map(e => ({ path: path.join(napiDirName(pins.napiPkg), e.path.replace(/^package\//, '')), data: e.data })),
  ]);
  await writeEntries(path.join(runtimeDir, 'pdfium'), extractTarGz(pdfiumPkg));
  await fsp.writeFile(path.join(runtimeDir, 'manifest.json'), JSON.stringify({ version: 1, pdfInspector: PDF_INSPECTOR_VERSION, platform }));
  try {
    await ensurePdfRuntime({ runtimeDir, platform, needPdfium: true });
  } catch (cause) {
    await fsp.rm(path.join(runtimeDir, 'manifest.json'), { force: true });
    throw cause;
  }
}

/** 纯下载+校验（单测/脚本用，不解包）。 */
export async function fetchRuntimeArtifact(
  url: string,
  options: { fetchImpl?: typeof fetch; integrity?: string; sha256?: string } = {}
): Promise<Result<Uint8Array, BusinessError>> {
  try {
    const data = await downloadArtifact(
      url,
      options.fetchImpl ?? fetch,
      options.integrity,
      options.sha256
    );
    return ok(data);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(new BusinessError('E_RUNTIME_DOWNLOAD', '构件下载失败，请稍后重试', 'NETWORK'));
  }
}
