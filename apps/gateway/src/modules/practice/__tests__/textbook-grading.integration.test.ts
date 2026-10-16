import { afterEach, expect, it } from 'bun:test';
import { AcpAdapter, AcpAgentSession, type AgentAdapter, type AgentEvent, type CreateSessionOptions, type AgentSession, type AgentInput } from '@lexdistill/agent-runtime';
import { BusinessError, err, ok } from '@lexdistill/shared';
import { ToolRegistry } from '@lexdistill/tool-core';
import { TextbookExerciseAttemptSchema, TextbookExerciseHistorySchema, TextbookGrowthResponseSchema } from '@lexdistill/protocol';
import { haveSameGradingBasis, summarizeTextbookGrowth } from '@lexdistill/learner-core';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../../../runtime/gateway-runtime.js';
import { createTextbookPracticeRoutes } from '../http/textbook-practice-routes.js';
import { TextbookGrading } from '../application/textbook-grading.js';
import { SubmitExerciseGradeTool } from '../tools/submit-exercise-grade.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { repos.splice(0).forEach(repo => repo.getRawDb().close()); });
async function setup(handle: (options: CreateSessionOptions, input: AgentInput) => AsyncIterable<AgentEvent>) {
  const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
  await repo.seedTextbookTocSkeleton({ userId: 'owner', documentId: 'book', title: 'Book', language: 'ja', entries: [{ id: 'chapter', title: 'Introductions', level: 'lesson', startPage: 1 }] });
  expect((await repo.writeTextbookContent({ userId: 'owner', documentId: 'book', chapterId: 'chapter' }, 'exercises', { items: [
    { type: 'WRITING', prompt: 'Introduce yourself and ask a question', gradingNotes: 'Identity, question and coherence; accept equivalent expressions', difficultyTier: 3, difficultyReason: 'Coherent short paragraph' },
    { type: 'CHOICE', prompt: 'Choose', options: ['a','b'], answer: 'a', difficultyTier: 1, difficultyReason: 'Simple recognition' },
  ] })).ok).toBe(true);
  await repo.writeTextbookContent({ userId: 'owner', documentId: 'book', chapterId: 'chapter' }, 'grammar', { items: [{ title: 'です', explanation: 'Polite identification' }] });
  const created: CreateSessionOptions[] = [];
  // 受控会话桩（按次克隆分支：会话挂载唯一名工具，门面合成归属，无 turn 校验）。
  const adapter = {
    id: 'mock-grader',
    name: 'MockGrader',
    createSession: async (options: CreateSessionOptions) => {
      created.push(options);
      const session: AgentSession = { sessionId: options.sessionId, send: input => handle(options, input),
        submitToolResult: async () => ok(undefined), submitApproval: async () => ok(undefined), steer: async () => ok(undefined), interrupt: async () => ok(undefined), close: async () => ok(undefined) };
      return ok(session);
    },
    resumeSession: async () => err(new BusinessError('E_X', 'x', 'VALIDATION')),
  } as unknown as AgentAdapter;
  const server = new GatewayServer(repo, adapter);
  const app = createTextbookPracticeRoutes({ repo, server, port: 0 });
  const ids = repo.getRawDb().query<{ id: string; type: string }, []>('SELECT id,type FROM textbook_exercise_items').all();
  const input = { requestId: crypto.randomUUID(), documentId: 'book', chapterId: 'chapter', exerciseId: ids.find(row => row.type === 'WRITING')!.id,
    answer: 'わたしは李です。趣味は読書です。お名前は何ですか。', model: 'chosen-model', effort: 'low' };
  const post = (body: unknown, user = 'owner') => app.request(`/api/textbook-practice/${user}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { repo, server, adapter, app, input, post, created, objectiveId: ids.find(row => row.type === 'CHOICE')!.id };
}

it('HTTP → frozen context → allowlisted native tool → committed SQLite → revision history; repeated receipts and independent repeats count correctly', async () => {
  const scores = [60,85,75]; let calls = 0;
  const env = await setup(async function* (options, input) {
    expect(options.model).toBe('chosen-model');
    // 按次克隆唯一名（共享名不在会话上）；归属由实例隔离保证，无 turnOptions/onTurnStarted。
    const mounted = (options.tools ?? []).map(tool => tool.name);
    expect(mounted).toHaveLength(1);
    expect(mounted[0]!.startsWith('learning.submit_grade.')).toBe(true);
    expect(mounted).not.toContain('learning.submit_grade');
    expect(input.attachments).toBeUndefined();
    expect(input.message).toContain('Identity, question and coherence'); expect(input.message).toContain('Polite identification'); expect(input.message).toContain('わたしは李です');
    expect(input.message).not.toContain('sourceRefs'); expect(input.message).not.toContain('exerciseId'); expect(input.message).not.toContain('inputSchema');
    const tool = options.tools![0]!;
    const context = { userId: options.userId, sessionId: options.sessionId };
    expect((await tool.execute({ score: 105, feedback: 'Invalid', suggestions: [] }, context)).ok).toBe(false);
    const saved = await tool.execute({ score: scores[calls++], feedback: 'Specific feedback', suggestions: ['Add a natural transition'], revisedAnswer: 'わたしは李です。よろしくお願いします。' }, context);
    expect(saved.ok).toBe(true);
    expect((await tool.execute({ score: 99, feedback: 'Duplicate receipt', suggestions: [] }, context))).toEqual(saved);
    yield { type: 'COMPLETED' };
  });
  const firstResponse = await env.post(env.input); expect(firstResponse.status).toBe(200);
  const first = TextbookExerciseAttemptSchema.parse(await firstResponse.json());
  expect(first).toMatchObject({ attemptNo: 1, submissionKind: 'INDEPENDENT', status: 'GRADED', grading: { score: 60, maxScore: 100 }, model: 'chosen-model' });
  expect((await env.post(env.input)).status).toBe(200); expect(calls).toBe(1);
  const revision = TextbookExerciseAttemptSchema.parse(await (await env.post({ ...env.input, requestId: crypto.randomUUID(), previousAttemptId: first.id, answer: 'わたしは李です。趣味は読書です。お名前は何ですか。よろしくお願いします。' })).json());
  expect(revision).toMatchObject({ previousAttemptId: first.id, attemptNo: 2, submissionKind: 'REVISION', grading: { score: 85 } });
  expect(TextbookExerciseAttemptSchema.parse(await (await env.post({ ...env.input, requestId: crypto.randomUUID() })).json()).submissionKind).toBe('INDEPENDENT');
  const history = TextbookExerciseHistorySchema.parse(await (await env.app.request('/api/textbook-practice/owner/history?documentId=book&chapterId=chapter')).json());
  expect(history).toHaveLength(3); expect(history.find(row => row.id === first.id)?.grading?.score).toBe(60);
  const growth = TextbookGrowthResponseSchema.parse(await (await env.app.request('/api/textbook-practice/owner/growth?documentId=book&chapterId=chapter')).json());
  expect(growth.summary).toMatchObject({ independentAttempts: 2, revisionAttempts: 1, ungradedAttempts: 0 });
  expect(growth.summary.groups.find(group => group.submissionKind === 'INDEPENDENT')).toMatchObject({ samples: 2, averageScore: 67.5, difficultyTier: 3 });
  expect(growth.summary.groups.find(group => group.submissionKind === 'REVISION')).toMatchObject({ samples: 1, averageScore: 85 });
  expect(haveSameGradingBasis(first, revision)).toBe(true);
  expect(summarizeTextbookGrowth([...history, first])).toEqual(growth.summary);
  expect(env.repo.getRawDb().query('SELECT count(*) AS n, count(DISTINCT source_attempt_id) AS unique_n FROM quiz_attempts').get()).toEqual({ n: 3, unique_n: 3 });
  expect(env.repo.getRawDb().query('SELECT model,prompt_version FROM ai_artifact_runs').all()).toHaveLength(3);
  expect((await env.post({ ...env.input, requestId: crypto.randomUUID(), retryAttemptId: first.id }, 'other')).status).not.toBe(200);
  expect((await env.post({ ...env.input, requestId: crypto.randomUUID(), score: 100 })).status).not.toBe(200);
});

it('growth separates models, prompt versions, unknown difficulty and failures; database commit failure cannot leave a successful grade', async () => {
  const env = await setup(async function* (options, input) {
    await options.tools![0]!.execute({ score: options.model === 'model-a' ? 40 : 95, feedback: 'Controlled feedback', suggestions: [] }, { userId: options.userId, sessionId: options.sessionId });
    yield { type: 'COMPLETED' };
  });
  const first = TextbookExerciseAttemptSchema.parse(await (await env.post({ ...env.input, model: 'model-a', timeSpentMs: 1000 })).json());
  const second = TextbookExerciseAttemptSchema.parse(await (await env.post({ ...env.input, requestId: crypto.randomUUID(), model: 'model-b', timeSpentMs: 2000 })).json());
  expect(haveSameGradingBasis(first, second)).toBe(false);
  // Static fixture mutation simulates an existing unknown difficulty, not an estimated default.
  env.repo.getRawDb().query('UPDATE textbook_exercise_items SET difficulty_tier=NULL,difficulty_reason=NULL WHERE id=?').run(env.input.exerciseId);
  const third = TextbookExerciseAttemptSchema.parse(await (await env.post({ ...env.input, requestId: crypto.randomUUID(), model: 'model-a' })).json());
  expect(third.snapshot.exercise.difficultyTier).toBeNull();
  // Test-only DDL fault: both detailed grade and effective statistics must roll back together.
  env.repo.getRawDb().run("CREATE TRIGGER fail_quiz_insert BEFORE INSERT ON quiz_attempts BEGIN SELECT RAISE(ABORT,'controlled commit failure'); END");
  const failed = TextbookExerciseAttemptSchema.parse(await (await env.post({ ...env.input, requestId: crypto.randomUUID(), model: 'model-a' })).json());
  expect(failed.status).toBe('GRADING_FAILED'); expect(failed.grading).toBeNull();
  const growth = TextbookGrowthResponseSchema.parse(await (await env.app.request('/api/textbook-practice/owner/growth?documentId=book&chapterId=chapter')).json());
  expect(growth.summary).toMatchObject({ independentAttempts: 3, ungradedAttempts: 1 });
  expect(growth.summary.groups).toHaveLength(3);
  expect(growth.summary.groups.find(group => group.model === 'model-a' && group.difficultyTier === 3)).toMatchObject({ averageScore: 40, averageTimeSpentMs: 1000 });
  expect(growth.summary.groups.find(group => group.model === 'model-b')).toMatchObject({ averageScore: 95, averageTimeSpentMs: 2000 });
  expect(growth.summary.groups.find(group => group.difficultyTier === null)).toMatchObject({ averageScore: 40, samples: 1 });
  const versioned = summarizeTextbookGrowth([first, { ...second, model: first.model, rubricVersion: 'different-rubric' }]);
  expect(versioned.groups).toHaveLength(2);
  expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 3 });
  expect((await env.app.request('/api/textbook-practice/other/growth?documentId=book&chapterId=chapter')).status).not.toBe(200);
});

it('AI failure keeps frozen answer unscored; retry reuses attempt; temporary case and objective grading cannot pollute model/growth counts', async () => {
  let fail = true;
  const env = await setup(async function* (options, input) {
    if (fail) { yield { type: 'ERROR', error: new BusinessError('E_AGENT_QUOTA', '模型额度不足', 'AGENT_RUNTIME', true) }; return; }
    const result = await options.tools![0]!.execute({ score: 80, feedback: 'Improved expression', suggestions: [] }, { userId: options.userId, sessionId: options.sessionId });
    expect(result.ok).toBe(true); yield { type: 'COMPLETED' };
  });
  const failed = TextbookExerciseAttemptSchema.parse(await (await env.post(env.input)).json());
  expect(failed.status).toBe('GRADING_FAILED'); expect(failed.grading).toBeNull(); expect(failed.answer).toBe(env.input.answer);
  expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  fail = false;
  const retry = TextbookExerciseAttemptSchema.parse(await (await env.post({ ...env.input, requestId: crypto.randomUUID(), retryAttemptId: failed.id })).json());
  expect(retry.id).toBe(failed.id); expect(retry.attemptNo).toBe(1); expect(retry.grading?.score).toBe(80);
  expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM practice_item_attempts').get()).toEqual({ n: 1 });
  const changed = await env.post({ ...env.input, requestId: crypto.randomUUID(), retryAttemptId: failed.id, answer: 'Changed answer' }); expect(changed.status).not.toBe(200);
  const temporary = TextbookExerciseAttemptSchema.parse(await (await env.post({ requestId: crypto.randomUUID(), preview: retry.snapshot, answer: env.input.answer, model: 'chosen-model' })).json());
  expect(temporary.temporary).toBe(true); expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM practice_item_attempts').get()).toEqual({ n: 1 });
  const before = env.created.length;
  const objective = TextbookExerciseAttemptSchema.parse(await (await env.post({ ...env.input, requestId: crypto.randomUUID(), exerciseId: env.objectiveId, answer: ['a'] })).json());
  expect(objective.grading?.score).toBe(100); expect(objective.model).toBeNull(); expect(env.created.length).toBe(before);
  expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 2 });
});

it('timeout rejects a late native grade and retry records one effective result', async () => {
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  let late: boolean | undefined;
  const env = await setup(async function* (options, input) {
    await wait;
    late = (await options.tools![0]!.execute({ score: 90, feedback: 'Late result', suggestions: [] }, { userId: options.userId, sessionId: options.sessionId })).ok;
    yield { type: 'COMPLETED' };
  });
  const tool = env.server.toolRegistry.get('learning.submit_grade'); expect(tool).toBeInstanceOf(SubmitExerciseGradeTool);
  const service = new TextbookGrading({ repo: env.repo, adapter: env.adapter, tool: tool as SubmitExerciseGradeTool, toolRegistry: env.server.toolRegistry, firstResponseTimeoutMs: 15 });
  const result = await service.submit('owner', env.input);
  expect(result.ok && result.value.status).toBe('GRADING_FAILED'); release(); await new Promise(resolve => setTimeout(resolve, 10));
  expect(late).toBe(false); expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  if (!result.ok) throw result.error;
  const retry = await service.submit('owner', { ...env.input, requestId: crypto.randomUUID(), retryAttemptId: result.value.id });
  expect(retry.ok && retry.value.grading?.score).toBe(90);
  expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM practice_item_attempts').get()).toEqual({ n: 1 });
  expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
});

it('按次唯一名工具注册→桥按名执行→用完注销；身份前置，共享实例不可直调', async () => {
  const env = await setup(async function* () { yield { type: 'COMPLETED' }; });
  const tool = new SubmitExerciseGradeTool();
  const registry = new ToolRegistry();
  registry.register(tool);
  const adapter = new AcpAdapter({ createClient: () => { throw new Error('测试内不得建连'); }, buildMcpServers: () => [] });
  let mounted: { name: string }[] = [];
  let sentMessage = '';
  (adapter as { createSession: unknown }).createSession = async (options: CreateSessionOptions) => {
    mounted = (options.tools ?? []).map(tool => ({ name: tool.name }));
    // 真 AcpAgentSession（走身份前置分支），send 伪造为“模型经桥调按次工具”。
    const handle = { sessionId: 'acp-grade-1', prompt: async () => ({ ok: true as const, value: '' }) };
    const session = new AcpAgentSession(String(options.sessionId), 'acp-grade-1', handle as never, [], undefined);
    const inner = {
      sessionId: session.sessionId,
      send: (async function* (input: AgentInput) {
        sentMessage = input.message;
        // 模拟 MCP 桥：按名走注册表执行（与 SessionToolBridge 同语义）。
        const target = mounted[0]!.name;
        const called = await registry.execute(target,
          { score: 88, feedback: 'ACP 批改反馈', suggestions: [] },
          { userId: 'owner', sessionId: 'gateway-session' });
        expect(called.ok).toBe(true);
        yield { type: 'COMPLETED' as const };
      }) as AgentSession['send'],
      submitToolResult: async () => ok(undefined),
      submitApproval: async () => ok(undefined),
      steer: async () => ok(undefined),
      interrupt: async () => ok(undefined),
      close: async () => ok(undefined),
    } satisfies AgentSession;
    (session as { send: unknown }).send = inner.send;
    return ok(session);
  };
  const service = new TextbookGrading({ repo: env.repo, adapter, tool, toolRegistry: registry, firstResponseTimeoutMs: 5000 });
  const result = await service.submit('owner', env.input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.status).toBe('GRADED');
  expect(result.value.grading?.score).toBe(88);
  expect(result.value.adapter).toBe('acp');
  // 按次唯一名（非共享名），且已注销；共享实例直调大声拒绝
  expect(mounted.length).toBe(1);
  expect(mounted[0]!.name.startsWith('learning.submit_grade.')).toBe(true);
  expect(registry.get(mounted[0]!.name)).toBeUndefined();
  expect((await tool.execute({ score: 10, feedback: 'x', suggestions: [] }, { userId: 'owner', sessionId: 'no-run' })).ok).toBe(false);
  // 身份前置（真 AcpAgentSession），工具名即注册名
  expect(sentMessage).toContain('你是外语练习批改员');
  expect(sentMessage).toContain(mounted[0]!.name);
});

it('shared practice draft never overwrites graded history, never inherits a grade; repeated question in a different run survives finalization', async () => {
  const env = await setup(async function* () { yield { type: 'COMPLETED' }; });
  const start = () => env.repo.startPracticePlanRun('owner', { language: 'ja', blocks: [{ id: 'b', kind: 'QUIZ', count: 1, gradingMode: 'AUTO_IMMEDIATE' }] });
  const firstRun = await start(); if (!firstRun.ok) throw firstRun.error;
  const first = await env.repo.submitPracticeItem('owner', firstRun.value.id, 'same-question', 'a', { score: 1, isCorrect: true }); if (!first.ok) throw first.error;
  const draft = await env.repo.savePracticeItemDraft('owner', firstRun.value.id, 'same-question', 'b'); if (!draft.ok) throw draft.error;
  expect(draft.value.id).not.toBe(first.value.id);
  const pending = await env.repo.submitPracticeItem('owner', firstRun.value.id, 'same-question', 'b'); if (!pending.ok) throw pending.error;
  expect(pending.value.gradingResult).toBeUndefined(); expect(pending.value.gradedAt).toBeUndefined();
  expect(env.repo.getRawDb().query('SELECT user_answer,grading_result_json FROM practice_item_attempts WHERE id=?').get(first.value.id)).toEqual({ user_answer: 'a', grading_result_json: '{"score":1,"isCorrect":true}' });
  const graded = await env.repo.submitPracticeItem('owner', firstRun.value.id, 'same-question', 'b', { score: 0.5, isCorrect: false }); expect(graded.ok).toBe(true);
  const latest = await env.repo.listPracticeItemAttempts(firstRun.value.id); expect(latest.ok && latest.value).toHaveLength(1);
  expect((await env.repo.finalizePracticePlanRun('owner', firstRun.value.id)).ok).toBe(true);
  const nextRun = await start(); if (!nextRun.ok) throw nextRun.error;
  expect((await env.repo.submitPracticeItem('owner', nextRun.value.id, 'same-question', 'c', { score: 1, isCorrect: true })).ok).toBe(true);
  expect((await env.repo.finalizePracticePlanRun('owner', nextRun.value.id)).ok).toBe(true);
  expect((await env.repo.finalizePracticePlanRun('owner', nextRun.value.id)).ok).toBe(true);
  expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts WHERE question_id=?').get('same-question')).toEqual({ n: 2 });
});
