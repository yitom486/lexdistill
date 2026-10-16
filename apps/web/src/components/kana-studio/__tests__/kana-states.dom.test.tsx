import { expect, it, mock } from 'bun:test';
import React from 'react';
import { act, setupDom } from '../../toc/__tests__/dom-setup.js';
import type { KanaStudioState } from '../../../hooks/useKanaStudio.js';

/**
 * UI-R03 假名状态与文案：加载/失败/空三态区分；localhost 诊断折叠；
 * 无假名表时自测入口禁用并说明原因；工程宣传措辞移除。
 */
function stubState(overrides: Record<string, unknown>): KanaStudioState {
  const noop = () => {};
  return {
    focusKanaIds: null,
    allKana: [],
    refetchKana: () => {},
    isKanaLoading: false,
    isKanaError: false,
    matrixTab: 'SEION',
    setMatrixTab: noop,
    scriptMode: 'HIRAGANA',
    setScriptMode: noop,
    showRomaji: true,
    setShowRomaji: noop,
    activeKana: null,
    setActiveKana: noop,
    isDrillActive: false,
    setIsDrillActive: noop,
    setSelectedOption: noop,
    setIsAnswered: noop,
    setDrillRound: noop,
    resetRoundStats: noop,
    setWordIndex: noop,
    setWordInput: noop,
    setWordStudyDone: noop,
    groupedByRow: [],
    handlePlayAudio: noop,
    handleSelectKana: noop,
    handleOpenKanaGuide: noop,
    handleOpenRowGuide: noop,
    adaptiveKanaQueueQuery: { isLoading: false },
    ...overrides,
  } as unknown as KanaStudioState;
}

it('kana header copy is action-oriented and drill needs real kana data', async () => {
  if (process.env['LINGUA_KANA_STATES_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_KANA_STATES_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  mock.module('../../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  mock.module('../../magicui/index.js', () => ({ NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
    ShimmerButton: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>, fireSuccessConfetti() {} }));
  const { KanaStudioHeader } = await import('../KanaStudioHeader.js');
  const doc = dom.dom.window.document;
  try {
    await act(async () => dom.root.render(<KanaStudioHeader state={stubState({})} />));
    expect(doc.body.textContent).toContain('假名入门');
    expect(doc.body.textContent).not.toContain('课程底座');
    expect(doc.body.textContent).not.toContain('熟练度回写');
    // 无数据：自测禁用并说明原因
    const drill = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes('启动假名自测')
    );
    expect(drill).toBeDefined();
    expect((drill as HTMLButtonElement).disabled).toBe(true);
    expect(drill!.title).toContain('暂无假名数据');

    // 有数据：可用并可进入
    let entered = 0;
    await act(async () => {
      dom.root.render(<KanaStudioHeader state={stubState({ allKana: [{}], setIsDrillActive: () => { entered += 1; } })} />);
    });
    const drillReady = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes('启动假名自测')
    );
    expect(drillReady).toBeDefined();
    expect((drillReady as HTMLButtonElement).disabled).toBe(false);
    await act(async () => drillReady!.click());
    expect(entered).toBe(1);

    // 已进入自测后即使数据变空：返回矩阵保持可用，单次退出
    let exited = 0;
    await act(async () => {
      dom.root.render(<KanaStudioHeader state={stubState({ isDrillActive: true, setIsDrillActive: () => { exited += 1; } })} />);
    });
    const backToMatrix = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes('返回假名矩阵')
    );
    expect(backToMatrix).toBeDefined();
    expect((backToMatrix as HTMLButtonElement).disabled).toBe(false);
    await act(async () => backToMatrix!.click());
    expect(exited).toBe(1);
  } finally { dom.teardown(); }
}, 15000);

it('kana matrix and drill-empty separate loading, failure and recovery', async () => {
  if (process.env['LINGUA_KANA_STATES_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_KANA_STATES_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  mock.module('../../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  mock.module('../../magicui/index.js', () => ({ NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
    ShimmerButton: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>, fireSuccessConfetti() {} }));
  const { KanaMatrix } = await import('../KanaMatrix.js');
  const { KanaDrillEmpty } = await import('../KanaDrillEmpty.js');
  const doc = dom.dom.window.document;
  let refetches = 0;
  let backToMatrix = 0;
  try {
    // 矩阵加载中：加载文案，无重试
    await act(async () => {
      dom.root.render(<KanaMatrix state={stubState({ isKanaLoading: true })} />);
    });
    expect(doc.body.textContent).toContain('正在加载假名表');
    expect(doc.querySelector('button')).toBeNull();

    // 矩阵失败（真实 isError）：故障文案 + 诊断 + 重试
    await act(async () => {
      dom.root.render(<KanaMatrix state={stubState({ isKanaError: true, refetchKana: () => { refetches += 1; } })} />);
    });
    expect(doc.body.textContent).toContain('假名表读取失败');
    const details = doc.querySelector('details');
    expect(details).not.toBeNull();
    expect(details!.textContent).toContain('localhost:8080');
    const retry = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === '重新加载'
    );
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(refetches).toBe(1);

    // 矩阵成功空：中性文案，不宣称网关故障，无诊断块
    await act(async () => {
      dom.root.render(<KanaMatrix state={stubState({})} />);
    });
    expect(doc.body.textContent).toContain('当前条件下暂无假名条目');
    expect(doc.querySelector('details')).toBeNull();
    expect(doc.body.textContent).not.toContain('网关');

    // 自测队列失败：故障文案 + 诊断 + 返回矩阵可用
    await act(async () => {
      dom.root.render(<KanaDrillEmpty state={stubState({
        adaptiveKanaQueueQuery: { isLoading: false, isError: true },
        setIsDrillActive: () => { backToMatrix += 1; },
      })} />);
    });
    expect(doc.body.textContent).toContain('自测题读取失败');
    expect(doc.querySelector('details')).not.toBeNull();
    expect(doc.body.textContent).not.toContain('当前暂无可练题目');
    const backOnError = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === '返回矩阵学习'
    );
    expect(backOnError).toBeDefined();
    await act(async () => backOnError!.click());
    expect(backToMatrix).toBe(1);

    // 自测队列成功空：中性文案，不宣称故障
    await act(async () => {
      dom.root.render(<KanaDrillEmpty state={stubState({
        adaptiveKanaQueueQuery: { isLoading: false, isError: false },
        setIsDrillActive: () => { backToMatrix += 1; },
      })} />);
    });
    expect(doc.body.textContent).toContain('当前暂无可练题目');
    expect(doc.querySelector('details')).toBeNull();
    expect(doc.body.textContent).not.toContain('网关');
    const back = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === '返回矩阵学习'
    );
    expect(back).toBeDefined();
    await act(async () => back!.click());
    expect(backToMatrix).toBe(2);
  } finally { dom.teardown(); }
}, 15000);
