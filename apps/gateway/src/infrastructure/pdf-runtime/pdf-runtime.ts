import { createRequire } from 'node:module';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { BusinessError } from '@study-studio/shared';
import { defaultRuntimeDir } from '../persistence/app-paths.js';
import {
  PDF_INSPECTOR_VERSION,
  PLATFORM_ARTIFACTS,
  currentRuntimePlatform,
  type PdfRuntimePlatform,
} from './pdf-artifacts.js';
import { fileURLToPath } from 'node:url';

/** 随安装包交付的 PDF 组件；只读加载，缺失/损坏时直接报错，不联网补装。 */

export interface PdfInspectorLike {
  processPdf(pdf: Uint8Array, pages?: number[]): PdfClassifyResult;
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
   * 提示更新完整安装包）。只做内存 PNG，不写文件、不跑 OCR。
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

  confidence?: number;
}

export interface PdfRuntimePaths {
  runtimeDir: string;
  inspectorDir: string;
  pdfiumLib: string | null;
}

export interface EnsureRuntimeOptions {
  /** 测试注入：直接返回该 extractor */
  loadInspector?: () => Promise<PdfInspectorLike>;
  runtimeDir?: string;
  /** Agent 按需查看扫描页时准备 PDFium。 */
  needPdfium?: boolean;
  platform?: PdfRuntimePlatform;
  /**
   * CMD-LINGUA-P2.1：调用方取消信号（如下游 HTTP 请求 abort）。
   * 只读加载前检查取消；native 加载阶段仍不可中断，
   * 调用方须在 await 前后自行检查 signal（流式编排已做）。
   */
  signal?: AbortSignal;
  /**
   * CMD-LINGUA-P2.1：运行时阶段钩子（可选；只报告“组件是否就绪”，
   * 无路径、无 URL、无体积以外的任何信息）。缺省不打扰任何调用方。
   */
  onRuntimeEvent?: (event: PdfRuntimeStageEvent) => void;
}

/**
 * CMD-LINGUA-P2.1 运行时阶段（本地组件就绪状态，
 * 供流式进度与开发诊断消费；字段仅阶段名，无敏感信息）。
 */
export interface PdfRuntimeStageEvent {
  stage:
    | 'inspector_cached'
    | 'pdfium_ready';
}

/** napi 包名（带 scope）→ node_modules/@firecrawl 下的目录名（去 scope）。 */
export function napiDirName(napiPkg: string): string {
  return napiPkg.includes('/') ? (napiPkg.split('/')[1] as string) : napiPkg;
}

const inFlight = new Map<string, Promise<{ inspector: PdfInspectorLike; paths: PdfRuntimePaths }>>();

export { defaultRuntimeDir };

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findFileByName(dir: string, fileName: string): Promise<string | null> {
  const stack = [dir];
  let fallbackMatch: string | null = null;
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
      if (it.isDirectory()) {
        stack.push(full);
      } else if (it.name === fileName) {
        return full;
      } else if (!fallbackMatch) {
        // Linux/macOS 发布包可能使用带版本号的 PDFium 实体文件名。
        if (
          (fileName.includes('pdfium') && it.name.includes('pdfium') && (it.name.includes('.so') || it.name.includes('.dylib') || it.name.endsWith('.dll')))
        ) {
          fallbackMatch = full;
        }
      }
    }
  }
  return fallbackMatch;
}

interface ManifestShape {
  version: 1;
  pdfInspector: string;
  platform: PdfRuntimePlatform;
}

