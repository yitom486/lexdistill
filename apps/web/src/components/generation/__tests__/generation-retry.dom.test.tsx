import { expect, it } from 'bun:test';
import { bootDomBackend } from './generation-dom-harness.js';

const runIt = it as unknown as (name: string, ms: number, fn: () => Promise<void>) => void;

async function childMain() {
  const h = await bootDomBackend();
  try {
    await h.waitFor(() => h.doc.body.textContent?.includes('Test') === true);
    await h.click('开始出题');
    await h.waitFor(() => h.doc.body.textContent?.includes('She ___ a student.') === true);
    const mc = h.cardFor('She ___ a student.');
    await h.clickIn(mc, 'is');
    // 首次提交在网络层丢失，重试保持同一身份、答案与作答时长，后端只记一次。
    h.failNextObjectivePost();
    await h.clickIn(mc, '提交本题答案');
    await h.waitFor(() => mc.querySelector('[role="alert"]') !== null);
    expect(h.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
    await h.clickIn(mc, '提交本题答案');
    await h.waitFor(() => mc.textContent?.includes('回答正确') === true);
    const posts = h.answerPosts.filter(p => p.url.includes('/answers/objective'));
    expect(posts.length).toBeGreaterThanOrEqual(2);
    const first = posts[0]!.body;
    expect(posts.every(p => p.body['submissionId'] === first['submissionId'])).toBe(true);
    expect(posts.every(p => p.body['timeSpentMs'] === first['timeSpentMs'])).toBe(true);
    expect(posts.every(p => p.body['userAnswer'] === 'A')).toBe(true);
    expect(h.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
  } finally {
    await h.cleanup();
  }
}

runIt('AI 出题响应丢失重试保持同一提交身份', 60000, async () => {
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
