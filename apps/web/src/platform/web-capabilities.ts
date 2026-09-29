import type { DownloadPayload, PlatformCapabilities } from './capabilities.js';

/**
 * 浏览器平台能力实现：直接使用 Web API（Blob 下载、window.open、navigator.clipboard）。
 * 在 Tauri WebView 中这些 API 同样可用，故 Tauri 实现失败时也回退到这里。
 */
export class WebPlatformCapabilities implements PlatformCapabilities {
  readonly environment = 'web' as const;

  isDesktop(): boolean {
    return false;
  }

  getUserAgent(): string {
    if (typeof navigator === 'undefined') return 'unknown';
    return navigator.userAgent || 'unknown';
  }

  async downloadFile(payload: DownloadPayload): Promise<void> {
    if (typeof document === 'undefined') {
      throw new Error('downloadFile 不可用：当前环境无 DOM。');
    }
    const blob = new Blob([payload.content], {
      type: payload.mimeType ?? 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = payload.filename;
      a.rel = 'noopener';
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async openExternalUrl(url: string): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('openExternalUrl 不可用：当前环境无 window。');
    }
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      // 弹窗被拦截时回退到 location 跳转（仍优于静默失败）
      window.location.href = url;
    }
  }

  async clipboardWriteText(text: string): Promise<void> {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard) {
      try {
        await clipboard.writeText(text);
        return;
      } catch {
        // 剪贴板 API 被拒绝（权限/焦点/瞬时失败）时继续走传统通道，而非直接抛错。
      }
    }
    // 传统通道：隐藏 textarea + execCommand（权限受限 Chrome / Safari 兜底）。
    const doc = typeof document === 'undefined' ? undefined : document;
    const body = doc?.body;
    if (!doc || !body || typeof doc.execCommand !== 'function') {
      throw new Error('复制失败：浏览器拒绝了剪贴板写入，且当前环境无备用复制通道。');
    }
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    body.appendChild(area);
    try {
      area.focus();
      area.select();
      if (!doc.execCommand('copy')) {
        throw new Error('复制失败：浏览器拒绝了剪贴板写入，请手动复制诊断详情。');
      }
    } finally {
      body.removeChild(area);
    }
  }

  async pickFile(): Promise<string | null> {
    // 浏览器沙箱安全限制：纯 Web 环境无法直接获取文件在用户操作系统的物理绝对路径
    return null;
  }
}
