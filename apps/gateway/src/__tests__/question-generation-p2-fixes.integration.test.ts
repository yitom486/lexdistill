import { afterEach, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentAdapter, type AgentSession, type CreateSessionOptions } from '@study-studio/agent-runtime';
import { BankSubjectiveAnswerResultSchema, WsEventTypes } from '@study-studio/protocol';
import { BusinessError, isOk, ok, err } from '@study-studio/shared';
import { SqliteQuestionGenerationRepository } from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { createQuestionGenerationTools } from '../modules/question-generation/public.js';
import { GenerationTaskService } from '../modules/question-generation/service.js';
import { createGenerationRoutes } from '../modules/question-generation/http/generation-routes.js';
import { createBankGradingRoutes } from '../modules/practice/http/bank-grading-routes.js';
import { binding, config, question } from './question-generation.fixtures.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => repos.splice(0).forEach(repo => repo.getRawDb().close()));
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: BusinessError }): T => {
  if (!result.ok) throw result.error;
  return result.value;
};
async function setup(path = ':memory:') {
  const repo = new DrizzleLearnerRepository(path); repos.push(repo);
  const sqlite = repo.getRawDb(), bank = new SqliteQuestionGenerationRepository(sqlite);
  const service = new GenerationTaskService({ repository: bank });
  const task = service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId, config });
  const snapshot = service.queryTask(binding.userId, task.taskId);
  const tools = createQuestionGenerationTools({ repository: bank }, snapshot.binding, snapshot.config, snapshot.expiresAt, { runLimits: snapshot.runLimits });
  const saved = unwrap(await tools.registry.execute('generation.submit', { requestKey: 'fixes', questions: [question(),
    question({ answer: { type: 'SHORT_ANSWER', referenceAnswer: 'Hello.', rubric: 'Accept an equivalent greeting.' } }),
    question({ category: 'WRITING', prompt: 'Write at least twenty words.', skillIds: ['en.writing.basic'],
      answer: { type: 'WRITING', sampleAnswer: 'I am a student.', rubric: 'Clear introduction with twenty words.', minWords: 20, maxWords: 40 } }),
    question({ category: 'WRITING', prompt: 'Introduce yourself.', skillIds: ['en.writing.basic'],
      answer: { type: 'WRITING', sampleAnswer: 'I am a student.', rubric: 'A clear introduction.', minWords: 3, maxWords: 30 } }),
  ] }, snapshot.binding)) as { questionIds: string[] };
  const paper = unwrap(await tools.registry.execute('generation.paper', { requestKey: 'fix-paper', title: 'Repair checks', questionIds: saved.questionIds }, snapshot.binding)) as { paperId: string };
  await tools.dispose('COMPLETED');
  const [mc, short, limitedWriting, writing] = saved.questionIds as [string, string, string, string];
  let mode: 'receipt' | 'error' | 'prose' | 'malformed' = 'receipt';
  let score = 55, calls = 0, closed = 0, interrupted = 0;
  let hold: Promise<void> | undefined;
  const created: CreateSessionOptions[] = [];
  const adapter = {
    id: 'mock-grader',
    name: 'MockGrader',
    createSession: async (options: CreateSessionOptions) => {
    calls++; created.push(options);
    const session: AgentSession = { sessionId: options.sessionId,
      send: async function* (input) {
        if (hold) await hold;
        if (mode === 'error') { yield { type: 'ERROR', error: new BusinessError('E_TEST_MODEL', 'Controlled failure', 'AGENT_RUNTIME') }; return; }
        if (mode === 'prose') { yield { type: 'COMPLETED', finalOutput: '{"score":100,"isCorrect":true}' }; return; }
        // 按次克隆唯一名（共享名不在会话上）；归属由实例隔离保证，无 turn 校验。
        const mounted = (options.tools ?? []).map(tool => tool.name);
        expect(mounted).toHaveLength(1);
        expect(mounted[0]!.startsWith('learning.submit_grade.')).toBe(true);
        expect(mounted).not.toContain('learning.submit_grade');
        expect(input.message).toContain('rubric');
        const tool = options.tools![0]!;
        const result = await tool.execute({ score: mode === 'malformed' ? 101 : score, feedback: 'Controlled rubric feedback', suggestions: ['Improve clarity.'] },
          { userId: options.userId, sessionId: options.sessionId });
        expect(isOk(result)).toBe(mode !== 'malformed');
        yield { type: 'COMPLETED' };
      }, submitToolResult: async () => ok(undefined), submitApproval: async () => ok(undefined), steer: async () => ok(undefined),
      interrupt: async () => { interrupted++; return ok(undefined); }, close: async () => { closed++; return ok(undefined); } };
    return ok(session);
  },
    resumeSession: async () => err(new BusinessError('E_X', 'x', 'VALIDATION')),
  } as unknown as AgentAdapter;
  const server = new GatewayServer(repo, adapter);
  const deps = { repo, server, port: 0, generation: { service } };
  const app = new Hono().route('/', createGenerationRoutes(deps)).route('/', createBankGradingRoutes(deps));
  const input = (submissionId: string, questionId: string, userAnswer: string) =>
    ({ taskId: task.taskId, paperId: paper.paperId, submissionId, questionId, userAnswer, timeSpentMs: 1234 });
  const grade = async (submissionId: string, body: unknown = {}, userId = binding.userId) => app.request(
    `/api/generation/tasks/${userId}/${task.taskId}/papers/${paper.paperId}/answers/subjective/${submissionId}/grade`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { repo, sqlite, bank, service, taskId: task.taskId, paperId: paper.paperId, mc, short, limitedWriting, writing, input, grade, server, created,
    counts: () => ({ calls, closed, interrupted }), setMode: (next: typeof mode) => { mode = next; }, setScore: (value: number) => { score = value; },
    setHold: (value: Promise<void>) => { hold = value; } };
}

