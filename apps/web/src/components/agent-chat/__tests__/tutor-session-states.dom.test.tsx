import { expect, it, mock } from 'bun:test';
import React, { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';
/**
 * UI-R07 助教会话边界：受控网关 + 真容器行为（非浅层 markup）。
 * 覆盖：欢迎语去内部术语、两导师会话归属隔离、未连接/连接/流式/失败/重试/
 * 中断停止、审批、关闭后面板不可 Tab 到达 + 焦点恢复、重开不隐式新请求、
 * 手动阅读粘底。隔离环境，不碰用户历史/运行时配置，不调付费 AI/TTS。
 */

const BANNED = ['Gateway', '台账', 'thread', 'ephemeral', 'steer', '流式推送', '骨架', 'interim'];

if (process.env['LINGUA_TUTOR_CHILD'] !== '1') {
  it('tutor session states (child isolation)', async () => {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_TUTOR_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
  }, 20_000);
} else {

let dom: DomHandle | undefined;

async function freshDom() {
  dom?.teardown();
  dom = await setupDom(true);
  // jsdom 无滚动布局：补 scrollIntoView 空实现（真实浏览器原生支持，不改产品代码）
  const el = (globalThis as Record<string, unknown>)['Element'] as { prototype: { scrollIntoView?: unknown } } | undefined;
  if (el && typeof el.prototype.scrollIntoView !== 'function') {
    el.prototype.scrollIntoView = function () {};
  }
  return dom;
}

function mockInfra() {
  mock.module('../../../utils/audio.js', () => ({
    sound: { playClick() {}, playCorrect() {}, playMistake() {} },
  }));
  mock.module('sonner', () => ({
    toast: { info() {}, error() {}, success() {}, warning() {} },
  }));
  mock.module('../../UnifiedTtsPlayer.js', () => ({
    UnifiedTtsPlayer: () => null,
  }));
  mock.module('../magicui/index.js', () => ({
    BorderBeam: () => null,
  }));
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

it('欢迎语与轨道文案不含内部术语', async () => {
  const { buildTutorFreeGreeting, buildTutorOpeningGreeting, getTutorTrackCopy } = await import('../../../copy/tutor-track-copy.js');
  const ctx = { questionText: 'Q', correctAnswer: 'A', userAnswer: 'B', explanation: '因为…', skillTag: '助词' };
  const texts = [
    buildTutorFreeGreeting('ja'),
    buildTutorFreeGreeting('en'),
    buildTutorOpeningGreeting('ja', ctx, false),
    buildTutorOpeningGreeting('ja', ctx, true),
    getTutorTrackCopy('ko').headerHint,
    getTutorTrackCopy('en').headerHint,
  ];
  for (const t of texts) {
    for (const banned of BANNED) {
      expect(t.includes(banned)).toBe(false);
    }
  }
  // 离线欢迎语给出可操作后路（重发），不是死胡同
  expect(buildTutorOpeningGreeting('ja', ctx, true)).toContain('重发');
});

it('两导师会话归属隔离：题目 EXPLAIN/QUESTION vs 自由 FREE_COACH', async () => {
  const { buildTutorClientSnapshot } = await import('../../ai-tutor/tutorSnapshot.js');
  const { buildCoachClientSnapshot } = await import('../coachSnapshot.js');
  const tutor = buildTutorClientSnapshot(
    { questionText: 'Q', correctAnswer: 'A', userAnswer: 'B', explanation: 'E', skillTag: '助词' },
    'QUIZ',
    { targetLanguage: 'ja', overallLevel: 'N3' }
  );
  expect(tutor.userIntentHint).toBe('EXPLAIN');
  expect((tutor.focus as { kind: string }).kind).toBe('QUESTION');
  const coach = buildCoachClientSnapshot({ track: 'ja', learnerLevel: 'N3', activeTab: 'QUIZ', readingDocumentId: null, readingSurface: null });
  expect(coach.userIntentHint).toBe('FREE_COACH');
  expect('focus' in coach).toBe(false);
  const coachReading = buildCoachClientSnapshot({ track: 'ja', learnerLevel: 'N3', activeTab: 'READING', readingDocumentId: 'd1', readingSurface: '课文' });
  expect((coachReading.focus as { kind: string }).kind).toBe('READING_PASSAGE');
  expect(JSON.stringify(coachReading)).not.toContain('QUESTION');
});

it('面板位置归一化：默认右上 + 视口钳制', async () => {
  const { resolvePanelPos } = await import('../../ai-tutor/useDragPanel.js');
  expect(resolvePanelPos(null, 448, { w: 1440, h: 900 })).toEqual({ right: 16, top: 99 });
  const clamped = resolvePanelPos({ right: -10000, top: 5000 }, 448, { w: 1440, h: 900 });
  expect(clamped.right).toBe(-(448 - 120));
  expect(clamped.top).toBe(900 - 60);
});

it('自由导师轮次：离线→在线→steer→中断→审批→重试', async () => {
  await freshDom();
  mockInfra();
  const { useChatTurn } = await import('../use-chat-turn.js');
  const doc = dom!.dom.window.document;
  const holder: { current: any } = { current: null };

  function makeFakeGateway(connected: boolean) {
    const calls = { sendTurnStream: [] as any[], queue: [] as any[], steer: [] as any[], interrupt: [] as any[], approval: [] as any[] };
    let captured: any = null;
    const gateway = {
      isConnected: connected,
      sendTurnStream: (opts: any) => { calls.sendTurnStream.push(opts); captured = opts; return true; },
      startQueueStream: (opts: any) => { calls.queue.push(opts); captured = opts; return true; },
      interruptTurn: (lane?: string) => { calls.interrupt.push(lane); },
      steerTurn: (msg: string, lane?: string) => { calls.steer.push([msg, lane]); },
      respondApproval: (id: string, d: string) => { calls.approval.push([id, d]); },
    };
    return { calls, gateway, getCaptured: () => captured };
  }

  const conduit = makeFakeGateway(false);
  let coachThread = '';
  const client = makeClient();
  const stateOf = () => holder.current.getState();

  function Harness({ gw }: { gw: any }) {
    const [messages, setMessages] = useState<any[]>([]);
    const [busy, setBusy] = useState(false);
    const [health, setHealth] = useState<any>({ state: 'idle' });
    const [input, setInput] = useState('');
    const queueDrainRef = useRef(false);
    const lastPrompt = useRef<string | null>(null);
    const queryClient = useQueryClient();
    const api = useChatTurn({
      gateway: gw, busy, setBusy, setMessages, setAgentTurnHealth: setHealth,
      queueDrainRef, lastCoachPromptRef: lastPrompt, snapshot: () => ({}),
      track: 'ja', setInput, coachModelId: '', coachEffort: '', coachApprovalPolicy: 'never',
      coachThreadId: '', coachPersistThread: true, coachCollaborationMode: '',
      setCoachThreadId: (v: string) => { coachThread = v; }, queryClient, refetchAgentStatus: () => {},
    });
    useEffect(() => {
      holder.current = { ...api, getState: () => ({ messages, busy, health, input }) };
    });
    return null;
  }

  await act(async () => {
    dom!.root.render(<QueryClientProvider client={client}><Harness gw={conduit.gateway} /></QueryClientProvider>);
  });

  // 离线发送：不调网关，落本地兜底 + 可读失败态
  await act(async () => { await holder.current.send('助词に和で的区别'); });
  expect(conduit.calls.sendTurnStream.length).toBe(0);
  expect(stateOf().health.state).toBe('failed');
  expect(stateOf().health.message).toContain('导师服务未连接');
  expect(stateOf().messages.length).toBe(2);

  // 上线：FREE_COACH + coach 通道
  const online = makeFakeGateway(true);
  await act(async () => {
    dom!.root.render(<QueryClientProvider client={client}><Harness gw={online.gateway} /></QueryClientProvider>);
  });
  await act(async () => { await holder.current.send('请讲透「から」的用法'); });
  expect(online.calls.sendTurnStream.length).toBe(1);
  expect(online.getCaptured().intent).toBe('FREE_COACH');
  expect(online.getCaptured().agentOptions.lane).toBe('coach');
  expect(stateOf().busy).toBe(true);

  // 生成中追问走 steer，不新开轮次
  await act(async () => { await holder.current.send('再补一个例句'); });
  expect(online.calls.steer).toEqual([['再补一个例句', 'coach']]);
  expect(online.calls.sendTurnStream.length).toBe(1);

  // 流式增量落气泡
  await act(async () => { online.getCaptured().onDelta('から', 'から表示起点'); });
  expect(stateOf().messages.some((m: any) => m.text === 'から表示起点')).toBe(true);

  // 审批：挂起卡 + 本地即时接受态
  await act(async () => {
    online.getCaptured().onApprovalRequest({ approvalId: 'a1', action: '查词', description: '查「から」', riskLevel: 'low' });
  });
  expect(stateOf().messages.some((m: any) => m.approval?.status === 'pending')).toBe(true);
  await act(async () => { holder.current.respondApproval('a1', 'accept'); });
  expect(online.calls.approval).toEqual([['a1', 'accept']]);
  expect(stateOf().messages.find((m: any) => m.approval?.approvalId === 'a1').approval.status).toBe('accepted');

  // 中断真正停止：调网关中断 + 清 streaming + 不忙
  const cancelledTurn = online.getCaptured();
  await act(async () => { holder.current.interrupt(); });
  expect(online.calls.interrupt).toEqual(['coach']);
  expect(stateOf().busy).toBe(false);
  expect(stateOf().messages.every((m: any) => !m.streaming)).toBe(true);
  await act(async () => { cancelledTurn.onDelta('迟到', '取消后不应出现'); });
  expect(stateOf().messages.every((m: any) => !m.streaming)).toBe(true);
  expect(stateOf().messages.some((m: any) => m.text === '取消后不应出现')).toBe(false);

  // 完成结算：线程归属 + 健康态
  await act(async () => { await holder.current.send('第二问'); });
  await act(async () => { cancelledTurn.onComplete({ finalOutput: '旧结果', threadId: 'wrong-thread' }); });
  expect(coachThread).toBe('');
  expect(stateOf().busy).toBe(true);
  await act(async () => {
    online.getCaptured().onComplete({ status: 'COMPLETED', outcome: 'streamed', finalOutput: '答：…', threadId: 't-coach-1', queueRemaining: 0 });
  });
  expect(coachThread).toBe('t-coach-1');
  expect(stateOf().health.state).toBe('healthy');
  expect(stateOf().busy).toBe(false);

  // 重试重发上一问，不静默换通道
  const before = online.calls.sendTurnStream.length;
  await act(async () => { holder.current.retryLastAgentTurn(); });
  expect(online.calls.sendTurnStream.length).toBe(before + 1);
  expect(online.getCaptured().agentOptions.lane).toBe('coach');
  await act(async () => { holder.current.interrupt(); holder.current.startQueuedTurn(); });
  const queued = online.getCaptured();
  await act(async () => { queued.onComplete({ finalOutput: '队列回复', queueRemaining: 1 }); });
  await act(async () => { holder.current.interrupt(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  expect(online.calls.queue).toHaveLength(1);

  client.clear();
  void doc;
});

it('题目导师流：离线不发送 + 在线 EXPLAIN/learning + 中断 + 离线重发', async () => {
  await freshDom();
  mockInfra();
  const { useTutorStream } = await import('../../ai-tutor/useTutorStream.js');
  const holder: { current: any } = { current: null };

  function Harness({ gw }: { gw: any }) {
    const api = useTutorStream({ gateway: gw, buildSnapshot: () => ({}) });
    useEffect(() => { holder.current = api; });
    return null;
  }

  const offlineGw = { isConnected: false, sendTurnStream: () => true, connect: () => {}, interruptTurn: () => {} };
  await act(async () => { dom!.root.render(<Harness gw={offlineGw} />); });
  expect(holder.current.attachStreamToMessage('m1', '你好', 'EXPLAIN')).toBe(false);

  const calls: any[] = [];
  const interrupts: string[] = [];
  let captured: any = null;
  const onlineGw = {
    isConnected: true,
    sendTurnStream: (opts: any) => { calls.push(opts); captured = opts; return true; },
    connect: () => {}, interruptTurn: (lane: string) => { interrupts.push(lane); },
  };
  await act(async () => { dom!.root.render(<Harness gw={onlineGw} />); });
  await act(async () => {
    holder.current.setMessages([{ id: 'm1', sender: 'ai', text: '', timestamp: '刚刚', isStreaming: true }]);
  });
  const sent = holder.current.attachStreamToMessage('m1', '请解释', 'EXPLAIN');
  expect(sent).toBe(true);
  expect(calls[0].intent).toBe('EXPLAIN');
  expect(calls[0].agentOptions.lane).toBe('learning');
  await act(async () => { captured.onComplete({ finalOutput: '讲完了', outcome: 'streamed' }); });
  const done = holder.current.messages.find((m: any) => m.id === 'm1');
  expect(done.isStreaming).toBe(false);
  expect(done.source).toBe('streamed');

  await act(async () => {
    holder.current.setMessages([{ id: 'm2', sender: 'ai', text: '一半', timestamp: '刚刚', isStreaming: true }]);
    holder.current.attachStreamToMessage('m2', '第二问');
  });
  const cancelled = captured;
  await act(async () => { holder.current.interruptStream(); });
  const stopped = holder.current.messages.find((m: any) => m.id === 'm2');
  expect(stopped.isStreaming).toBe(false);
  expect(stopped.text).toContain('终止');
  expect(interrupts).toEqual(['learning']);
  await act(async () => {
    holder.current.setMessages([{ id: 'm3', sender: 'ai', text: '', timestamp: '刚刚', isStreaming: true }]);
    holder.current.setIsTyping(true);
    holder.current.attachStreamToMessage('m3', '第三问');
    cancelled.onDelta('', '旧结果');
    cancelled.onComplete({ finalOutput: '旧结果', threadId: 'wrong-thread' });
  });
  expect(holder.current.isTyping).toBe(true);
  expect(holder.current.activeStreamMsgIdRef.current).toBe('m3');
  expect(holder.current.messages[0].text).toBe('');
  await act(async () => { captured.onError(new Error('offline')); });
  const failed = holder.current.messages[0];
  expect(failed.failed).toBe(true);
  expect(failed.retryInput).toBe('第三问');
  const beforeRetry = calls.length;
  await act(async () => { holder.current.retryOfflineMessage(failed); });
  expect(calls).toHaveLength(beforeRetry + 1);
  await act(async () => { holder.current.retryOfflineMessage(failed); });
  expect(calls).toHaveLength(beforeRetry + 1);
  await act(async () => { captured.onComplete({ finalOutput: '重试成功', outcome: 'streamed' }); });
  expect(holder.current.messages[0].text).toBe('重试成功');
});

it('题目导师面板：关闭不可 Tab 到达 + 焦点恢复 + 重开不隐式新请求', async () => {
  await freshDom();
  mockInfra();
  const sendCalls: any[] = [];
  const interruptCalls: string[] = [];
  mock.module('../../../hooks/useAgentGateway.js', () => ({
    useAgentGateway: () => ({
      isConnected: true,
      sendTurnStream: (opts: any) => { sendCalls.push(opts); return true; },
      interruptTurn: (lane: string) => { interruptCalls.push(lane); },
      connect: () => {},
    }),
  }));
  const { AiTutorDrawer } = await import('../../AiTutorDrawer.js');
  const { useUserProfileStore } = await import('../../../stores/useUserProfileStore.js');
  useUserProfileStore.setState({ profile: { ...useUserProfileStore.getState().profile, targetLanguage: 'ja' } });
  const doc = dom!.dom.window.document;
  const context = { questionText: '「に」和「で」怎么选？', correctAnswer: 'に', userAnswer: 'で', explanation: '存在用に。', skillTag: '助词' };

  const opener = doc.createElement('button');
  opener.textContent = '打开导师';
  doc.body.appendChild(opener);

  await act(async () => {
    dom!.root.render(<AiTutorDrawer isOpen={false} mounted onClose={() => {}} context={context} />);
  });
  const dialog = doc.querySelector('[aria-label="题目导师"]') as HTMLElement | null;
  expect(dialog).toBeTruthy();
  expect(dialog!.style.display).toBe('none');
  expect(dialog!.getAttribute('aria-hidden')).toBe('true');
  expect(dialog!.hasAttribute('inert')).toBe(true);
  const resizer = dialog!.querySelector('[aria-label="调整题目导师宽度"]') as HTMLElement | null;
  expect(resizer?.getAttribute('tabindex')).toBe('-1');

  opener.focus();
  expect(doc.activeElement).toBe(opener);
  await act(async () => {
    dom!.root.render(<AiTutorDrawer isOpen mounted onClose={() => {}} context={context} />);
  });
  expect(dialog!.style.display).toBe('flex');
  expect(sendCalls.length).toBe(1);
  expect(sendCalls[0].intent).toBe('EXPLAIN');

  // 关闭：焦点回到打开者，且 bootstrap 不重跑
  await act(async () => {
    dom!.root.render(<AiTutorDrawer isOpen={false} mounted onClose={() => {}} context={context} />);
  });
  expect(doc.activeElement).toBe(opener);
  // 重开同一题：不隐式发起新付费请求
  await act(async () => {
    dom!.root.render(<AiTutorDrawer isOpen mounted onClose={() => {}} context={context} />);
  });
  expect(sendCalls.length).toBe(1);
  const previous = sendCalls[0];
  await act(async () => {
    dom!.root.render(<AiTutorDrawer isOpen mounted onClose={() => {}} context={{ ...context, userAnswer: '另一个答案' }} />);
  });
  expect(sendCalls).toHaveLength(2);
  expect(interruptCalls).toContain('learning');
  await act(async () => { previous.onComplete({ finalOutput: '旧题结果', threadId: 'wrong-thread' }); });
  expect(doc.body.textContent).not.toContain('旧题结果');
  expect(doc.body.textContent).toContain('导师正在组织讲解');
});

it('题目导师离线打开：欢迎语可读 + 重发入口', async () => {
  await freshDom();
  mockInfra();
  mock.module('../../../hooks/useAgentGateway.js', () => ({
    useAgentGateway: () => ({ isConnected: false, sendTurnStream: () => false, interruptTurn: () => {}, connect: () => {} }),
  }));
  const { AiTutorDrawer } = await import('../../AiTutorDrawer.js');
  const doc = dom!.dom.window.document;
  const context = { questionText: 'Q', correctAnswer: 'A', userAnswer: undefined, explanation: 'E', skillTag: '助词' };
  await act(async () => {
    dom!.root.render(<AiTutorDrawer isOpen mounted onClose={() => {}} context={context} />);
  });
  expect(doc.body.textContent).toContain('当前未连接');
  expect(doc.body.textContent).toContain('重发');
  for (const banned of BANNED) {
    expect(doc.body.textContent!.includes(banned)).toBe(false);
  }
  const expand = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '拓展追问');
  await act(async () => { expand?.click(); });
  expect(doc.body.textContent).not.toContain('导师正在组织讲解');
  expect(doc.querySelector('[aria-label="停止生成"]')).toBeNull();
  expect(doc.querySelectorAll('button[title="连接恢复后重新发送"]')).toHaveLength(2);
});

it('首次直接打开恢复焦点，非模态关闭不抢外部阅读焦点', async () => {
  await freshDom();
  mockInfra();
  mock.module('../../../hooks/useAgentGateway.js', () => ({
    useAgentGateway: () => ({ isConnected: false, sendTurnStream: () => false, interruptTurn: () => {}, connect: () => {} }),
  }));
  const { AiTutorDrawer } = await import('../../AiTutorDrawer.js');
  const doc = dom!.dom.window.document;
  const opener = doc.createElement('button');
  const external = doc.createElement('button');
  doc.body.append(opener, external);
  opener.focus();
  const context = { questionText: '首次打开', correctAnswer: 'A', explanation: 'E', skillTag: '语法' };
  const render = async (open: boolean) => {
    await act(async () => { dom!.root.render(<AiTutorDrawer isOpen={open} context={context} onClose={() => {}} />); });
  };
  await render(true);
  const dialog = doc.querySelector('[aria-label="题目导师"]');
  expect(doc.activeElement).toBe(dialog);
  await render(false);
  expect(doc.activeElement).toBe(opener);
  await render(true);
  external.focus();
  await render(false);
  expect(doc.activeElement).toBe(external);
});

it('自由导师列表：来源标签走尾部插槽，滚动交给通用列表', async () => {
  await freshDom();
  mockInfra();
  const { ChatMessageList } = await import('../ChatMessageList.js');
  const doc = dom!.dom.window.document;
  const endRef = { current: null as HTMLDivElement | null };
  const client = makeClient();
  const listMessages = [
    { id: 'u1', role: 'user' as const, text: '你好' },
    { id: 'a1', role: 'assistant' as const, text: '你好呀', streaming: false, source: 'agent' },
  ];
  const renderList = async () => { await act(async () => {
    dom!.root.render(
      <QueryClientProvider client={client}>
        <ChatMessageList
          queueItems={[]}
          busy={false}
          startQueuedTurn={() => {}}
          coachThreadId=""
          deleteQueueItem={{ mutate: () => {} }}
          messages={listMessages}
          respondApproval={() => {}}
          endRef={endRef}
          coachEffort=""
          track="ja"
        />
      </QueryClientProvider>
    );
  }); };
  await renderList();
  const text = doc.body.textContent ?? '';
  expect(text).toContain('由 AI 生成');
  expect(text.includes('via')).toBe(false);
  expect(BANNED.some((word) => text.includes(word))).toBe(false);
  // 旧自维护列表的控件不再出现
  expect(text).not.toContain('回到最新');

  // 通用列表接管视口与贴底：宿主只提供底部哨兵，不再自建滚动容器
  const viewport = doc.querySelector('[data-testid="chat-viewport"]');
  expect(viewport).not.toBeNull();
  expect(viewport!.contains(endRef.current)).toBe(true);
  // 「回到底部」由 assistant-ui 提供，禁用态随离底状态切换（滚动行为本身由 chat-ui 自测覆盖）
  expect(text).toContain('回到底部');
  client.clear();
});

it('历史刷新不覆盖正在生成的自由导师回复', async () => {
  await freshDom();
  const { useCoachBootMessages } = await import('../use-coach-boot.js');
  const holder: { current: any } = { current: null };
  function Harness({ items }: { items: any[] }) {
    const [messages, setMessages] = useState<any[]>([]);
    useCoachBootMessages({ track: 'ja', setMessages, coachThreadId: 'history', threadItems: items, threadItemsFetched: true, supportsThreadsOrHistory: true });
    useEffect(() => { holder.current = { messages, setMessages }; });
    return null;
  }
  await act(async () => { dom!.root.render(<Harness items={[]} />); });
  await act(async () => { holder.current.setMessages([{ id: 'current', role: 'assistant', text: '正在生成', streaming: true }]); });
  await act(async () => { dom!.root.render(<Harness items={[{ type: 'agentMessage', turnId: 'old', text: '历史旧结果' }]} />); });
  expect(holder.current.messages[0].text).toBe('正在生成');
});

it('打开导师不改写运行时默认或尚未确认的思考偏好', async () => {
  await freshDom();
  mockInfra();
  mock.module('../../../hooks/useAgentGateway.js', () => ({
    useAgentGateway: () => ({ isConnected: false, sendTurnStream: () => false, interruptTurn: () => {}, connect: () => {} }),
  }));
  const { AgentChatPanel } = await import('../../AgentChatPanel.js');
  const { usePreferencesStore } = await import('../../../stores/usePreferencesStore.js');
  const before = usePreferencesStore.getState().coachEffort;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => Response.json({ available: false, runtimes: [] }), { preconnect: originalFetch.preconnect });
  const client = makeClient();
  try {
    usePreferencesStore.setState({ coachEffort: '' });
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><AgentChatPanel /></QueryClientProvider>); });
    expect(usePreferencesStore.getState().coachEffort).toBe('');
    await act(async () => { usePreferencesStore.setState({ coachEffort: 'custom-depth' }); });
    expect(usePreferencesStore.getState().coachEffort).toBe('custom-depth');
    const settings = dom!.dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="会话设置"]');
    await act(async () => { settings?.click(); });
    expect(dom!.dom.window.document.body.textContent).toContain('custom-depth（待确认）');
  } finally {
    await act(async () => { dom!.root.render(null); });
    await client.cancelQueries();
    client.clear();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    usePreferencesStore.setState({ coachEffort: before });
    globalThis.fetch = originalFetch;
  }
});

}
