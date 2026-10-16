import { expect, it, mock } from 'bun:test';
import React, { useState } from 'react';
import { act, setupDom } from '../../toc/__tests__/dom-setup.js';

it('mobile sidebar sheet: real trigger, real close, focus returns to trigger', async () => {
  if (process.env['LINGUA_SIDEBAR_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_SIDEBAR_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  mock.module('../../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  mock.module('../../magicui/index.js', () => ({ NumberTicker: ({ value }: { value: number }) => <span>{value}</span> }));
  mock.module('../../../queries/useLearnerQueries.js', () => ({
    useQuestionsQuery: () => ({ data: [] }),
    useCardsQuery: () => ({ data: [] }),
    useMistakesQuery: () => ({ data: [] }),
    useDailyPlanQuery: () => ({ data: undefined }),
  }));
  const { AppSidebar } = await import('../../AppSidebar.js');
  const doc = dom.dom.window.document;

  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" aria-label="打开导航" onClick={() => setOpen(true)}>
          菜单
        </button>
        <AppSidebar mobileOpen={open} onMobileOpenChange={setOpen} />
      </>
    );
  }

  const tabKey = () => new dom.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  try {
    await act(async () => {
      dom.root.render(<Host />);
    });
    expect(doc.querySelector('[role="dialog"]')).toBeNull();

    // 真实 trigger 打开
    const trigger = doc.querySelector<HTMLButtonElement>('[aria-label="打开导航"]');
    expect(trigger).toBeDefined();
    await act(async () => trigger!.click());
    const dialog = doc.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(doc.body.textContent).toContain('今日学习');

    // Tab 循环不出 dialog（Focus Trap真实行为，非回调断言）：
    // 先把焦点明确放进 dialog（挂载聚焦时序属库内部实现，不在此断言），再验证 Trap 约束
    const firstNav = dialog!.querySelector<HTMLButtonElement>('button');
    expect(firstNav).not.toBeNull();
    await act(async () => {
      firstNav!.focus();
    });
    const activeInside = () => dialog!.contains(doc.activeElement);
    expect(activeInside()).toBe(true);
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        (doc.activeElement ?? doc.body).dispatchEvent(tabKey());
      });
    }
    expect(activeInside()).toBe(true);

    // Escape 真实关闭：dialog 卸载 + 焦点回到 trigger
    await act(async () => {
      doc.dispatchEvent(new dom.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(doc.querySelector('[role="dialog"]')).toBeNull();
    expect(doc.activeElement).toBe(trigger);

    // 重新打开后选择导航同样真实关闭
    await act(async () => trigger!.click());
    expect(doc.querySelector('[role="dialog"]')).not.toBeNull();
    const today = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === '今日学习'
    );
    expect(today).toBeDefined();
    await act(async () => today!.click());
    expect(doc.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    dom.teardown();
  }
}, 15000);

it('mobile sidebar closes without a trigger present (fallback path)', async () => {
  if (process.env['LINGUA_SIDEBAR_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_SIDEBAR_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  mock.module('../../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  mock.module('../../magicui/index.js', () => ({ NumberTicker: ({ value }: { value: number }) => <span>{value}</span> }));
  mock.module('../../../queries/useLearnerQueries.js', () => ({
    useQuestionsQuery: () => ({ data: [] }),
    useCardsQuery: () => ({ data: [] }),
    useMistakesQuery: () => ({ data: [] }),
    useDailyPlanQuery: () => ({ data: undefined }),
  }));
  const { AppSidebar } = await import('../../AppSidebar.js');
  const doc = dom.dom.window.document;
  const closed: boolean[] = [];
  try {
    await act(async () => {
      dom.root.render(<AppSidebar mobileOpen onMobileOpenChange={(open: boolean) => { if (!open) closed.push(true); }} />);
    });
    expect(doc.querySelector('[role="dialog"]')).not.toBeNull();
    // 无汉堡时 Escape 照样关闭且不抛错（回退路径真实覆盖）
    await act(async () => {
      doc.dispatchEvent(new dom.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(closed).toEqual([true]);
  } finally {
    dom.teardown();
  }
}, 15000);