it('the live legacy WS dispatcher rejects client grades for bank IDs without touching learning facts', async () => {
  const f = await setup();
  const forged = await f.server.handleClientMessage({ version: '1.0', id: 'forged', sessionId: binding.sessionId,
    type: WsEventTypes.CLIENT_QUIZ_SUBMIT, timestamp: Date.now(), payload: { userId: binding.userId, questionId: f.mc,
      userAnswer: 'arbitrary', isCorrect: true, score: 1, timeSpentMs: 0, testedSkillId: 'en.grammar.present' } });
  expect(forged.ok).toBe(false);
  if (!forged.ok) expect(forged.error.code).toBe('E_BANK_ANSWER_REQUIRED');
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  expect(f.service.readReviewPaper(binding.userId, f.taskId, f.paperId).items.every(item => !item.reviewed)).toBe(true);
  expect(unwrap(await f.repo.getDailyTaskProgress(binding.userId)).quizzesCount).toBe(0);
});

it('both answer routes reject cross-type reuse in both directions and preserve the original elapsed time', async () => {
  const f = await setup();
  unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('pending', f.short, 'Hi.')));
  const conflict = await f.repo.submitBankObjectiveAnswer(binding.userId, f.input('pending', f.mc, 'A'));
  expect(conflict.ok).toBe(false);
  if (!conflict.ok) expect(conflict.error.code).toBe('E_SUBMISSION_CONFLICT');
  unwrap(await f.repo.submitBankObjectiveAnswer(binding.userId, f.input('objective', f.mc, 'A')));
  expect(isOk(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('objective', f.short, 'Hello.')))).toBe(false);
  expect(isOk(await f.repo.submitBankObjectiveAnswer(binding.userId, { ...f.input('objective', f.mc, 'A'), timeSpentMs: 9999 }))).toBe(false);
  expect(f.bank.getBankSubmission(binding.userId, 'pending')?.timeSpentMs).toBe(1234);
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
});

it('matching a writing sample never automatically earns a grade and invalid word count incurs no model call', async () => {
  const f = await setup();
  const saved = unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('short-writing', f.limitedWriting, 'I am a student.')));
  expect(saved).toMatchObject({ status: 'SUBMITTED' }); expect(saved).not.toHaveProperty('score');
  const graded = BankSubjectiveAnswerResultSchema.parse(await (await f.grade('short-writing')).json());
  expect(graded).toMatchObject({ status: 'GRADING_FAILED', gradingError: 'E_WRITING_LENGTH', persistedToDb: true });
  expect(graded).not.toHaveProperty('score'); expect(f.counts().calls).toBe(0);
  expect(f.bank.getBankSubmission(binding.userId, 'short-writing')?.userAnswer).toBe('I am a student.');
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
});

