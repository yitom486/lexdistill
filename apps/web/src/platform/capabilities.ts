/**
 * 平台能力抽象层（P4-B）
 *
 * 把浏览器/桌面壳特有能力（下载文件、打开外链、写剪贴板、环境信息）收敛为统一接口，
 * 提供 Web 实现（浏览器 API）与 Tauri 实现（经 `window.__TAURI__` 调用桌面壳命令，失败回退 Web）。
 * 共享 TypeScript 领域层、协议与 UI 只依赖此接口，不直接触碰 `document`/`navigator`/`window.open`，
 * 保证 Web 与未来 Tauri 桌面端、移动端可复用同一 UI 与业务链路。
 *
 * 注意：TTS 与音效仍由 `utils/audio.ts` 的 `speechStudio`/`sound` 单例提供——它们基于 Web Speech /
 * Web Audio API，在 Tauri WebView 中同样可用，故不在此层重复抽象；如未来需要原生 TTS/音频外挂，
 * 可在此接口新增 `tts`/`audio` 委托并在 Tauri 实现中接管。
 */

import { TauriPlatformCapabilities } from './tauri-capabilities.js';
import { WebPlatformCapabilities } from './web-capabilities.js';

export type PlatformEnvironment = 'web' | 'tauri';
export interface DownloadPayload {
  filename: string;
  /** 文本内容；二进制下载请另设接口。 */
  content: string;
  mimeType?: string;
}

export interface PlatformCapabilities {
  readonly environment: PlatformEnvironment;
  isDesktop(): boolean;
  getUserAgent(): string;
  /** 下载/保存文本文件到本地。 */
  downloadFile(payload: DownloadPayload): Promise<void>;
  /** 用系统浏览器打开外链（而非 WebView 内跳转）。 */
  openExternalUrl(url: string): Promise<void>;
  /** 写入系统剪贴板。 */
  clipboardWriteText(text: string): Promise<void>;
}

/** Tauri v2 注入的全局对象最小形态（`withGlobalTauri` 启用时存在）。 */
interface TauriGlobalInternal {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: {
    core?: {
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  };
}

/** 是否运行在 Tauri 桌面壳内。 */
export function detectTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as TauriGlobalInternal;
  return '__TAURI_INTERNALS__' in w || Boolean(w.__TAURI__?.core?.invoke);
}

let resolved: PlatformCapabilities | null = null;

/** 获取当前平台能力单例（按运行环境自动选择实现）。 */
export function getPlatform(): PlatformCapabilities {
  if (!resolved) {
    resolved = resolvePlatformCapabilities();
  }
  return resolved;
}

/** 解析当前平台能力实现；导出主要供测试注入。 */
export function resolvePlatformCapabilities(): PlatformCapabilities {
  // 静态 import：tauri-capabilities 无外部静态依赖（只走 window.__TAURI__ 动态调用），
  // Web 构建可安全打包；浏览器 ESM 下 require 根本不存在，此前复制按钮点即抛错。
  if (detectTauri()) {
    return new TauriPlatformCapabilities();
  }
  return new WebPlatformCapabilities();
}

/** 仅供测试重置单例。 */
export function __resetPlatformForTest(): void {
  resolved = null;
}
