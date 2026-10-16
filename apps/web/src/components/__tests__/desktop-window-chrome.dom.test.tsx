import { afterEach, beforeEach, expect, it } from 'bun:test';
import * as React from 'react';
import { DesktopWindowChrome } from '../DesktopWindowChrome.js';
import { ErrorBoundary } from '../common/ErrorBoundary.js';
import { __resetPlatformForTest } from '../../platform/capabilities.js';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;

beforeEach(async () => {
  dom = await setupDom(true);
  __resetPlatformForTest();
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI__;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  __resetPlatformForTest();
  dom?.teardown();
  dom = undefined;
});

it('DesktopWindowChrome: Web 环境（非桌面端）静默不渲染', async () => {
  delete (window as unknown as Record<string, unknown>).__TAURI__;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  __resetPlatformForTest();

  await act(async () => {
    dom!.root.render(<DesktopWindowChrome />);
  });

  const chromeEl = dom!.dom.window.document.querySelector('[aria-label="窗口控制栏"]');
  expect(chromeEl).toBeNull();
});

it('DesktopWindowChrome: 桌面端渲染全局顶置层（z-[70]）且包含最小化/最大化/关闭按钮', async () => {
  Object.assign(window, {
    __TAURI__: {
      core: {
        invoke: async () => false,
      },
    },
  });
  __resetPlatformForTest();

  await act(async () => {
    dom!.root.render(<DesktopWindowChrome />);
  });

  const doc = dom!.dom.window.document;
  const chromeEl = doc.querySelector('[aria-label="窗口控制栏"]');
  expect(chromeEl).not.toBeNull();
  expect(chromeEl?.className).toContain('z-[70]');

  expect(doc.querySelector('[aria-label="最小化窗口"]')).not.toBeNull();
  expect(doc.querySelector('[aria-label="最大化窗口"]')).not.toBeNull();
  expect(doc.querySelector('[aria-label="关闭应用"]')).not.toBeNull();
});

it('ErrorBoundary: 全屏容灾在桌面端内置窗体控制条与系统容灾提示', async () => {
  Object.assign(window, {
    __TAURI__: {
      core: {
        invoke: async () => false,
      },
    },
  });
  __resetPlatformForTest();

  function CrashingComponent(): React.ReactElement {
    throw new Error('Fatal UI Crash');
  }

  await act(async () => {
    dom!.root.render(
      <ErrorBoundary variant="fullscreen">
        <CrashingComponent />
      </ErrorBoundary>
    );
  });

  const doc = dom!.dom.window.document;
  expect(doc.body.textContent).toContain('系统容灾模式');
  expect(doc.querySelector('[data-tauri-drag-region]')).not.toBeNull();
  expect(doc.querySelector('[aria-label="关闭应用"]')).not.toBeNull();
});

it('Sovereign Titlebar: DialogOverlay 与 SheetOverlay 严格位于顶栏下方，绝不侵入 top-14 / sm:top-15 顶栏主权区域', async () => {
  const { Dialog, DialogOverlay, DialogPortal } = await import('../ui/dialog.js');
  const { Sheet, SheetOverlay, SheetPortal } = await import('../ui/sheet.js');

  await act(async () => {
    dom!.root.render(
      <div>
        <Dialog open={true}>
          <DialogPortal container={dom!.dom.window.document.body}>
            <DialogOverlay data-testid="dialog-overlay" />
          </DialogPortal>
        </Dialog>
        <Sheet open={true}>
          <SheetPortal container={dom!.dom.window.document.body}>
            <SheetOverlay data-testid="sheet-overlay" />
          </SheetPortal>
        </Sheet>
      </div>
    );
    await new Promise((r) => setTimeout(r, 50));
  });

  const doc = dom!.dom.window.document;
  const dialogOverlay = doc.querySelector('[data-testid="dialog-overlay"]');
  expect(dialogOverlay?.className).toContain('top-14');
  expect(dialogOverlay?.className).toContain('sm:top-15');
  expect(dialogOverlay?.className).not.toContain('fixed inset-0');

  const sheetOverlay = doc.querySelector('[data-testid="sheet-overlay"]');
  expect(sheetOverlay?.className).toContain('top-14');
  expect(sheetOverlay?.className).toContain('sm:top-15');
  expect(sheetOverlay?.className).not.toContain('fixed inset-0');
});

