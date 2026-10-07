import { expect, it } from 'bun:test';
import { bootDomBackend } from './generation-dom-harness.js';

const runIt = it as unknown as (name: string, ms: number, fn: () => Promise<void>) => void;

async function childMain() {
  const h = await bootDomBackend();
  try {
    await h.waitFor(() => h.doc.body.textContent?.includes('Test') === true);
    await h.click('开始出题');
    await h.waitFor(() => h.doc.body.textContent?.includes('She ___ a student.') === true);
    const fill = h.cardFor('Fill the blank.');
    await h.typeIn(fill, '填空答案', 'is');
    await h.clickIn(fill, '提交本题答案');
    await h.waitFor(() => fill.textContent?.includes('回答正确') === true);
    const translation = h.cardFor('Translate hello.');
    await h.typeIn(translation, '主观作答', 'hola');
    await h.clickIn(translation, '提交本题答案');
    await h.waitFor(() => translation.textContent?.includes('待批改') === true);
    await h.remount();
    await h.waitFor(() => Boolean([...h.doc.querySelectorAll('button')].find(b => b.textContent === 'A1 · COMPLETED · 1 卷')));
    await h.click('A1 · COMPLETED · 1 卷');
    await h.waitFor(() => h.doc.body.textContent?.includes('Fill the blank.') === true);
    const fill2 = h.cardFor('Fill the blank.');
    const restored = [...fill2.querySelectorAll('input')].find(e => e.getAttribute('aria-label') === '填空答案') as HTMLInputElement;
    expect(restored?.value).toBe('is');
    await h.waitFor(() => fill2.textContent?.includes('已作答') === true);
    const translation2 = h.cardFor('Translate hello.');
    const restoredText = [...translation2.querySelectorAll('textarea')].find(e => e.getAttribute('aria-label') === '主观作答') as HTMLTextAreaElement;
    expect(restoredText?.value).toBe('hola');
    await h.waitFor(() => translation2.textContent?.includes('待批改') === true);
    expect(translation2.textContent).toContain('hola');
  } finally {
    await h.cleanup();
  }
}

runIt('AI 出题重开后恢复作答与批改态', 60000, async () => {
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
