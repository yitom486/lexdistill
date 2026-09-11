import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { BusinessError, logger, ok, err, type Result } from '@study-studio/shared';
import { defaultRuntimeDir } from '../../../../infrastructure/persistence/app-paths.js';
import {
  PDF_INSPECTOR_MAIN,
  PDF_INSPECTOR_VERSION,
  PLATFORM_ARTIFACTS,
  assertArtifactUrlAllowed,
  currentRuntimePlatform,
  type PdfRuntimePlatform,
} from './pdf-artifacts.js';
import { extractTarGz, extractZip, type ArchiveEntry } from './archive.js';

/**
 * PDF 运行时管理器（按需下载，不进安装包）。
 *
 * - 首次导入 PDF 时下载 pdf-inspector（主包 + 对应平台 napi 包，~10MB）到用户数据目录；
 * - 遇到扫描页需要 OCR 时再下载 PDFium + ONNX Runtime + 由 pdf-inspector 自行校验的 OCR 模型；
 * - 全部构件经域名白名单 + integrity/sha256 校验；缺 pin 的平台直接拒绝（不猜）。
 */

export interface PdfInspectorLike {
  processPdf(pdf: Uint8Array, pages?: number[]): PdfClassifyResult;
  processPdfWithOcr(pdf: Uint8Array, options?: { pageNumbers?: number[] }): Promise<PdfOcrResult>;
  /**
   * 可选：逐条文本+版式（pdf-inspector `extractTextWithPositions`）。
   * 老版本/阉割实现没有此方法时调用方降级为纯正则候选，不得抛。
   */
  extractTextWithPositions?: (pdf: Uint8Array, pages?: number[]) => LayoutTextItemLike[];
  /** 可选：标签化 PDF 结构角色（`extractStructureElements`，H1..H6/P 等）。 */
  extractStructureElements?: (pdf: Uint8Array, pages?: number[]) => LayoutStructRoleLike[];
  /**
   * 可选：内置目录（fork 1.18.1+ `extractEmbeddedOutline`；老版本缺席即降级为 none）。
   * 只接受安全返回（见 EmbeddedOutlineResult）；调用方另行校验页码范围。
   */
  extractEmbeddedOutline?: (pdf: Uint8Array) => EmbeddedOutlineResult;
  /**
   * 可选：受限页渲染 PNG（fork 1.18.2+ `renderPdfPages`；老版本缺席即报错，
   * 提示重启网关以下载新运行时）。只做内存 PNG，不写文件、不跑 OCR。
   */
  renderPdfPages?: (
    pdf: Uint8Array,
    pageNumbers: number[],
    options?: { dpi?: number }
  ) => Promise<RenderedPagePng[]>;
}

/**
 * 单页渲染 PNG（fork `renderPdfPages` 原样透传形状）。
 * `png` 为 PNG 编码字节；`width`/`height` 为真实像素尺寸。
 */
export interface RenderedPagePng {
  /** 1-based PDF 页码（与去重后请求顺序对应）。 */
  pageNumber: number;
  /** PNG 编码字节。 */
  png: Uint8Array;
  /** 像素宽。 */
  width: number;
  /** 像素高。 */
  height: number;
}

/**
 * 内置目录（bookmark）安全返回（fork `extractEmbeddedOutline` 原样透传形状）。
 * 只含稳定纯数据：无对象引用、无 action 字典、无 URI、无正文。
 */
export interface EmbeddedOutlineItem {
  /** 解码后的标题（非空；原生兜底 "(untitled)"）。 */
  title: string;
  /** 1-based 嵌套深度：顶层为 1。 */
  level: number;
  /**
   * 1-based 物理页；缺席或 null 表示目标缺失/外部/不可解析——调用方不得猜页。
   */
  physicalPage?: number | null;
}

export interface EmbeddedOutlineResult {
  /** 文档序条目（先序深度优先）。 */
  items: EmbeddedOutlineItem[];
  /** physicalPage 缺席的条目数（不含截断）。 */
  unresolvedCount: number;
  /**
   * true 表示因节点/深度预算跳过了子树或兄弟——不得当作完整目录使用。
   */
  truncated: boolean;
}

