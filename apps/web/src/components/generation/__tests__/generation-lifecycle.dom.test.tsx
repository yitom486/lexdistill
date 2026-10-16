import { expect, it } from 'bun:test';
import { bootDomBackend } from './generation-dom-harness.js';

const runIt = it as unknown as (name: string, ms: number, fn: () => Promise<void>) => void;

async function flow() {
  const h = await bootDomBackend();
  try {
    expect((h.doc.defaultView as unknown as Record<string, unknown> | undefined)?.['__TAURI__']).toBeUndefined();
    await h.waitFor(() => h.doc.body.textContent?.includes('Test') === true);
    await h.click('开始出题');
    await h.waitFor(() => Boolean([...h.doc.querySelectorAll('button')].find(b => b.textContent === '新建任务')));

    // 失败任务展示后台失败码。
    await h.click('新建任务');
    await h.waitFor(() => Boolean(h.doc.querySelector('button[aria-label="开始出题"]')));
    h.flags.failNext = true;
    await h.click('开始出题');
    try {
      await h.waitFor(() => h.doc.body.textContent?.includes('后台出题失败') === true);
    } catch (cause) {
      console.error('Failure-state DOM:', h.doc.body.textContent);
      throw cause;
    }

    // 取消进行中任务并确认状态。
    await h.click('新建任务');
    await h.waitFor(() => Boolean(h.doc.querySelector('button[aria-label="开始出题"]')));
    h.flags.slowNext = true;
    await h.click('开始出题');
    await h.waitFor(() => Boolean([...h.doc.querySelectorAll('button')].find(b => b.textContent === '取消任务')));
    await h.click('取消任务');
    await h.waitFor(() => h.doc.body.textContent?.includes('已取消') === true);

    // 断开重开：卸载后重挂，任务列表可重开已完成任务。
    await h.remount();
    await h.waitFor(() => Boolean([...h.doc.querySelectorAll('button')].find(b => b.textContent === 'A1 · COMPLETED · 1 卷')));
    const reopenButton = [...h.doc.querySelectorAll('button')].find(b => b.textContent === 'A1 · COMPLETED · 1 卷');
    expect(reopenButton).toBeDefined();
    await h.click('A1 · COMPLETED · 1 卷');
    await h.waitFor(() => h.doc.body.textContent?.includes('She ___ a student.') === true);
  } finally {
    await h.cleanup();
  }
}

runIt('AI 出题失败展示、取消与断开重开', 60000, async () => {
  if (process.env['LINGUA_GENERATION_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--timeout', '60000', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_GENERATION_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  await flow();
});