it('a real grading exception retains the submission and failure state instead of rolling them back', async () => {
  const f = await setup();
  const row = f.sqlite.query('SELECT snapshot_json FROM bank_paper_items WHERE paper_id=? AND question_id=?').get(f.paperId, f.short) as { snapshot_json: string };
  const snapshot = JSON.parse(row.snapshot_json); snapshot.answer.referenceAnswer = '';
  f.sqlite.query('UPDATE bank_paper_items SET snapshot_json=? WHERE paper_id=? AND question_id=?').run(JSON.stringify(snapshot), f.paperId, f.short);
  const failed = unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('broken-reference', f.short, 'Hi.')));
  expect(failed).toMatchObject({ status: 'GRADING_FAILED', gradingError: 'E_REFERENCE_MISSING', persistedToDb: true });
  expect(f.bank.getBankSubmission(binding.userId, 'broken-reference')).toMatchObject({ userAnswer: 'Hi.', status: 'GRADING_FAILED', timeSpentMs: 1234 });
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  f.sqlite.query('UPDATE bank_paper_items SET snapshot_json=? WHERE paper_id=? AND question_id=?').run(row.snapshot_json, f.paperId, f.short);
  expect((await f.grade('broken-reference')).status).toBe(200);
  expect(f.bank.getBankSubmission(binding.userId, 'broken-reference')?.status).toBe('GRADED');
});

it('explicit native grading accepts equivalent answers, records real scores and feedback, and enables per-item review', async () => {
  const f = await setup();
  unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('equivalent', f.short, 'Hi there.')));
  const response = await f.grade('equivalent', { model: 'chosen-grader', effort: 'low' }); expect(response.status).toBe(200);
  const result = BankSubjectiveAnswerResultSchema.parse(await response.json());
  expect(result).toMatchObject({ status: 'GRADED', score: 0.55, isCorrect: false, grading: { score: 55, feedback: 'Controlled rubric feedback' } });
  expect(f.created[0]?.model).toBe('chosen-grader');
  expect(f.bank.getBankSubmission(binding.userId, 'equivalent')).toMatchObject({ model: 'chosen-grader', adapter: f.server.agentAdapter.id, timeSpentMs: 1234 });
  expect(f.sqlite.query('SELECT score,time_spent_ms FROM quiz_attempts').get()).toEqual({ score: 0.55, time_spent_ms: 1234 });
  const mistakes = unwrap(await f.repo.getMistakes(binding.userId, { language: 'en' }));
  expect(mistakes.map(item => item.questionId)).toContain(f.short);
  expect(mistakes.find(item => item.questionId === f.short)?.lastGrading).toMatchObject({ score: 55, explanation: 'Controlled rubric feedback' });
  expect(f.service.readReviewPaper(binding.userId, f.taskId, f.paperId).items.filter(item => item.reviewed).map(item => item.id)).toEqual([f.short]);
  const replay = BankSubjectiveAnswerResultSchema.parse(await (await f.grade('equivalent')).json()); expect(replay).toEqual(result);
  expect(f.counts()).toEqual({ calls: 1, closed: 1, interrupted: 1 });
});

it('model failure and explicit retry use one saved answer and produce exactly one effective attempt', async () => {
  const f = await setup(); f.setMode('error');
  unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('retry', f.writing, 'I am a student.')));
  expect(await (await f.grade('retry')).json()).toMatchObject({ status: 'GRADING_FAILED', gradingError: 'E_TEST_MODEL' });
  expect(f.bank.getBankSubmission(binding.userId, 'retry')?.userAnswer).toBe('I am a student.');
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  f.setMode('receipt'); f.setScore(90);
  expect(await (await f.grade('retry')).json()).toMatchObject({ status: 'GRADED', score: 0.9, isCorrect: true });
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
  expect(unwrap(await f.repo.getDailyTaskProgress(binding.userId)).quizzesCount).toBe(1);
  expect(f.counts()).toEqual({ calls: 2, closed: 2, interrupted: 2 });
});

