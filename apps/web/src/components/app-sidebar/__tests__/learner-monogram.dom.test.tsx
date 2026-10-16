import { expect, it, mock } from 'bun:test';
import React from 'react';
import { act, setupDom } from '../../toc/__tests__/dom-setup.js';

/**
 * UI-R02-R1 P1 回归锁：档案入口与今日进度入口必须是大两同级原生 button，
 * 互不嵌套、互不冒泡。浏览器原生负责 Enter/Space 激活（无需 JS keydown），
 * 因此“不串动作”由“非嵌套结构 + click 各自一次”共同保证。
 */
it('monogram entries are sibling native buttons that never cross-trigger', async () => {
  if (process.env['LINGUA_MONOGRAM_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_MONOGRAM_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  mock.module('../../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  mock.module('../../magicui/index.js', () => ({ NumberTicker: ({ value }: { value: number }) => <span>{value}</span> }));
  const { LearnerMonogram } = await import('../LearnerMonogram.js');
  const doc = dom.dom.window.document;
  let opens = 0;
  let navs = 0;
  try {
    await act(async () => {
      dom.root.render(
        <LearnerMonogram
          collapsed={false}
          displayName="学习者"
          levelBadge="N2"
          streakDays={3}
          todayGoalLabel="今日目标进度"
          todayGoalPercent={20}
          onOpenProfile={() => { opens += 1; }}
          onGoToday={() => { navs += 1; }}
        />
      );
    });
    const profile = doc.querySelector<HTMLButtonElement>('button[aria-label="配置学员画像与每日打卡目标"]');
    const progress = doc.querySelector<HTMLButtonElement>('button[title="前往今日学习"]');
    expect(profile).toBeDefined();
    expect(progress).toBeDefined();
    // 原生 button 且互不嵌套：杜绝 keydown 冒泡串动作的结构基础
    expect(profile!.tagName).toBe('BUTTON');
    expect(progress!.tagName).toBe('BUTTON');
    expect(profile!.contains(progress!)).toBe(false);
    expect(progress!.contains(profile!)).toBe(false);

    await act(async () => profile!.click());
    expect([opens, navs]).toEqual([1, 0]);
    await act(async () => progress!.click());
    expect([opens, navs]).toEqual([1, 1]);
    // 再次激活仍各一次，不累积串扰
    await act(async () => profile!.click());
    await act(async () => progress!.click());
    expect([opens, navs]).toEqual([2, 2]);
  } finally {
    dom.teardown();
  }
}, 15000);

it('collapsed monogram keeps archive access without the progress entry', async () => {
  if (process.env['LINGUA_MONOGRAM_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_MONOGRAM_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  mock.module('../../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  mock.module('../../magicui/index.js', () => ({ NumberTicker: ({ value }: { value: number }) => <span>{value}</span> }));
  const { LearnerMonogram } = await import('../LearnerMonogram.js');
  const doc = dom.dom.window.document;
  let opens = 0;
  try {
    await act(async () => {
      dom.root.render(
        <LearnerMonogram
          collapsed
          displayName="学习者"
          levelBadge="N2"
          streakDays={3}
          todayGoalLabel="今日目标进度"
          todayGoalPercent={20}
          onOpenProfile={() => { opens += 1; }}
          onGoToday={() => {}}
        />
      );
    });
    const profile = doc.querySelector<HTMLButtonElement>('button[aria-label="配置学员画像与每日打卡目标"]');
    expect(profile).toBeDefined();
    expect(doc.querySelector('button[title="前往今日学习"]')).toBeNull();
    await act(async () => profile!.click());
    expect(opens).toBe(1);
  } finally {
    dom.teardown();
  }
}, 15000);