/** 版式条目最小形状（只取判标题需要的字段，不绑 SDK 类型）。 */
export interface LayoutTextItemLike {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  isBold: boolean;
  mcid?: number;
}

export interface LayoutStructRoleLike {
  page: number;
  mcid: number;
  role: string;
}

export interface PdfClassifyResult {
  pdfType?: string;
  pageCount?: number;
  markdown?: string | null;
  pagesNeedingOcr?: number[];
  confidence?: number;
}

export interface PdfOcrResult {
  markdown?: string | null;
  pages?: Array<{ pageNumber: number; markdown: string; spans?: OcrTextSpanLike[] }>;
  pagesRoutedToOcr?: number[];
  pagesRecommendingHosted?: number[];
}

/**
 * 行级 OCR 识别结果（fork 原生 `OcrTextSpan` 透传形状，与 TextItem 同坐标系）。
 * P3 只用它验证“同一行标题—右侧页码”几何关系；缺席即降级为纯文本证据。
 */
export interface OcrTextSpanLike {
  /** 识别行文本（已 trim）。 */
  text: string;
  /** 行包围盒（PDF 点，同 TextItem 系）。 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 识别置信度 0–1。 */
  confidence: number;
}

export interface PdfRuntimePaths {
  runtimeDir: string;
  inspectorDir: string;
  modelCacheDir: string;
  pdfiumLib: string | null;
  ortLib: string | null;
}

export interface EnsureRuntimeOptions {
  /** 测试注入：跳过真实下载，直接返回该 extractor */
  loadInspector?: () => Promise<PdfInspectorLike>;
  runtimeDir?: string;
  fetchImpl?: typeof fetch;
  needOcr?: boolean;
  /**
   * CMD-LINGUA-P4A-2：页面渲染只要 PDFium（不要 ORT/模型）。
   * 与 needOcr 正交：只准备 pdfium 库 + PDFIUM_LIB_PATH，不碰 ORT 与模型缓存下载。
   */
  needPdfium?: boolean;
  platform?: PdfRuntimePlatform;
  /**
   * CMD-LINGUA-P2.1：调用方取消信号（如下游 HTTP 请求 abort）。
   * 仅透传给构件下载 fetch；native 解包/加载阶段仍不可中断，
   * 调用方须在 await 前后自行检查 signal（流式编排已做）。
   */
  signal?: AbortSignal;
  /**
   * CMD-LINGUA-P2.1：运行时阶段钩子（可选；只报告“是否命中缓存/是否下载”，
   * 无路径、无 URL、无体积以外的任何信息）。缺省不打扰任何调用方。
   */
  onRuntimeEvent?: (event: PdfRuntimeStageEvent) => void;
}

/**
 * CMD-LINGUA-P2.1 运行时阶段（缓存命中 vs 真实下载的诚实区分，
 * 供流式进度与开发诊断消费；字段仅阶段名，无敏感信息）。
 */
export interface PdfRuntimeStageEvent {
  stage:
    | 'inspector_cached'
    | 'inspector_downloaded'
    | 'ocr_cached'
    | 'ocr_downloading'
    | 'ocr_ready';
}

/** napi 包名（带 scope）→ node_modules/@firecrawl 下的目录名（去 scope）。 */
export function napiDirName(napiPkg: string): string {
  return napiPkg.includes('/') ? (napiPkg.split('/')[1] as string) : napiPkg;
}
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 180000;

const inFlight = new Map<string, Promise<{ inspector: PdfInspectorLike; paths: PdfRuntimePaths }>>();

export { defaultRuntimeDir };

function sha512Base64(data: Uint8Array): string {
  return createHash('sha512').update(data).digest('base64');
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

type AbortSignalWithAny = typeof AbortSignal & {
  any?: (signals: AbortSignal[]) => AbortSignal;
};

/**
 * CMD-LINGUA-P2.1：下载超时与调用方取消二合一信号。
 * 调用方已 abort 时直接返回其 signal（fetch 立刻以 AbortError 失败，
 * 调用方按 signal.aborted 判取消而非失败）；AbortSignal.any 缺席时
 * 退化为纯超时（旧行为，不改变既有调用方语义）。
 */
function downloadSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  try {
    if (external.aborted) return external;
  } catch {
    return timeout;
  }
  const anyFn = (AbortSignal as AbortSignalWithAny).any;
  if (typeof anyFn === 'function') {
    try {
      return anyFn([timeout, external]);
    } catch {
      return timeout;
    }
  }
  return timeout;
}