export async function readManifest(runtimeDir: string): Promise<ManifestShape | null> {
  try {
    const raw = await fsp.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as ManifestShape;
    if (parsed.version === 1 && typeof parsed.pdfInspector === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function loadInspectorFromDir(inspectorDir: string, nativeLibrary: string): PdfInspectorLike {
  const previousNativeLibrary = process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
  try {
    // 使用组件自带的 NAPI-RS 入口；编译后的 Bun 不依赖外部包的相对模块搜索。
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativeLibrary;
    const req = createRequire(path.join(inspectorDir, 'index.js'));
    const mod = req(inspectorDir) as {
      processPdf?: unknown;
    };
    if (typeof mod.processPdf !== 'function') {
      throw new Error('bad exports');
    }
    return mod as unknown as PdfInspectorLike;
  } catch (e) {
    throw new BusinessError(
      'E_RUNTIME_LOAD',
      'PDF 组件加载失败，请重新安装完整应用；开发环境请重新准备构建资源',
      'TOOL_EXECUTION',
      false,
      e
    );
  } finally {
    if (previousNativeLibrary === undefined) delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
    else process.env.NAPI_RS_NATIVE_LIBRARY_PATH = previousNativeLibrary;
  }
}

export function ensurePdfRuntime(
  options: EnsureRuntimeOptions = {}
): Promise<{ inspector: PdfInspectorLike; paths: PdfRuntimePaths }> {
  const runtimeDir = options.runtimeDir ?? defaultPdfRuntimeDir();
  const key = `${runtimeDir}|pdfium=${options.needPdfium ? 1 : 0}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = ensurePdfRuntimeInner({ ...options, runtimeDir }).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

/** PDF 安装资源与用户媒体/任务临时目录分开；桌面壳传入真实安装位置。 */
export function defaultPdfRuntimeDir(): string {
  const installed = process.env.STUDY_STUDIO_PDF_RUNTIME_DIR?.trim();
  return installed || fileURLToPath(new URL('../../../../desktop/src-tauri/resources/pdf-runtime/', import.meta.url));
}

async function ensurePdfRuntimeInner(
  options: EnsureRuntimeOptions & { runtimeDir: string }
): Promise<{ inspector: PdfInspectorLike; paths: PdfRuntimePaths }> {
  const { runtimeDir } = options;
  if (options.signal?.aborted) throw new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION');
  if (options.loadInspector) {
    return { inspector: await options.loadInspector(), paths: { runtimeDir, inspectorDir: runtimeDir, pdfiumLib: null } };
  }
  const platform = options.platform ?? currentRuntimePlatform();
  const pins = PLATFORM_ARTIFACTS[platform];
  const manifest = await readManifest(runtimeDir);
  const inspectorDir = path.join(runtimeDir, 'node_modules', '@firecrawl', 'pdf-inspector');
  const napiDir = path.join(runtimeDir, 'node_modules', pins.napiPkg);
  const nativeFiles = await fsp.readdir(napiDir).catch(() => [] as string[]);
  const nativeFile = nativeFiles.find(file => file.endsWith('.node'));
  if (manifest?.pdfInspector !== PDF_INSPECTOR_VERSION || manifest.platform !== platform ||
      !(await fileExists(path.join(inspectorDir, 'index.js'))) || !nativeFile) {
    throw new BusinessError('E_RUNTIME_MISSING', '安装包中的 PDF 组件缺失或版本不匹配，请重新安装完整应用；开发环境请重新准备构建资源', 'TOOL_EXECUTION');
  }
  options.onRuntimeEvent?.({ stage: 'inspector_cached' });
  const pdfiumLib = options.needPdfium ? await findFileByName(path.join(runtimeDir, 'pdfium'), pins.pdfiumLibName) : null;
  if (options.needPdfium && !pdfiumLib) {
    throw new BusinessError('E_RUNTIME_MISSING', '安装包中的 PDFium 组件缺失，请重新安装完整应用', 'TOOL_EXECUTION');
  }
  if (pdfiumLib) {
    // 使用本次安装的库，避免旧缓存/继承环境变量把加载导向另一版本。
    process.env.PDFIUM_LIB_PATH = pdfiumLib;
    options.onRuntimeEvent?.({ stage: 'pdfium_ready' });
  }
  return { inspector: loadInspectorFromDir(inspectorDir, path.join(napiDir, nativeFile)), paths: { runtimeDir, inspectorDir, pdfiumLib } };
}