it('failed grade commits roll back learning facts while retaining an independently saved answer for retry', async () => {
  const f = await setup();
  unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('db-retry', f.writing, 'I am a student.')));
  f.sqlite.run("CREATE TRIGGER fail_grade BEFORE INSERT ON quiz_attempts BEGIN SELECT RAISE(ABORT,'controlled failure'); END");
  expect(await (await f.grade('db-retry')).json()).toMatchObject({ status: 'GRADING_FAILED' });
  expect(f.bank.getBankSubmission(binding.userId, 'db-retry')).toMatchObject({ userAnswer: 'I am a student.', status: 'GRADING_FAILED', score: null });
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  expect(unwrap(await f.repo.getMistakes(binding.userId, { language: 'en' }))).toHaveLength(0);
  f.sqlite.run('DROP TRIGGER fail_grade');
  f.sqlite.run("CREATE TRIGGER fail_mistake BEFORE INSERT ON mistakes BEGIN SELECT RAISE(ABORT,'controlled mistake failure'); END");
  expect(await (await f.grade('db-retry')).json()).toMatchObject({ status: 'GRADING_FAILED' });
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  expect(unwrap(await f.repo.getDailyTaskProgress(binding.userId)).quizzesCount).toBe(0);
  f.sqlite.run('DROP TRIGGER fail_mistake');
  expect(await (await f.grade('db-retry')).json()).toMatchObject({ status: 'GRADED', score: 0.55 });
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
  expect(f.counts().calls).toBe(1);
});

it('model prose and malformed native receipts cannot fabricate a grade', async () => {
  const f = await setup();
  for (const mode of ['prose', 'malformed'] as const) {
    f.setMode(mode);
    unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input(mode, f.writing, 'I am a student.')));
    expect(await (await f.grade(mode)).json()).toMatchObject({ status: 'GRADING_FAILED', gradingError: 'E_GRADING_RESULT_MISSING' });
  }
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  expect(f.counts()).toEqual({ calls: 2, closed: 2, interrupted: 2 });
});

it('grading rejects cross-user access and injected grades before contacting a model', async () => {
  const f = await setup();
  unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('owned', f.writing, 'I am a student.')));
  expect((await f.grade('owned', {}, 'other')).status).not.toBe(200);
  expect((await f.grade('missing')).status).not.toBe(200);
  expect((await f.grade('owned', { score: 100, referenceAnswer: 'Forged' })).status).not.toBe(200);
  expect(f.counts().calls).toBe(0);
});

it('concurrent grading requests share one model execution and commit once', async () => {
  const f = await setup();
  unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('concurrent', f.writing, 'I am a student.')));
  let release!: () => void;
  f.setHold(new Promise<void>(resolve => { release = resolve; }));
  const first = f.grade('concurrent'), second = f.grade('concurrent');
  release();
  expect((await first).status).toBe(200); expect((await second).status).toBe(200);
  expect(f.counts().calls).toBe(1);
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
});

it('a reused submission cannot be rebound to another owned paper containing the same question', async () => {
  const f = await setup();
  unwrap(await f.repo.submitBankObjectiveAnswer(binding.userId, f.input('same-paper', f.mc, 'A')));
  const next = f.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: 'next', config });
  const snapshot = f.service.queryTask(binding.userId, next.taskId);
  const tools = createQuestionGenerationTools({ repository: f.bank }, snapshot.binding, snapshot.config, snapshot.expiresAt, { runLimits: snapshot.runLimits });
  try {
    const paper = unwrap(await tools.registry.execute('generation.paper', { requestKey: 'next-paper', title: 'Next paper', questionIds: [f.mc] }, snapshot.binding)) as { paperId: string };
    const result = await f.repo.submitBankObjectiveAnswer(binding.userId, { ...f.input('same-paper', f.mc, 'A'), taskId: next.taskId, paperId: paper.paperId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_SUBMISSION_CONFLICT');
    expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
  } finally { await tools.dispose('COMPLETED'); }
});