async function downloadArtifact(
  url: string,
  fetchImpl: typeof fetch,
  integrity?: string,
  sha256?: string,
  // 仅用于上游不提供单文件摘要的构件（当前仅 ONNX Runtime）：
  // 仍受域名白名单 + TLS + 体积上限保护，缺 pin 的事实在调用处注释说明。
  allowUnpinned = false,
  signal?: AbortSignal
): Promise<Uint8Array> {
  assertArtifactUrlAllowed(url);
  if (!integrity && !sha256 && !allowUnpinned) {
    throw new BusinessError(
      'E_RUNTIME_PIN_MISSING',
      '构件缺少完整性 pin，拒绝下载（请先登记官方摘要）',
      'TOOL_EXECUTION'
    );
  }
  let res: Response;
  try {
    // data: URL 不走网络，不挂超时信号（Bun 下 data: + signal 会直接抛错）
    const init = url.startsWith('data:') ? undefined : { signal: downloadSignal(DOWNLOAD_TIMEOUT_MS, signal) };
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
  // ORT 上游无单文件摘要：至少校验体积量级（win x64 包约 70MB+），拦截下载截断
  if (allowUnpinned && buf.length < 10 * 1024 * 1024) {
    throw new BusinessError('E_RUNTIME_DOWNLOAD', '构件下载不完整（体积过小），请重试', 'NETWORK');
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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
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

async function findFileByName(dir: string, fileName: string): Promise<string | null> {
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    let items: import('node:fs').Dirent[];
    try {
      items = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      const full = path.join(cur, it.name);
      if (it.isDirectory()) stack.push(full);
      else if (it.name === fileName) return full;
    }
  }
  return null;
}

interface ManifestShape {
  version: 1;
  pdfInspector: string;
  platform: PdfRuntimePlatform;
  withOcrLibs: boolean;
}

async function readManifest(runtimeDir: string): Promise<ManifestShape | null> {
  try {
    const raw = await fsp.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as ManifestShape;
    if (parsed.version === 1 && typeof parsed.pdfInspector === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function loadInspectorFromDir(inspectorDir: string): PdfInspectorLike {
  try {
    const req = createRequire(path.join(inspectorDir, 'index.js'));
    const mod = req(inspectorDir) as {
      processPdf?: unknown;
      processPdfWithOcr?: unknown;
    };
    if (typeof mod.processPdf !== 'function' || typeof mod.processPdfWithOcr !== 'function') {
      throw new Error('bad exports');
    }
    return mod as unknown as PdfInspectorLike;
  } catch (e) {
    throw new BusinessError(
      'E_RUNTIME_LOAD',
      'PDF 解析运行时加载失败，请删除运行时目录后重试（将重新按需下载）',
      'TOOL_EXECUTION'
    );
  }
}

export function ensurePdfRuntime(
  options: EnsureRuntimeOptions = {}
): Promise<{ inspector: PdfInspectorLike; paths: PdfRuntimePaths }> {
  const runtimeDir = options.runtimeDir ?? defaultRuntimeDir();
  const key = `${runtimeDir}|ocr=${options.needOcr ? 1 : 0}|pdfium=${options.needPdfium ? 1 : 0}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = ensurePdfRuntimeInner({ ...options, runtimeDir }).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function ensurePdfRuntimeInner(
  options: EnsureRuntimeOptions & { runtimeDir: string }
): Promise<{ inspector: PdfInspectorLike; paths: PdfRuntimePaths }> {
  const { runtimeDir } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const platform = options.platform ?? currentRuntimePlatform();
  const pins = PLATFORM_ARTIFACTS[platform];

  if (options.loadInspector) {
    return {
      inspector: await options.loadInspector(),
      paths: {
        runtimeDir,
        inspectorDir: runtimeDir,
        modelCacheDir: path.join(runtimeDir, 'models'),
        pdfiumLib: null,
        ortLib: null,
      },
    };
  }

  await fsp.mkdir(runtimeDir, { recursive: true });
  const nodeModulesDir = path.join(runtimeDir, 'node_modules', '@firecrawl');
  const inspectorDir = path.join(nodeModulesDir, 'pdf-inspector');
  const napiDir = path.join(nodeModulesDir, pins.napiPkg);
  const inspectorIndex = path.join(inspectorDir, 'index.js');

  const manifest = await readManifest(runtimeDir);
  const extractorReady =
    manifest?.pdfInspector === PDF_INSPECTOR_VERSION &&
    manifest.platform === platform &&
    (await fileExists(inspectorIndex));
  let inspectorInstalled = false;
  const notify = options.onRuntimeEvent;
  if (!extractorReady) {
    logger.info('[pdf-runtime] 首次使用：按需下载 PDF 解析运行时（约 10MB，一次性）');
    const [mainPkg, napiPkg] = await Promise.all([
      downloadArtifact(PDF_INSPECTOR_MAIN.url, fetchImpl, PDF_INSPECTOR_MAIN.integrity, PDF_INSPECTOR_MAIN.sha256, false, options.signal),
      downloadArtifact(pins.napi.url, fetchImpl, pins.napi.integrity, pins.napi.sha256, false, options.signal),
    ]);
    const napiShortName = napiDirName(pins.napiPkg);
    await writeEntries(nodeModulesDir, [
      ...extractTarGz(mainPkg).map((e) => ({
        path: path.join('pdf-inspector', e.path.replace(/^package\//, '')),
        data: e.data,
      })),
      ...extractTarGz(napiPkg).map((e) => ({
        path: path.join(napiShortName, e.path.replace(/^package\//, '')),
        data: e.data,
      })),
    ]);
    inspectorInstalled = true;
    notify?.({ stage: 'inspector_downloaded' });
  } else {
    notify?.({ stage: 'inspector_cached' });
  }

  let pdfiumLib: string | null = null;
  let ortLib: string | null = null;
  const pdfiumDir = path.join(runtimeDir, 'pdfium');
  if (options.needOcr) {
    const freshManifest = await readManifest(runtimeDir);
    const ocrReady =
      freshManifest?.pdfInspector === PDF_INSPECTOR_VERSION &&
      freshManifest.withOcrLibs === true &&
      freshManifest.platform === platform;
    const ortDir = path.join(runtimeDir, 'onnxruntime');
    if (!ocrReady) {
      logger.info('[pdf-runtime] 检测到扫描页：按需下载 OCR 运行时（PDFium + ONNX Runtime，约 80MB，一次性）');
      notify?.({ stage: 'ocr_downloading' });
      const [pdfiumPkg, ortPkg] = await Promise.all([
        downloadArtifact(pins.pdfiumUrl, fetchImpl, undefined, pins.pdfiumSha256, false, options.signal),
        // ONNX Runtime 上游未发布单文件摘要：白名单 + TLS + 体积上限，无哈希 pin（见 pdf-artifacts.ts）。
        downloadArtifact(pins.ortUrl, fetchImpl, undefined, undefined, true, options.signal),
      ]);
      await writeEntries(pdfiumDir, extractTarGz(pdfiumPkg));
      await writeEntries(
        ortDir,
        // ORT 上游包内含 403MB 的 *.pdb 调试符号（MAX_ENTRY_BYTES=150MB 会整体拒绝；
        // pdb 永不被加载，跳过。见 archive.ExtractOptions）。
        (pins.ortUrl.endsWith('.zip') ? extractZip(ortPkg, { skipEntry: (p) => /\.pdb$/i.test(p) }) : extractTarGz(ortPkg))
      );
    } else {
      notify?.({ stage: 'ocr_cached' });
    }
    pdfiumLib = await findFileByName(pdfiumDir, pins.pdfiumLibName);
    ortLib = await findFileByName(ortDir, pins.ortLibName);
    if (!pdfiumLib || !ortLib) {
      throw new BusinessError('E_RUNTIME_LOAD', 'OCR 运行时解包不完整（缺少本地库），请重试下载', 'TOOL_EXECUTION');
    }
    if (!process.env.PDFIUM_LIB_PATH) process.env.PDFIUM_LIB_PATH = pdfiumLib;
    if (!process.env.ORT_DYLIB_PATH) process.env.ORT_DYLIB_PATH = ortLib;
    notify?.({ stage: 'ocr_ready' });
  } else if (options.needPdfium) {
    // CMD-LINGUA-P4A-2：页面渲染只要 PDFium——版本对上 + 文件在即用，
    // 不下载 ORT/模型；版本对不上或文件缺失才下载 pdfium 包（SHA 照常校验）。
    const pdfiumManifest = await readManifest(runtimeDir);
    const pdfiumReady =
      pdfiumManifest?.pdfInspector === PDF_INSPECTOR_VERSION &&
      pdfiumManifest.platform === platform &&
      (await findFileByName(pdfiumDir, pins.pdfiumLibName)) !== null;
    if (!pdfiumReady) {
      logger.info('[pdf-runtime] 目录页渲染：按需准备 PDFium（仅渲染库，不含 OCR 模型）');
      const pdfiumPkg = await downloadArtifact(pins.pdfiumUrl, fetchImpl, undefined, pins.pdfiumSha256, false, options.signal);
      await writeEntries(pdfiumDir, extractTarGz(pdfiumPkg));
    }
    pdfiumLib = await findFileByName(pdfiumDir, pins.pdfiumLibName);
    if (!pdfiumLib) {
      throw new BusinessError('E_RUNTIME_LOAD', 'PDFium 解包不完整（缺少本地库），请重试下载', 'TOOL_EXECUTION');
    }
    if (!process.env.PDFIUM_LIB_PATH) process.env.PDFIUM_LIB_PATH = pdfiumLib;
  }

  const modelCacheDir = path.join(runtimeDir, 'models');
  await fsp.mkdir(modelCacheDir, { recursive: true });
  if (!process.env.PDF_INSPECTOR_MODEL_CACHE) {
    process.env.PDF_INSPECTOR_MODEL_CACHE = modelCacheDir;
  }

  // 非 OCR 调用不得降级 withOcrLibs（否则一次文字版导入会清掉已就绪的 OCR 标记，
  // 下次扫描导入被迫重下 80MB —— 真机抓到的 bug）。
  // 同理：只有本轮实际安装了 inspector 才登记新 pin，否则沿用旧登记——
  // 否则一次 needPdfium 调用会把 manifest 写成新版本，而 inspector 目录仍是旧版。
  const prevManifest = await readManifest(runtimeDir);
  await fsp.writeFile(
    path.join(runtimeDir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      pdfInspector: inspectorInstalled ? PDF_INSPECTOR_VERSION : (prevManifest?.pdfInspector ?? PDF_INSPECTOR_VERSION),
      platform,
      withOcrLibs: options.needOcr ? Boolean(pdfiumLib && ortLib) : Boolean(prevManifest?.withOcrLibs),
    } satisfies ManifestShape)
  );

  return {
    inspector: loadInspectorFromDir(inspectorDir),
    paths: { runtimeDir, inspectorDir, modelCacheDir, pdfiumLib, ortLib },
  };
}

/** 纯下载+校验（单测/脚本用，不解包）。 */
export async function fetchRuntimeArtifact(
  url: string,
  options: { fetchImpl?: typeof fetch; integrity?: string; sha256?: string; allowUnpinned?: boolean } = {}
): Promise<Result<Uint8Array, BusinessError>> {
  try {
    const data = await downloadArtifact(
      url,
      options.fetchImpl ?? fetch,
      options.integrity,
      options.sha256,
      options.allowUnpinned
    );
    return ok(data);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(new BusinessError('E_RUNTIME_DOWNLOAD', '构件下载失败，请稍后重试', 'NETWORK'));
  }
}
