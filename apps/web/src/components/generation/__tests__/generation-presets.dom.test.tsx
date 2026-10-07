import { expect, it } from 'bun:test';
import { bootDomBackend } from './generation-dom-harness.js';

const runIt = it as unknown as (name: string, ms: number, fn: () => Promise<void>) => void;

async function childMain() {
  const h = await bootDomBackend();
  try {
    await h.waitFor(() => h.doc.body.textContent?.includes('Test') === true);
    // 无错题时建议综合练习（可见默认值），应用后预算说明同步。
    await h.waitFor(() => h.doc.body.textContent?.includes('预设综合练习') === true);
    await h.click('应用建议');
    await h.waitFor(() => h.doc.body.textContent?.includes('最多新生成 8 题') === true);
    expect(h.doc.body.textContent).toContain('最终试卷固定 8 题');
    // 切到听力专项：预算说明同步变化（弹窗选择带重试）。
    const trigger = [...h.doc.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '出题预设');
    expect(trigger).toBeDefined();
    const { act } = await import('../../toc/__tests__/dom-setup.js');
    const win = h.doc.defaultView as unknown as typeof window;
    let switched = false;
    for (let round = 0; round < 8 && !switched; round++) {
      await h.click('出题预设');
      await h.waitFor(() => Boolean([...h.doc.querySelectorAll('[role="option"]')].find(o => o.textContent === '听力专项')));
      const listbox = h.doc.querySelector('[role="listbox"]') as HTMLElement;
      expect(listbox).toBeDefined();
      await act(async () => {
        // 键盘直达目标项：输入可区分前缀后回车确认。
        listbox.dispatchEvent(new win.KeyboardEvent('keydown', { key: '听', bubbles: true }));
        await new Promise(r => setTimeout(r, 20));
        listbox.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      await h.settle();
      switched = h.doc.body.textContent?.includes('最多新生成 4 题') === true;
    }
    expect(switched).toBe(true);
    // 非法微调（听力形式之和 5 不等于听力 4）被后端拒绝并原文展示。
    const dialogue = [...h.doc.querySelectorAll('input')].find(e => e.getAttribute('aria-label') === '听力 DIALOGUE') as HTMLInputElement;
    expect(dialogue).toBeDefined();
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set?.call(dialogue, '3');
      dialogue.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    await h.settle();
    expect(dialogue.value).toBe('3');
    await h.click('开始出题');    await h.waitFor(() => h.resolvePosts.length >= 1);
    await h.waitFor(() => h.doc.body.textContent?.includes('Listening mode counts') === true);
    // 改回合法组合后完成后：四段听力齐备。
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set?.call(dialogue, '2');
      dialogue.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    await h.settle();
    await h.click('开始出题');
    await h.waitFor(() => h.doc.body.textContent?.includes('What greeting?') === true);
    expect(h.doc.body.textContent).toContain('已完成');
    expect([...h.doc.querySelectorAll('button')].filter(b => b.textContent === '播放听力')).toHaveLength(4);
    expect(h.doc.body.textContent).toContain('What did you hear?');
    expect(h.doc.body.textContent).toContain('What is the news?');
  } finally {
    await h.cleanup();
  }
}

runIt('AI 出题预设切换、建议应用与非法微调拒绝', 60000, async () => {
  if (process.env['LINGUA_GENERATION_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--timeout', '60000', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_GENERATION_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  await childMain();
});
