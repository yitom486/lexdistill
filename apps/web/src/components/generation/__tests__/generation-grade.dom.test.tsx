import { expect, it } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { bootDomBackend } from './generation-dom-harness.js';

const runIt = it as unknown as (name: string, ms: number, fn: () => Promise<void>) => void;

async function childMain() {
  const h = await bootDomBackend();
  try {
    await h.waitFor(() => h.doc.body.textContent?.includes('Test') === true);
    await h.click('开始出题');
    await h.waitFor(() => h.doc.body.textContent?.includes('She ___ a student.') === true);
    const translation = h.cardFor('Translate hello.');
    await h.typeIn(translation, '主观作答', 'hola');
    await h.clickIn(translation, '提交本题答案');
    await h.waitFor(() => translation.textContent?.includes('待批改') === true);
    await h.waitFor(() => [...translation.querySelectorAll('button')].some(
      b => b.getAttribute('aria-label') === '批改主观作答'));
    h.setGradeMode('error');
    await h.clickIn(translation, '批改主观作答');
    await h.waitFor(() => translation.textContent?.includes('重试批改') === true);
    h.setGradeMode('receipt', 85);
    await h.clickIn(translation, '批改主观作答');
    await h.waitFor(() => translation.textContent?.includes('85 分') === true);
    for (const post of h.gradePosts) {
      expect(post.body).not.toHaveProperty('score');
      expect(post.body).not.toHaveProperty('referenceAnswer');
    }
    expect(h.gradeCalls()).toBeGreaterThanOrEqual(2);
    const progress = await h.repo.getDailyTaskProgress(h.userId);
    if (!isOk(progress)) throw progress.error;
    expect((progress.value as { quizzesCount: number }).quizzesCount).toBe(1);
  } finally {
    await h.cleanup();
  }
}

runIt('AI 出题批改失败重试出分', 60000, async () => {
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
