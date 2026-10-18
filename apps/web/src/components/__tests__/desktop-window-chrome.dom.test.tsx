import { afterEach, beforeEach, expect, it } from 'bun:test';
import * as React from 'react';
import { DesktopWindowChrome } from '../DesktopWindowChrome.js';
import { ErrorBoundary } from '../common/ErrorBoundary.js';
import { __resetPlatformForTest } from '../../platform/capabilities.js';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';

/**
 * 本文件的用例依赖全局 window/document 与 Base UI 的模态栈：
 * 与其余 90 多个 DOM 文件共用同一进程时会互相污染（弹层不再挂载）。
 * 因此按本仓既有做法在子进程里隔离跑，父进程只校验子进程退出码与输出。
 */
const IN_CHILD = process.env['LINGUA_WINDOW_CHROME_CHILD'] === '1';
const chromeIt = IN_CHILD ? it : it.skip;

if (!IN_CHILD) {
  it('window chrome dom suite (child isolation)', async () => {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_WINDOW_CHROME_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
  }, 60_000);
}

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

chromeIt('DesktopWindowChrome: Web 环境（非桌面端）静默不渲染', async () => {
  delete (window as unknown as Record<string, unknown>).__TAURI__;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  __resetPlatformForTest();

  await act(async () => {
    dom!.root.render(<DesktopWindowChrome />);
  });

  const chromeEl = dom!.dom.window.document.querySelector('[aria-label="窗口控制栏"]');
  expect(chromeEl).toBeNull();
});

chromeIt('DesktopWindowChrome: 桌面端渲染全局顶置层（z-[70]）且包含最小化/最大化/关闭按钮', async () => {
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

chromeIt('ErrorBoundary: 全屏容灾在桌面端内置窗体控制条与系统容灾提示', async () => {
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

chromeIt('Sovereign Titlebar: DialogOverlay 与 SheetOverlay 严格位于顶栏下方，绝不侵入 top-14 / sm:top-15 顶栏主权区域', async () => {
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
  // 固定 sleep 在机器负载高时可能早于 portal 提交，导致偶发 null；
  // 这里轮询到两个浮层都出现再断言（有上限，不会挂死）。
  const deadline = Date.now() + 3000;
  while (
    Date.now() < deadline &&
    (!doc.querySelector('[data-testid="dialog-overlay"]') || !doc.querySelector('[data-testid="sheet-overlay"]'))
  ) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  const dialogOverlay = doc.querySelector('[data-testid="dialog-overlay"]');
  const sheetOverlay = doc.querySelector('[data-testid="sheet-overlay"]');
  expect(dialogOverlay).not.toBeNull();
  expect(sheetOverlay).not.toBeNull();
  expect(dialogOverlay?.className).toContain('top-14');
  expect(dialogOverlay?.className).toContain('sm:top-15');
  expect(dialogOverlay?.className).not.toContain('fixed inset-0');

  expect(sheetOverlay?.className).toContain('top-14');
  expect(sheetOverlay?.className).toContain('sm:top-15');
  expect(sheetOverlay?.className).not.toContain('fixed inset-0');
});

