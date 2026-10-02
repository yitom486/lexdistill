import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextbookASTSchema } from '@study-studio/document-model';
import { CodexAdapter, type AgentSession } from '@study-studio/agent-runtime';
import { BusinessError, ok } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../../../../../gateway/src/runtime/gateway-runtime.js';
import { createTextbookPracticeRoutes } from '../../../../../gateway/src/modules/practice/http/textbook-practice-routes.js';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined, repo: DrizzleLearnerRepository | undefined, client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { dom?.teardown(); client?.clear(); repo?.getRawDb().close(); globalThis.fetch = originalFetch; });
it('desktop writing → actual Query/HTTP/native grade/SQLite → failure retry and revised answer', async () => {
  if (process.env['LINGUA_EXERCISE_GRADING_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], { env: { ...process.env, LINGUA_EXERCISE_GRADING_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe' });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' }); return;
  }
  dom = await setupDom(true);
  const { PreviewExercises } = await import('./PreviewExercises.js');
  const { usePreferencesStore } = await import('../../../stores/usePreferencesStore.js');
  const { useUserProfileStore } = await import('../../../stores/useUserProfileStore.js');
  useUserProfileStore.setState({ profile: { ...useUserProfileStore.getState().profile, userId: 'owner' } });
  usePreferencesStore.setState({ coachModelId: 'chosen-model', coachEffort: 'low' });
  repo = new DrizzleLearnerRepository(':memory:');
  await repo.seedTextbookTocSkeleton({ userId: 'owner', documentId: 'book', title: 'Book', language: 'ja', entries: [{ id: 'c', title: 'Introduce yourself', level: 'lesson', startPage: 1 }] });
  await repo.writeTextbookContent({ userId: 'owner', documentId: 'book', chapterId: 'c' }, 'exercises', { items: [{ type: 'WRITING', prompt: 'Introduce yourself and ask a question', gradingNotes: 'Identity and a question', difficultyTier: 3, difficultyReason: 'Connected short paragraph' }] });
  const doc = await repo.getDocumentById('book'); if (!doc.ok) throw doc.error;
  const exercise = TextbookASTSchema.parse(JSON.parse(doc.value!.astJson!)).lessons[0]!.learningContent!.exercises[0]!;
  let calls = 0;
  const adapter = new CodexAdapter();
  adapter.createSession = async options => {
    const session: AgentSession = { sessionId: options.sessionId,
      async *send(input) {
        input.onTurnStarted?.('t'); calls++;
        if (calls === 1) { yield { type: 'ERROR', error: new BusinessError('E_AGENT_QUOTA', '模型额度不足', 'AGENT_RUNTIME', true) }; return; }
        expect(input.message).toContain('Identity and a question'); expect(input.message).not.toContain('sourceRefs');
        const result = await options.tools![0]!.execute({ score: calls === 2 ? 60 : 85, feedback: calls === 2 ? 'Add a question.' : 'A clear introduction and question.', suggestions: [] }, { userId: options.userId, sessionId: options.sessionId, turnId: 't' });
        expect(result.ok).toBe(true); yield { type: 'COMPLETED' };
      }, submitToolResult: async () => ok(undefined), submitApproval: async () => ok(undefined), steer: async () => ok(undefined), interrupt: async () => ok(undefined), close: async () => ok(undefined) };
    return ok(session);
  };
  const server = new GatewayServer(repo, adapter), app = createTextbookPracticeRoutes({ repo, server, port: 0 });
  let disconnected = true;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname === '/api/agent/models') return Response.json({ models: [{ id: 'chosen-model', model: 'chosen-model', displayName: 'Chosen model', supportedReasoningEfforts: ['low'] }] });
    if (disconnected && init?.method === 'POST') { disconnected = false; throw new Error('fetch failed'); }
    return app.request(url.pathname + url.search, init);
  }, { preconnect: originalFetch.preconnect });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const document = dom.dom.window.document;
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(text))!;
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
  const until = async (text: string) => { for (let i = 0; i < 100 && !document.body.textContent?.includes(text); i++) await settle(); expect(document.body.textContent).toContain(text); };
  const click = async (text: string) => { expect(button(text)).toBeTruthy(); await act(async () => { button(text).click(); }); await settle(); };
  const enter = async (text: string) => { await act(async () => {
    const input = document.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(dom!.dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new dom!.dom.window.Event('input', { bubbles: true }));
  }); };
  await act(async () => { dom!.root.render(<QueryClientProvider client={client!}><PreviewExercises exercises={[exercise]} temporary={false} scope={{ documentId: 'book', chapterId: 'c', chapterTitle: 'Introduce yourself', language: 'ja', knowledge: [], rubricVersion: 'textbook-grade-v1' }} /></QueryClientProvider>); });
  await enter('わたしは李です。'); await click('请求 AI 批改'); await until('无法连接到学习助手服务');
  expect(document.body.textContent).not.toContain('fetch failed');
  expect(button('请求 AI 批改').disabled).toBe(true);
  expect(repo.getRawDb().query('SELECT count(*) AS n FROM practice_item_attempts').get()).toEqual({ n: 0 });
  await click('重试请求'); await until('未评分 · 答案已保留');
  expect(button('请求 AI 批改').disabled).toBe(true); // Failure retries stay on the frozen attempt.
  expect(repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  await click('重试批改'); await until('60 / 100');
  expect(document.body.textContent).not.toContain('参考对照 · 尚未评分');
  expect(repo.getRawDb().query('SELECT count(*) AS n FROM practice_item_attempts').get()).toEqual({ n: 1 });
  await click('修改后再答'); await enter('わたしは李です。お名前は何ですか。'); await click('请求 AI 批改'); await until('85 / 100');
  expect(repo.getRawDb().query('SELECT attempt_no,submission_kind FROM practice_item_attempts ORDER BY attempt_no').all()).toEqual([{ attempt_no: 1, submission_kind: 'INDEPENDENT' }, { attempt_no: 2, submission_kind: 'REVISION' }]);
  expect(repo.getRawDb().query('SELECT score,max_score FROM quiz_attempts ORDER BY created_at').all()).toEqual([{ score: 60, max_score: 100 }, { score: 85, max_score: 100 }]);
  await click('作答历史与成长'); await until('独立练习 1 次');
  expect(document.body.textContent).toContain('修改后作答 1 次');
  const histories = [...document.querySelectorAll<HTMLDetailsElement>('details')].filter(detail => detail.querySelector('summary')?.textContent?.includes('第 '));
  expect(histories).toHaveLength(2);
  expect(histories.find(detail => detail.querySelector('summary')?.textContent?.includes('第 2 次'))?.textContent).toContain('60 → 85 分');
  await click('作答历史与成长');
  await click('作答历史与成长'); await until('修改后作答 1 次');
  expect(calls).toBe(3); // Reading/reopening history cannot call the model again.
});
