/**
 * P3.5-FIX2 DOM 测试基座（jsdom + React act；仅测试用）。
 *
 * 教训：
 * - react-dom 必须在 jsdom 全局量就位后动态导入（模块级 input 事件快照）；
 * - window/document/navigator 等关键全局必须强制覆盖（其他测试可能残留
 *   undefined 占位，跳过式复制会沿用毒全局导致 window.event 崩溃），用完恢复；
 * - 事件构造器必须用 jsdom 的（Bun 原生 Event 进 jsdom dispatch 会被拒收）；
 * - 退出时删回注入键、恢复覆盖键，不污染后续测试文件。
 */
import { JSDOM } from 'jsdom';
import { act } from 'react';
import type { Root } from 'react-dom/client';

const FORCED_KEYS = [
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'HTMLElement',
  'Element',
  'Node',
  'Document',
  'DocumentFragment',
  'getComputedStyle',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'InputEvent',
  'FocusEvent',
  'CustomEvent',
  'PointerEvent',
  'WheelEvent',
];

export interface DomHandle {
  dom: JSDOM;
  root: Root;
  container: Element;
  teardown(): void;
}

let createRootFn: ((container: Element) => Root) | null = null;

export async function setupDom(visual = false): Promise<DomHandle> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: visual,
  });
  const win = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as Record<string, unknown>;
  const injected: string[] = [];
  const overridden = new Map<string, unknown>();
  const remember = (key: string): void => {
    if (injected.includes(key) || overridden.has(key)) return;
    if (key in g) overridden.set(key, g[key]);
    else injected.push(key);
  };
  for (const key of Object.getOwnPropertyNames(win)) {
    if (FORCED_KEYS.includes(key)) continue;
    if (key in g) continue;
    try {
      g[key] = win[key];
      injected.push(key);
    } catch {
      /* 只读内建跳过 */
    }
  }
  for (const key of FORCED_KEYS) {
    if (win[key] === undefined && key !== 'window' && key !== 'self') continue;
    try {
      remember(key);
      g[key] = key === 'window' || key === 'self' ? win : win[key];
    } catch {
      /* ignore */
    }
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;
  if (!g.matchMedia) {
    g.matchMedia = () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  }
  if (!createRootFn) {
    const mod = await import('react-dom/client');
    createRootFn = mod.createRoot as (container: Element) => Root;
  }
  const container = (win.document as Document).getElementById('root');
  if (!container) throw new Error('no root container');
  const root = createRootFn(container);
  const teardown = (): void => {
    try {
      act(() => {
        root.unmount();
      });
    } catch {
      /* ignore */
    }
    dom.window.close();
    for (const key of injected.splice(0)) {
      try {
        delete g[key];
      } catch {
        /* ignore */
      }
    }
    for (const [key, value] of overridden) {
      try {
        g[key] = value;
      } catch {
        /* ignore */
      }
    }
    overridden.clear();
  };
  return { dom, root, container, teardown };
}

export { act };
