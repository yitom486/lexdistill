import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BusinessError } from '@lexdistill/shared';
import { ensurePdfRuntime, type PdfInspectorLike, type PdfRuntimePaths } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';

/**
 * PDF native E2E 测试运行时（测试拥有，显式 bootstrap，永不静默 skip）。
 *
 * 根因（P1-B 后取证）：native 用例曾完全依赖 ambient 用户态
 *（`~/.study-studio/runtime` 是否恰好存在且可加载），导致“同代码不同时间不同结果”，
 * 且失败面（E_RUNTIME_LOAD）与 runner/cwd 无关—— manifest 在但 inspector 不可加载即炸。
 * 本模块把 runtime 收归测试所有：
 * - 目录：只认 `STUDY_STUDIO_TEST_RUNTIME_DIR`，否则用 `apps/gateway/src/.test-runtime/`（gitignored）；
 * - 通用生产变量 `STUDY_STUDIO_RUNTIME_DIR` 一律无视（见 pinProcessToTestRuntime），
 *   避免开发者 shell 里 export 的生产路径把测试写进真 runtime；
 * - 测试前显式准备 pinned 构件，测试只读加载（原生 PDF 读取与按需查看，供扫描页用例），复用已下载；
 * - 缺失/损坏/离线导致无法就绪时直接抛（测试文件加载失败→非零退出），绝不 `it.skip`。
 * 生产 `~/.study-studio` 绝不作为测试状态读写。产品 `defaultRuntimeDir` 行为一字未动。
 */
export function testRuntimeDir(): string {
  const override = process.env.STUDY_STUDIO_TEST_RUNTIME_DIR;
  if (override && override.trim()) return override.trim();
  return resolve(import.meta.dir, '../../../.test-runtime');
}

/**
 * 把本进程的默认运行时钉到测试目录：无条件覆盖 `STUDY_STUDIO_RUNTIME_DIR`。
 * 产品代码只认该 env（见 defaultRuntimeDir），故一次设置即让所有 `{}` 空依赖调用
 * 走测试运行时；即使外部传入了指向生产 runtime 的该变量也会被改写——测试永不读写外部生产路径。
 * 仅测试 setup 模块调用（进程局部副作用）。
 */
export function pinProcessToTestRuntime(): string {
  const dir = testRuntimeDir();
  process.env.STUDY_STUDIO_RUNTIME_DIR = dir;
  process.env.STUDY_STUDIO_PDF_RUNTIME_DIR = dir;
  return dir;
}

let ready: Promise<{ inspector: PdfInspectorLike; paths: PdfRuntimePaths }> | null = null;

/** 确保测试运行时就绪（原生 PDF 读取与按需查看）；失败即抛，不 skip。失败时清 memo，允许调用方重试。 */
export function ensurePdfTestRuntime(): Promise<{ inspector: PdfInspectorLike; paths: PdfRuntimePaths }> {
  if (!ready) {
    ready = (async () => {
      const dir = testRuntimeDir();
      mkdirSync(dir, { recursive: true });
      try {
        return await ensurePdfRuntime({ runtimeDir: dir, needPdfium: true });
      } catch (e) {
        ready = null;
        const code = e instanceof BusinessError ? e.code : 'E_RUNTIME_UNKNOWN';
        throw new Error(
          `[pdf-test-runtime] 测试运行时 bootstrap 失败（${code}，目录=${dir}）：` +
            '先运行 bun run --filter @lexdistill/gateway pdf:prepare:test 准备组件。测试期间不联网补装，绝不静默跳过 native 用例。'
        );
      }
    })();
  }
  return ready;
}

/** 测试运行时 manifest 是否存在（仅诊断用，不做 skip 门）。 */
export function hasTestRuntimeManifest(): boolean {
  try {
    return existsSync(join(testRuntimeDir(), 'manifest.json'));
  } catch {
    return false;
  }
}
