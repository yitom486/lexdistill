import { expect, it } from 'bun:test';
import React from 'react';
import { KANA_SEEDS } from '../../../../../../packages/storage-sqlite/src/seeds/kana-seed.js';
import { act, setupDom } from '../../toc/__tests__/dom-setup.js';

it('片假名讲自己的形状；遮答不泄露读音；切换字形重置练习且语音与导师接线正确', async () => {
  if (process.env['LINGUA_KANA_GUIDE_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_KANA_GUIDE_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  const { KanaCharacterGuideDialog } = await import('./KanaCharacterGuideDialog.js');
  const a = KANA_SEEDS.find((item) => item.id === 'kana_a')!;
  const calls: string[] = [];
  const doc = dom.dom.window.document;
  const click = async (text: string) => {
    const button = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text);
    expect(button).toBeDefined();
    await act(async () => { button!.click(); });
  };
  try {
    await act(async () => dom.root.render(<KanaCharacterGuideDialog open onOpenChange={() => undefined} kana={a} scriptMode="KATAKANA"
      onPlayAudio={(kana) => calls.push(`audio:${kana.id}`)}
      onPlayExample={(word) => calls.push(`word:${word.reading}`)}
      onAskTutor={(kana, script) => calls.push(`tutor:${kana.id}:${script}`)} />));
    const dialog = () => doc.querySelector('[role="dialog"]')!;
    expect(dialog().textContent).toContain('滑梯');
    expect(dialog().textContent).toContain('マ');
    expect(dialog().textContent).not.toContain('绳子');
    expect(dialog().textContent).not.toContain('草书');
    await click('朗读发音');
    const wordButton = doc.querySelector<HTMLButtonElement>('[aria-label="播放例词 アイス 的发音"]')!;
    await act(async () => wordButton.click());
    await click('AI 假名点拨');
    expect(calls).toEqual(['audio:kana_a', 'word:アイス', 'tutor:kana_a:KATAKANA']);

    await click('遮住提示，试着回忆');
    const recall = () => doc.querySelector('section[aria-label="遮住提示回忆"]')!;
    expect(recall().textContent).not.toContain('读 a');
    expect(recall().textContent).not.toContain('滑梯');
    await click('揭晓答案');
    expect(recall().querySelector('[role="status"]')!.textContent).toContain('读 a');
    await click('再次遮住答案');
    expect(recall().querySelector('[role="status"]')).toBeNull();
    await click('平假名 あ');
    expect(doc.querySelector('section[aria-label="遮住提示回忆"]')).toBeNull();
    expect(dialog().textContent).toContain('绳子');
    expect(dialog().textContent).not.toContain('滑梯');
    await click('AI 假名点拨');
    expect(calls.at(-1)).toBe('tutor:kana_a:HIRAGANA');
    await click('片假名 ア');
    await click('遮住提示，试着回忆');
    expect(recall().querySelector('[role="status"]')).toBeNull();
  } finally { dom.teardown(); }
}, 15000);
