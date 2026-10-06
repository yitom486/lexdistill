import { expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Hono } from 'hono';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { createAnswerRoutes } from '../../../../gateway/src/modules/practice/http/answer-routes.js';
import type { GatewayDeps } from '../../../../gateway/src/composition/gateway-deps.js';
import { act, setupDom } from '../toc/__tests__/dom-setup.js';

it('lost answer response retries with the same identity; reading renders and duplicate reorder chunks remain independent', async () => {
  if (process.env['LINGUA_PRACTICE_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_PRACTICE_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  const { useObjectiveAnswer } = await import('../../hooks/useObjectiveAnswer.js');
  const { useListeningPlayback } = await import('../../hooks/useListeningPlayback.js');
  const { useTtsStore } = await import('../../stores/useTtsStore.js');
  const originalTtsState = useTtsStore.getState();
  const { QuestionRenderer } = await import('./QuestionRenderer.js');
  const { useUserProfileStore } = await import('../../stores/useUserProfileStore.js');
  const originalState = useUserProfileStore.getState();
  const originalFetch = globalThis.fetch;
  const repo = new DrizzleLearnerRepository(':memory:');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const userId = 'dom_answer_owner';
  await repo.getLearnerProfile(userId);
  await repo.saveQuestion({ id: 'dom_q', userId, language: 'en', type: 'MULTIPLE_CHOICE', content: 'Past tense',
    options: ['go', 'went'], correctAnswer: 'went', testedSkillId: 'en.grammar.past', explanation: 'Past tense.' });
  const app = new Hono().route('/', createAnswerRoutes({ repo } as GatewayDeps));
  const requests: Array<{ submissionId: string; timeSpentMs: number }> = [];
  let loseResponse = true;
  const listeningRecords: Array<{ language: string; listeningMinutes: number }> = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/api/task/activity/')) {
      listeningRecords.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    if (!String(input).includes('/api/practice/answers/')) return Response.json({});
    requests.push(JSON.parse(String(init?.body)));
    const response = await app.request(new Request(input, init));
    if (loseResponse) { loseResponse = false; throw new Error('Simulated lost response after commit'); }
    return response;
  }, { preconnect: originalFetch.preconnect });
  useUserProfileStore.setState({ profile: { ...originalState.profile, userId, targetLanguage: 'en' }, fetchProfile: async () => {} });
  let recorded = 0;
  function Probe() {
    const answer = useObjectiveAnswer('dom_q', 'en', () => recorded++);
    return <><button onClick={() => answer.setAnswer('B')}>Choose B</button>
      <button disabled={answer.isPending} onClick={() => void answer.submit()}>Submit</button><output>{answer.result ? 'Committed' : 'Unconfirmed'}</output></>;
  }
  const doc = dom.dom.window.document;
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const waitFor = async (ready: () => boolean) => { for (let index = 0; index < 100 && !ready(); index++) await settle(); expect(ready()).toBe(true); };
  const click = async (text: string) => { const button = [...doc.querySelectorAll('button')].find(element => element.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); await settle(); };
  try {
    await act(async () => dom.root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
    await click('Choose B'); await click('Submit');
    await waitFor(() => requests.length === 1 && !doc.querySelector<HTMLButtonElement>('button:disabled'));
    expect(recorded).toBe(0);
    expect(doc.querySelector('output')?.textContent).toBe('Unconfirmed');
    await click('Submit'); await waitFor(() => doc.querySelector('output')?.textContent === 'Committed');
    expect(recorded).toBe(1);
    expect(requests[0]?.submissionId).toBe(requests[1]?.submissionId);
    expect(requests[0]?.timeSpentMs).toBeGreaterThanOrEqual(0);
    const progress = await repo.getDailyTaskProgress(userId);
    if (!isOk(progress)) throw progress.error;
    expect(progress.value.quizzesCount).toBe(1);

    let answer = '';
    function Renderer({ type }: { type: 'MULTIPLE_CHOICE' | 'SENTENCE_REORDER' }) {
      const [value, setValue] = React.useState('');
      return <QuestionRenderer question={{ id: 'renderer', type, prompt: 'Question', content: 'had had',
        options: ['yes', 'no'], correctAnswer: 'A', explanation: 'Reason', testedSkillId: 'en.reading.cloze', difficultyTier: 2,
        reading: { setId: 'reading', title: 'Reading title', body: 'The passage is visible.' } }} userAnswer={value}
        onAnswerChange={next => { answer = next; setValue(next); }} onSubmitObjective={() => {}} onSaveDraft={() => {}} disabled={false} busy={false} />;
    }
    await act(async () => dom.root.render(<Renderer type="MULTIPLE_CHOICE" />));
    expect(doc.body.textContent).toContain('The passage is visible.');
    await act(async () => dom.root.render(<Renderer type="SENTENCE_REORDER" />));
    const chunks = [...doc.querySelectorAll('button')].filter(button => button.textContent === 'had');
    expect(chunks).toHaveLength(2);
    await act(async () => { chunks[0]!.click(); });
    await act(async () => { chunks[1]!.click(); });
    expect(answer).toBe('had had');

    const callbacks: Array<import('../../stores/useTtsStore.js').SpeakOptions> = [];
    let stopped = 0;
    useTtsStore.setState({
      speak: async (text, options) => { useTtsStore.setState({ currentText: text }); callbacks.push(options!); },
      stop: () => { stopped++; useTtsStore.setState({ currentText: '' }); },
    });
    function Playback({ text }: { text: string }) {
      const audio = useListeningPlayback(text, 'KO');
      return <><button onClick={() => void audio.play()}>Play</button><button onClick={audio.stop}>Stop</button>
        <output>{audio.playing ? 'Playing' : 'Stopped'}</output></>;
    }
    const renderAudio = async (text: string) => act(async () => dom.root.render(
      <QueryClientProvider client={client}><Playback text={text} /></QueryClientProvider>));
    await renderAudio('first');
    await click('Play');
    expect(callbacks[0]?.lang).toBe('KO');
    callbacks[0]?.onStart?.();
    await click('Stop');
    callbacks[0]?.onEnd?.();
    await settle();
    expect(listeningRecords).toHaveLength(0);
    await click('Play');
    callbacks[1]?.onStart?.();
    await renderAudio('second');
    callbacks[1]?.onEnd?.();
    await settle();
    expect(doc.querySelector('output')?.textContent).toBe('Stopped');
    expect(listeningRecords).toHaveLength(0);
    await click('Play');
    callbacks[2]?.onStart?.();
    await settle();
    await act(async () => callbacks[2]?.onEnd?.());
    await waitFor(() => listeningRecords.length === 1);
    expect(listeningRecords[0]?.language).toBe('ko');
    expect(listeningRecords[0]?.listeningMinutes).toBeGreaterThan(0);
    await click('Play');
    useTtsStore.setState({ currentText: 'another player' });
    const stopsBeforeUnmount = stopped;
    await act(async () => dom.root.render(<div />));
    expect(stopped).toBe(stopsBeforeUnmount);
    callbacks[3]?.onEnd?.();
    await settle();
    expect(listeningRecords).toHaveLength(1);
  } finally {
    await act(async () => dom.root.render(<div />));
    client.clear(); repo.getRawDb().close(); globalThis.fetch = originalFetch;
    useUserProfileStore.setState(originalState); dom.teardown();
    useTtsStore.setState(originalTtsState);
  }
}, 30_000);
