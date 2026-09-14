import type { LookupLanguage } from './selection-text.js';

/**
 * 查词浮层命令总线（极小发布订阅，无 React 依赖，可单测）。
 * 用途：阅读工具栏自有划选栏（标重点/转闪卡）想复用同一查词浮面时，
 * 经此总线发布请求，避免组件树层层透传坐标与文本。
 */

export interface LookupPopupRequest {
  text: string;
  language: LookupLanguage;
  /** 视口坐标（fixed 定位用）。 */
  x: number;
  y: number;
  /** P3-1 阅读上下文（可选）：阅读器透传当前文档，无则保持旧语义。 */
  documentId?: string | undefined;
}

type LookupPopupListener = (request: LookupPopupRequest | null) => void;

const listeners = new Set<LookupPopupListener>();

export function subscribeLookupPopup(listener: LookupPopupListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 打开发布（文本与语种由发布方保证已归一化）。 */
export function openLookupPopup(request: LookupPopupRequest): void {
  for (const listener of [...listeners]) {
    try {
      listener(request);
    } catch {
      // 单个订阅者异常不影响其他订阅者
    }
  }
}

/** 关闭发布。 */
export function closeLookupPopup(): void {
  for (const listener of [...listeners]) {
    try {
      listener(null);
    } catch {
      // 同上
    }
  }
}