it('the bank source guard preserves canonical legacy questions awaiting bank migration validation', async () => {
  const f = await setup();
  // The old bank migration copies IDs as LEGACY_PENDING; those are still owned by quiz_questions.
  f.sqlite.query("UPDATE bank_questions SET status='LEGACY_PENDING' WHERE id=?").run(f.mc);
  unwrap(await f.repo.saveQuestions([{ id: f.mc, userId: binding.userId, language: 'en', type: 'MULTIPLE_CHOICE', category: 'GRAMMAR',
    prompt: 'Choose', content: 'Choose', options: ['A', 'B'], correctAnswer: 'A', explanation: 'A is correct', testedSkillId: 'en.grammar.present' }]));
  const result = await f.repo.submitObjectiveAnswer(binding.userId, { submissionId: 'legacy', questionId: f.mc, userAnswer: 'A', language: 'en', timeSpentMs: 100 });
  expect(isOk(result)).toBe(true);
  expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
});

it('untrusted historical attempt rows alone cannot release new bank review answers', async () => {
  const f = await setup();
  f.sqlite.query(`INSERT INTO quiz_attempts (id,user_id,language,question_id,user_answer,is_correct,score,time_spent_ms,tested_skill_id,created_at)
    VALUES ('old-untrusted',?,'en',?,'forged',1,1,0,'en.grammar.present',?)`).run(binding.userId, f.mc, new Date().toISOString());
  expect(f.service.readReviewPaper(binding.userId, f.taskId, f.paperId).items.every(item => !item.reviewed)).toBe(true);
});

it('v47 graded subjective receipts still replay and release review when their new metadata is absent', async () => {
  const f = await setup();
  const input = f.input('v47-submission', f.short, 'Hello.');
  unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, input));
  f.sqlite.query('UPDATE bank_submissions SET attempt_id=NULL,time_spent_ms=0 WHERE user_id=? AND submission_id=?').run(binding.userId, input.submissionId);
  expect(unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, input))).toMatchObject({ status: 'GRADED', score: 1 });
  expect(f.service.readReviewPaper(binding.userId, f.taskId, f.paperId).items.find(item => item.id === f.short)?.reviewed).toBe(true);
});

it('a retained native grade survives reopening and retries storage without another model execution', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'lingua-bank-grade-'));
  let open: DrizzleLearnerRepository | undefined;
  const close = (repo: DrizzleLearnerRepository) => {
    repo.getRawDb().run('PRAGMA wal_checkpoint(TRUNCATE)'); repo.getRawDb().run('PRAGMA journal_mode=DELETE');
    repos.splice(repos.indexOf(repo), 1); repo.getRawDb().close();
  };
  try {
    const f = await setup(join(folder, 'grade.db')); open = f.repo;
    unwrap(await f.repo.submitBankSubjectiveAnswer(binding.userId, f.input('reopen-grade', f.writing, 'I am a student.')));
    f.sqlite.run("CREATE TRIGGER fail_before_reopen BEFORE INSERT ON quiz_attempts BEGIN SELECT RAISE(ABORT,'controlled storage failure'); END");
    const failed = await (await f.grade('reopen-grade')).json();
    expect(failed).toMatchObject({ status: 'GRADING_FAILED' }); expect(failed).not.toHaveProperty('grading');
    expect(f.bank.getBankSubmission(binding.userId, 'reopen-grade')?.grading?.score).toBe(55);
    f.sqlite.run('DROP TRIGGER fail_before_reopen'); close(f.repo); open = undefined;
    const reopened = new DrizzleLearnerRepository(join(folder, 'grade.db')); repos.push(reopened); open = reopened;
    const server = new GatewayServer(reopened, f.server.agentAdapter);
    const app = createBankGradingRoutes({ repo: reopened, server, port: 0 });
    const response = await app.request(`/api/generation/tasks/${binding.userId}/${f.taskId}/papers/${f.paperId}/answers/subjective/reopen-grade/grade`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(await response.json()).toMatchObject({ status: 'GRADED', score: 0.55, grading: { feedback: 'Controlled rubric feedback' } });
    expect(f.counts().calls).toBe(1);
    expect(reopened.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
  } finally {
    if (open) close(open);
    for (let retry = 0; retry < 30; retry++) {
      try {
        for (const name of ['grade.db', 'grade.db-wal', 'grade.db-shm']) rmSync(join(folder, name), { force: true });
        rmdirSync(folder); break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EBUSY') throw cause;
        Bun.gc(true);
        if (retry === 29) console.warn(`[bank-grade-reopen] Windows temporary file remains locked: ${folder}`);
        else await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
});
