import { afterEach, expect, it, mock } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatComposer } from '../ChatComposer.js';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';
import { usePreferencesStore } from '../../../stores/usePreferencesStore.js';

let dom: DomHandle | undefined;
const originalFetch = globalThis.fetch;

afterEach(() => {
  dom?.teardown();
  dom = undefined;
  globalThis.fetch = originalFetch;
  usePreferencesStore.setState({ agentRuntimeId: '', coachModelId: '', coachEffort: '' });
});

it('ChatComposer: 输入、IME 输入法守卫与回车发送逻辑验证', async () => {
  dom = await setupDom(true);
  const doc = dom.dom.window.document;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = (async () => Response.json({ models: [], efforts: [] })) as unknown as typeof fetch;

  const sendMock = mock((_val: string) => {});
  const setInputMock = mock((_val: string) => {});
  const interruptMock = mock(() => {});
  const enqueueMock = mock(() => {});

  let currentInput = '';
  const setInput = (val: string) => {
    currentInput = val;
    setInputMock(val);
  };

  const render = async (busy = false, inputVal = '') => {
    await act(async () => {
      dom!.root.render(
        <QueryClientProvider client={client}>
          <ChatComposer
            input={inputVal}
            setInput={setInput}
            send={sendMock}
            busy={busy}
            composerSettingsOpen={false}
            setComposerSettingsOpen={() => {}}
            composerSettingsNonDefault={false}
            coachApprovalPolicy="never"
            setCoachApprovalPolicy={() => {}}
            coachEffort=""
            setCoachEffort={() => {}}
            coachModelId=""
            setCoachModelId={() => {}}
            enqueueQueued={enqueueMock}
            interrupt={interruptMock}
            queueMessage={{ isPending: false }}
            coachThreadId="test-thread"
          />
        </QueryClientProvider>
      );
    });
  };

  await render(false, '');

  const textarea = doc.querySelector('textarea') as HTMLTextAreaElement;
  expect(textarea).not.toBeNull();
  expect(textarea.placeholder).toContain('Enter 发送');

  // 1. 空白内容按 Enter：不触发 send
  const enterEvent = new dom.dom.window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  textarea.dispatchEvent(enterEvent);
  expect(sendMock).toHaveBeenCalledTimes(0);

  // 2. 有内容，但在 IME 拼音输入法组合状态中：不触发 send
  await render(false, '你好');
  const compStart = new dom.dom.window.CompositionEvent('compositionstart', { bubbles: true });
  textarea.dispatchEvent(compStart);

  textarea.dispatchEvent(enterEvent);
  expect(sendMock).toHaveBeenCalledTimes(0);

  // 3. IME keyCode 229 守卫：不触发 send
  const ime229Event = new dom.dom.window.KeyboardEvent('keydown', {
    key: 'Enter',
    keyCode: 229,
    bubbles: true,
    cancelable: true,
  } as unknown as KeyboardEventInit);
  textarea.dispatchEvent(ime229Event);
  expect(sendMock).toHaveBeenCalledTimes(0);

  // 4. 输入法上屏结束（compositionend），正常按 Enter 发送
  const compEnd = new dom.dom.window.CompositionEvent('compositionend', { bubbles: true });
  textarea.dispatchEvent(compEnd);

  textarea.dispatchEvent(enterEvent);
  expect(sendMock).toHaveBeenCalledTimes(1);
  expect(sendMock).toHaveBeenCalledWith('你好');

  // 5. Shift+Enter 换行：不触发 send
  const shiftEnterEvent = new dom.dom.window.KeyboardEvent('keydown', {
    key: 'Enter',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  textarea.dispatchEvent(shiftEnterEvent);
  expect(sendMock).toHaveBeenCalledTimes(1);

  // 6. busy 状态下：placeholder 改变，并提供停止、排队与追加引导操作
  //    （输入区形态由 @yitom/chat-ui 的 ChatComposer 提供，控件语义以 aria-label 为准）
  await render(true, '请详细解释');
  const busyTextarea = doc.querySelector('textarea') as HTMLTextAreaElement;
  expect(busyTextarea.placeholder).toContain('生成中：Enter 追加引导');

  const stopBtn = doc.querySelector('button[aria-label="停止生成"]') as HTMLButtonElement;
  expect(stopBtn).not.toBeNull();
  await act(async () => {
    stopBtn.click();
  });
  expect(interruptMock).toHaveBeenCalledTimes(1);

  const steerBtn = doc.querySelector('button[aria-label="发送"]') as HTMLButtonElement;
  expect(steerBtn).not.toBeNull();
  await act(async () => {
    steerBtn.click();
  });
  expect(sendMock).toHaveBeenCalledTimes(2);
  expect(sendMock).toHaveBeenLastCalledWith('请详细解释');

  const queueBtn = doc.querySelector('button[aria-label="加入下一轮队列"]') as HTMLButtonElement;
  expect(queueBtn).not.toBeNull();
  await act(async () => {
    queueBtn.click();
  });
  expect(enqueueMock).toHaveBeenCalledTimes(1);

  client.clear();
});

