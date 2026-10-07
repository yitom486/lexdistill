import { expect, it } from 'bun:test';
import { bootDomBackend } from './generation-dom-harness.js';

const runIt = it as unknown as (name: string, ms: number, fn: () => Promise<void>) => void;

async function flow() {
  const h = await bootDomBackend();
  try {
    await h.waitFor(() => h.doc.body.textContent?.includes('Test') === true);
    await h.click('开始出题');
    await h.waitFor(() => h.doc.body.textContent?.includes('She ___ a student.') === true);

    // 对话听力盲听隐藏台词；播放走 PCM 感知链路并记录时长。
    const dialogue = h.cardFor('What greeting?');
    expect(dialogue.querySelector('ol')).toBeNull();
    await h.clickIn(dialogue, '播放听力');
    await h.waitFor(() => h.played.length === 1);
    expect(h.audioFetches.some(url => url.includes('/audio/'))).toBe(true);
    await h.waitFor(() => h.activities.length === 1);
    expect(h.activities[0]?.['language']).toBe('en');
    const wavBlob = h.blobs[h.blobs.length - 1]!;
    expect(wavBlob.type).toBe('audio/wav');
    expect(wavBlob.size).toBe(2);

    // 短文听力走原始 PCM：包 WAV 头后可播（48 字节 + 44 字节头）。
    const passage = h.cardFor('What did you hear?');
    await h.clickIn(passage, '播放听力');
    await h.waitFor(() => h.played.length === 2);
    const pcmBlob = h.blobs[h.blobs.length - 1]!;
    expect(pcmBlob.type).toBe('audio/wav');
    expect(pcmBlob.size).toBe(48 + 44);

    // 复盘：已作答释放答案，未作答的对话台词保持隐藏。
    const mc = h.cardFor('She ___ a student.');
    await h.clickIn(mc, 'is');
    await h.clickIn(mc, '提交本题答案');
    await h.waitFor(() => mc.textContent?.includes('回答正确') === true);
    await h.click('查看复盘');
    await h.waitFor(() => h.doc.body.textContent?.includes('correctKey') === true);
    expect(h.doc.body.textContent).not.toContain('acceptedAnswers');
    expect(h.doc.body.textContent).not.toContain('Good morning.');
    await h.click('返回作答');
  } finally {
    await h.cleanup();
  }
}

runIt('AI 出题听力三模式播放与复盘释放', 60000, async () => {
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
