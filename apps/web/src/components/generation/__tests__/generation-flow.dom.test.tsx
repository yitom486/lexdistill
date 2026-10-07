import { expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { bootDomBackend } from './generation-dom-harness.js';

const runIt = it as unknown as (name: string, ms: number, fn: () => Promise<void>) => void;

async function flow() {
  const h = await bootDomBackend();
  try {
    await h.waitFor(() => Boolean(h.doc.querySelector('button[aria-label="开始出题"]')));
    expect(h.doc.body.textContent).toContain('A1');
    await h.waitFor(() => h.doc.body.textContent?.includes('Test') === true);
    await h.click('开始出题');
    await h.waitFor(() => h.doc.body.textContent?.includes('She ___ a student.') === true);
    expect(h.doc.body.textContent).toContain('已完成');
    expect([...h.doc.querySelectorAll('div[aria-label^="题目"]')]).toHaveLength(8);

    const mc = h.cardFor('She ___ a student.');
    await h.clickIn(mc, 'is');
    await h.clickIn(mc, '提交本题答案');
    await h.waitFor(() => mc.textContent?.includes('回答正确') === true);
    expect(mc.textContent).toContain('A');

    const fill = h.cardFor('Fill the blank.');
    await h.clickIn(fill, '提交本题答案');
    await h.waitFor(() => fill.textContent?.includes('请先作答再提交') === true);
    await h.typeIn(fill, '填空答案', 'is');
    await h.clickIn(fill, '提交本题答案');
    await h.waitFor(() => fill.textContent?.includes('回答正确') === true);

    const reorder = h.cardFor('Put the sentence in order.');
    for (const chunk of ['She', 'is', 'a student.']) await h.clickIn(reorder, chunk);
    await h.clickIn(reorder, '提交本题答案');
    await h.waitFor(() => reorder.textContent?.includes('回答正确') === true);

    const translation = h.cardFor('Translate hello.');
    await h.typeIn(translation, '主观作答', 'hola');
    await h.clickIn(translation, '提交本题答案');
    await h.waitFor(() => translation.textContent?.includes('待批改') === true);

    const progress = await h.repo.getDailyTaskProgress(h.userId);
    if (!isOk(progress)) throw progress.error;
    expect((progress.value as { quizzesCount: number }).quizzesCount).toBeGreaterThanOrEqual(3);
  } finally {
    await h.cleanup();
  }
}

runIt('AI 出题创建→运行→作答记分', 60000, async () => {
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
