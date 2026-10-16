import { expect, it, mock } from 'bun:test';
import React from 'react';
import { COURSE_UNITS, courseUnitPlanStep } from '@lexdistill/learner-core';
import { act, setupDom } from '../toc/__tests__/dom-setup.js';
import type { DailyStudyPlan } from '@lexdistill/learner-core';

/**
 * UI-R03 今日计划状态矩阵：首读 / 无数据失败 / 成功为空 / 真实零值 /
 * 有效数据 / 后台刷新中 / 刷新失败留缓存。仅读 query 状态，不自建状态机；
 * 重试走已有 refetch（只读），标记完成走原 mutation；未知与真实零不混用。
 */
it('today plan distinguishes unknown, empty, real zero, stale and refreshing', async () => {
  if (process.env['LINGUA_TODAY_STATES_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_TODAY_STATES_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  const greet = COURSE_UNITS.find(u => u.id === 'ja-u-greet')!;
  const refetchCalls: number[] = [];
  const mutateCalls: unknown[] = [];
  const planState: {
    data: DailyStudyPlan | null | undefined;
    isLoading: boolean;
    isError: boolean;
    isFetching: boolean;
  } = { data: undefined, isLoading: true, isError: false, isFetching: true };
  const inert = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
  mock.module('../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  mock.module('../magicui/index.js', () => ({ NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
    ShimmerButton: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>, fireSuccessConfetti() {} }));
  mock.module('../../queries/useLearnerQueries.js', () => ({
    useDailyPlanQuery: () => ({ ...planState, refetch: () => { refetchCalls.push(1); } }),
    useCompletePlanStepMutation: () => ({
      ...inert(),
      mutate: (args: unknown, opts?: { onSuccess?: () => void }) => { mutateCalls.push(args); opts?.onSuccess?.(); },
    }),
    useCourseRouteQuery: () => ({ data: null }),
    courseStageName: () => '零基础',
    useCardsQuery: () => ({ data: [] }), useUpdateCardMutation: inert,
    useMistakesQuery: () => ({ data: [] }),
    useQuestionsQuery: () => ({ data: [] }),
  }));
  const { TodayPlanWorkbench } = await import('../TodayPlanWorkbench.js');
  const doc = dom.dom.window.document;
  const render = async () => {
    await act(async () => dom.root.render(<TodayPlanWorkbench />));
  };
  const clickExact = async (label: string) => {
    const button = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label);
    expect(button, `missing button ${label}`).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    // 1. 首读：加载文案 + 未知占位，不出现确定性 0/0、0%，无数值进度条
    planState.data = undefined; planState.isLoading = true; planState.isError = false; planState.isFetching = true;
    await render();
    expect(doc.body.textContent).toContain('正在生成今日计划');
    expect(doc.body.textContent).toContain('计划暂未读取');
    expect(doc.body.textContent).not.toContain('0%');
    expect(doc.body.textContent).not.toContain('暂时无法读取今日计划');
    expect(doc.querySelectorAll('[role="progressbar"]').length).toBe(0);

    // 2. 无数据失败：错误面板 + 重试只读不写，无数值进度条
    planState.data = undefined; planState.isLoading = false; planState.isError = true; planState.isFetching = false;
    await render();
    expect(doc.body.textContent).toContain('暂时无法读取今日计划');
    expect(doc.body.textContent).not.toContain('0%');
    expect(doc.querySelectorAll('[role="progressbar"]').length).toBe(0);
    await clickExact('重试');
    expect(refetchCalls).toEqual([1]);
    expect(mutateCalls).toEqual([]);

    // 3. 成功为空：暂无安排，不喂 0%，无数值进度条
    planState.data = {
      id: 'p0', userId: 'u', language: 'ja', planDate: '2026-10-07',
      steps: [], completedCount: 0, totalCount: 0, createdAt: '2026-10-07',
    };
    planState.isLoading = false; planState.isError = false; planState.isFetching = false;
    await render();
    expect(doc.body.textContent).toContain('今日暂无安排');
    expect(doc.body.textContent).not.toContain('0%');
    expect(doc.querySelectorAll('[role="progressbar"]').length).toBe(0);

    // 4. 真实零值：0/1 与 0% 如实显示，进度条 aria-valuenow 为 0
    const step = { ...courseUnitPlanStep(greet), id: 's-zero', done: false, currentCount: 0, progressText: '0/3' };
    planState.data = {
      id: 'p1', userId: 'u', language: 'ja', planDate: '2026-10-07',
      steps: [step], completedCount: 0, totalCount: 1, createdAt: '2026-10-07',
    };
    await render();
    expect(doc.body.textContent).toContain('/ 1 步已达成');
    expect(doc.body.textContent).toContain('0%');
    {
      const bars = doc.querySelectorAll('[role="progressbar"]');
      expect(bars.length).toBe(1);
      expect(bars[0]!.getAttribute('aria-valuenow')).toBe('0');
    }

    // 5. 刷新失败留缓存：保留真实数值（1/3，aria 33）+ 说明非最新 + 重试
    planState.data = {
      id: 'p1', userId: 'u', language: 'ja', planDate: '2026-10-07',
      steps: [step], completedCount: 1, totalCount: 3, createdAt: '2026-10-07',
    };
    planState.isError = true; planState.isFetching = false;
    await render();
    expect(doc.body.textContent).toContain(step.title);
    expect(doc.body.textContent).toContain('可能不是最新');
    {
      const bars = doc.querySelectorAll('[role="progressbar"]');
      expect(bars.length).toBe(1);
      expect(bars[0]!.getAttribute('aria-valuenow')).toBe('33');
    }
    await clickExact('重试');
    expect(refetchCalls).toEqual([1, 1]);

    // 6. 后台刷新中：保留内容与真实数值 + 同步提示
    planState.isError = false; planState.isFetching = true;
    await render();
    expect(doc.body.textContent).toContain(step.title);
    expect(doc.body.textContent).toContain('正在同步最新进度');
    {
      const bars = doc.querySelectorAll('[role="progressbar"]');
      expect(bars.length).toBe(1);
      expect(bars[0]!.getAttribute('aria-valuenow')).toBe('33');
    }

    // 7. 标记完成仍走原 mutation（无 courseUnitId 的步骤），单次写入
    const plain = { ...courseUnitPlanStep(greet), id: 's-plain', courseUnitId: undefined, done: false, currentCount: 0 };
    planState.data = {
      id: 'p2', userId: 'u', language: 'ja', planDate: '2026-10-07',
      steps: [plain], completedCount: 0, totalCount: 1, createdAt: '2026-10-07',
    };
    planState.isFetching = false;
    await render();
    await clickExact('记录已完成活动');
    expect(mutateCalls.length).toBe(1);
    expect(mutateCalls[0]).toMatchObject({ stepId: 's-plain' });
  } finally { dom.teardown(); }
}, 15000);
