import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BusinessError, isErr, isOk } from '@study-studio/shared';
import type { BankAnswerSubmit, BankPaperReceipt, BankSubmitReceipt } from '@study-studio/protocol';
import { SqliteQuestionGenerationRepository } from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { createQuestionGenerationTools } from '../modules/question-generation/public.js';
import { GenerationTaskService } from '../modules/question-generation/service.js';
import { gradeBankSubjective, normalizeBankObjective } from '../modules/practice/persistence/bank-answer.js';
import { binding, config, listening, question } from './question-generation.fixtures.js';

const FILL = () => question({ category: 'CLOZE', prompt: 'Fill the blank.',
  material: { type: 'READING', title: 'School', text: 'She ___ a student.' },
  answer: { type: 'FILL_BLANK', acceptedAnswers: ['is', 'be'] } });
const REORDER = () => question({ category: 'READING', prompt: 'Put the sentence in order.',
  material: { type: 'READING', title: 'School', text: 'She is a student.' },
  answer: { type: 'REORDER', chunks: ['She', 'is', 'a student.'], correctOrder: [0, 1, 2] } });
const LISTEN_MC = () => { const q = listening('DIALOGUE'); q.prompt = 'What greeting?';
  q.answer = { type: 'MULTIPLE_CHOICE', options: [{ key: 'A', text: 'Hello.' }, { key: 'B', text: 'Goodbye.' }], correctKey: 'A' }; return q; };
const TRANSLATION = () => question({ category: 'VOCABULARY', prompt: 'Translate hello.',
  answer: { type: 'TRANSLATION', referenceAnswer: 'hello', rubric: 'Correct greeting.', targetLanguage: 'en' } });
const WRITING = () => question({ category: 'WRITING', prompt: 'Introduce yourself.',
  answer: { type: 'WRITING', sampleAnswer: 'I am a student.', rubric: 'Clear simple sentences.', minWords: 3, maxWords: 30 } });
const SHORT = () => { const q = listening('PASSAGE');
  q.answer = { type: 'SHORT_ANSWER', referenceAnswer: 'Hello.', rubric: 'Recognizes the greeting.' }; return q; };

const NAMES = ['mc', 'fill', 'reorder', 'listenMc', 'translation', 'writing', 'short'] as const;

async function setupPaper(repo: DrizzleLearnerRepository) {
  const sqlite = repo.getRawDb();
  const bank = new SqliteQuestionGenerationRepository(sqlite);
  const service = new GenerationTaskService({ repository: bank });
  const task = service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId, config });
  const snapshot = service.queryTask(binding.userId, task.taskId);
  const tools = createQuestionGenerationTools(
    { repository: bank, audio: { async render() { return { bytes: new Uint8Array([7, 7]), mimeType: 'audio/wav' }; } } },
    snapshot.binding, snapshot.config, snapshot.expiresAt, { runLimits: snapshot.runLimits });
  const drafts = [question(), FILL(), REORDER(), LISTEN_MC(), TRANSLATION(), WRITING(), SHORT()];
  const listeningIndexes = new Set([3, 6]);
  const unwrap = <T>(result: unknown): T => {
    if (!isOk(result as never)) throw (result as { error: Error }).error;
    return (result as { value: T }).value;
  };
  try {
    const saved = unwrap<BankSubmitReceipt>(await tools.registry.execute('generation.submit', { requestKey: 'p2', questions: drafts }, snapshot.binding));
    const materials = saved.materialIds;
    for (const [index, materialId] of materials.entries()) {
      if (!materialId || !listeningIndexes.has(index)) continue;
      const audio = await tools.registry.execute('generation.audio', { materialId }, snapshot.binding);
      unwrap(audio);
    }
    const paper = unwrap<BankPaperReceipt>(await tools.registry.execute('generation.paper',
      { requestKey: 'p2paper', title: 'P2', questionIds: saved.questionIds }, snapshot.binding));
    const ids: Record<string, string> = {};
    NAMES.forEach((name, index) => { ids[name] = saved.questionIds[index]!; });
    const pool = async (history: 'ALL' | 'UNANSWERED' | 'MISTAKES') =>
      unwrap<{ items: Array<{ id: string }> }>(await tools.registry.execute('generation.pool', { history, limit: 50 }, snapshot.binding));
    return { service, bank, taskId: task.taskId, paperId: paper.paperId, ids, pool, dispose: () => tools.dispose('COMPLETED') };
  } catch (error) {
    await tools.dispose().catch(() => undefined);
    throw error;
  }
}

const answer = (extra: Record<string, unknown>): BankAnswerSubmit =>
  ({ timeSpentMs: 500, ...extra }) as BankAnswerSubmit;

describe('P2 bank answers share the practice record owners', () => {
  let repos: DrizzleLearnerRepository[] = [];
  afterEach(() => { for (const repo of repos) repo.getRawDb().close(); repos = []; });
  async function paper() {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    return { repo, ...(await setupPaper(repo)) };
  }

  it('grades MC/FILL/REORDER with the shared owner and records into the same history tables', async () => {
    const f = await paper();
    await f.dispose();
    const byKey = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-mc', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'A' }));
    expect(isOk(byKey)).toBe(true);
    if (!isOk(byKey)) return;
    expect(byKey.value).toMatchObject({ isCorrect: true, score: 1, correctAnswer: 'A', persistedToDb: true });
    const byText = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-mc-text', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'is' }));
    expect(isOk(byText) && byText.value.isCorrect).toBe(true);
    const fillVariant = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-fill', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['fill']!, userAnswer: ' BE ' }));
    expect(isOk(fillVariant) && fillVariant.value.isCorrect).toBe(true);
    const reorder = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-reorder', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['reorder']!, userAnswer: 'She is a student.' }));
    expect(isOk(reorder) && reorder.value.isCorrect).toBe(true);
    const listen = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-listen', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['listenMc']!, userAnswer: 'A' }));
    expect(isOk(listen) && listen.value.isCorrect).toBe(true);
    const wrong = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-wrong', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'B' }));
    expect(isOk(wrong) && wrong.value.isCorrect).toBe(false);
    expect(f.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 6 });
    const mistakes = await f.repo.getMistakes(binding.userId, { language: 'en' });
    expect(isOk(mistakes)).toBe(true);
    if (isOk(mistakes)) {
      expect(mistakes.value.map(m => m.questionId)).toContain(f.ids['mc']!);
      expect(mistakes.value.every(m => m.userId === binding.userId)).toBe(true);
    }
    const progress = await f.repo.getDailyTaskProgress(binding.userId);
    expect(isOk(progress) && progress.value.quizzesCount).toBe(6);
  });

  it('keeps idempotency, conflicts, ownership and route boundaries of the existing answer path', async () => {
    const f = await paper();
    await f.dispose();
    const input = answer({ submissionId: 's1', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'A' });
    const first = await f.repo.submitBankObjectiveAnswer(binding.userId, input);
    const replay = await f.repo.submitBankObjectiveAnswer(binding.userId, input);
    expect(replay).toEqual(first);
    expect(f.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
    expect(isErr(await f.repo.submitBankObjectiveAnswer(binding.userId, { ...input, userAnswer: 'B' }))).toBe(true);
    expect(isErr(await f.repo.submitBankObjectiveAnswer('other', input))).toBe(true);
    expect(isErr(await f.repo.submitBankObjectiveAnswer(binding.userId, { ...input, submissionId: 's2', questionId: 'missing' }))).toBe(true);
    expect(isErr(await f.repo.submitBankObjectiveAnswer(binding.userId, { ...input, submissionId: 's3', questionId: f.ids['translation']! }))).toBe(true);
    expect(isErr(await f.repo.submitBankSubjectiveAnswer(binding.userId, { ...input, submissionId: 's4' }))).toBe(true);
    expect(isErr(await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's5', taskId: 'foreign', paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'A' })))).toBe(true);
  });

  it('rolls back attempts, activity and metrics when saving the mistake fails', async () => {
    const f = await paper();
    await f.dispose();
    const failure = spyOn(f.repo, 'saveMistake').mockResolvedValue(
      { ok: false, error: new BusinessError('E_TEST', 'test write failure', 'DATABASE') } as never);
    const result = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-fail', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'B' }));
    failure.mockRestore();
    expect(isErr(result)).toBe(true);
    expect(f.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
    const retry = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-fail', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'B' }));
    expect(isOk(retry)).toBe(true);
  });

  it('moves real answers through generation.pool UNANSWERED and MISTAKES without seeded history', async () => {
    const f = await paper();
    const before = (await f.pool('UNANSWERED')).items.map(q => q.id);
    expect(before).toContain(f.ids['mc']!);
    await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-pool', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'A' }));
    const afterCorrect = (await f.pool('UNANSWERED')).items.map(q => q.id);
    expect(afterCorrect).not.toContain(f.ids['mc']!);
    expect((await f.pool('MISTAKES')).items).toHaveLength(0);
    await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-pool-wrong', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['fill']!, userAnswer: 'was' }));
    const mistakes = await f.pool('MISTAKES');
    expect(mistakes.items.map(q => q.id)).toEqual([f.ids['fill']!]);
    expect(mistakes.items[0]!).toMatchObject({ history: { attempts: 1, wrongAttempts: 1, hasMistake: true } });
    await f.dispose();
  });

  it('retains subjective answers as SUBMITTED and records only exact matches', async () => {
    const f = await paper();
    await f.dispose();
    const exact = await f.repo.submitBankSubjectiveAnswer(binding.userId,
      answer({ submissionId: 'sub-exact', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['short']!, userAnswer: 'Hello.' }));
    expect(isOk(exact)).toBe(true);
    if (!isOk(exact)) return;
    expect(exact.value).toMatchObject({ status: 'GRADED', isCorrect: true, score: 1, persistedToDb: true });
    const pending = await f.repo.submitBankSubjectiveAnswer(binding.userId,
      answer({ submissionId: 'sub-pending', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['translation']!, userAnswer: 'hola' }));
    expect(isOk(pending)).toBe(true);
    if (!isOk(pending)) return;
    expect(pending.value).toMatchObject({ status: 'SUBMITTED', persistedToDb: true });
    expect(pending.value).not.toHaveProperty('isCorrect');
    expect(pending.value).not.toHaveProperty('score');
    // 翻译和写作即使命中参考答案也不自动给分，只走显式批改入口。
    const translationExact = await f.repo.submitBankSubjectiveAnswer(binding.userId,
      answer({ submissionId: 'sub-tr-exact', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['translation']!, userAnswer: 'hello' }));
    expect(isOk(translationExact)).toBe(true);
    if (!isOk(translationExact)) return;
    expect(translationExact.value).toMatchObject({ status: 'SUBMITTED', persistedToDb: true });
    expect(translationExact.value).not.toHaveProperty('isCorrect');
    expect(translationExact.value).not.toHaveProperty('score');
    const writingExact = await f.repo.submitBankSubjectiveAnswer(binding.userId,
      answer({ submissionId: 'sub-wr-exact', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['writing']!, userAnswer: 'I am a student.' }));
    expect(isOk(writingExact)).toBe(true);
    if (!isOk(writingExact)) return;
    expect(writingExact.value).toMatchObject({ status: 'SUBMITTED', persistedToDb: true });
    expect(writingExact.value).not.toHaveProperty('isCorrect');
    expect(writingExact.value).not.toHaveProperty('score');
    // 待批改不写判分记录与错题，不泄露参考答案。
    expect(f.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
    expect(JSON.stringify(pending.value)).not.toContain('hello');
    const replay = await f.repo.submitBankSubjectiveAnswer(binding.userId,
      answer({ submissionId: 'sub-pending', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['translation']!, userAnswer: 'hola' }));
    expect(replay).toEqual(pending);
    expect(isErr(await f.repo.submitBankSubjectiveAnswer(binding.userId,
      answer({ submissionId: 'sub-pending', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['translation']!, userAnswer: 'hello' })))).toBe(true);
    expect(isErr(await f.repo.submitBankSubjectiveAnswer('other',
      answer({ submissionId: 'sub-exact', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['short']!, userAnswer: 'Hello.' })))).toBe(true);
  });

  it('replays a stored GRADING_FAILED state without fabricating a score', async () => {
    const f = await paper();
    await f.dispose();
    const bank = new SqliteQuestionGenerationRepository(f.repo.getRawDb());
    bank.insertBankSubmission({ userId: binding.userId, submissionId: 'sub-broken', taskId: f.taskId,
      paperId: f.paperId, questionId: f.ids['short']!, answerType: 'SHORT_ANSWER', userAnswer: 'Hello.', timeSpentMs: 500 });
    bank.settleBankSubmission(binding.userId, 'sub-broken', { status: 'GRADING_FAILED', gradingError: 'E_GRADING_FAILED' });
    const replay = await f.repo.submitBankSubjectiveAnswer(binding.userId,
      answer({ submissionId: 'sub-broken', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['short']!, userAnswer: 'Hello.' }));
    expect(isOk(replay)).toBe(true);
    if (!isOk(replay)) return;
    expect(replay.value).toMatchObject({ status: 'GRADING_FAILED', persistedToDb: true });
    expect(replay.value).not.toHaveProperty('isCorrect');
    expect(replay.value).not.toHaveProperty('score');
    expect(f.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
  });

  it('releases review snapshots only for answered items', async () => {
    const f = await paper();
    await f.dispose();
    const before = f.service.readReviewPaper(binding.userId, f.taskId, f.paperId);
    expect(before.items.every(item => !item.reviewed)).toBe(true);
    expect(JSON.stringify(before)).not.toContain('correctKey');
    await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 's-rev', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'A' }));
    const after = f.service.readReviewPaper(binding.userId, f.taskId, f.paperId);
    const reviewed = after.items.find(item => item.id === f.ids['mc']!);
    const hidden = after.items.find(item => item.id === f.ids['fill']!);
    expect(reviewed?.reviewed).toBe(true);
    expect(JSON.stringify(reviewed)).toContain('correctKey');
    expect(hidden?.reviewed).toBe(false);
    expect(JSON.stringify(hidden)).not.toContain('acceptedAnswers');
    // 作答保留读口不携带任何参考答案与评分依据。
    const leaked = JSON.stringify(f.service.listBankSubmissions(binding.userId, f.taskId, f.paperId));
    for (const key of ['referenceAnswer', 'sampleAnswer', 'acceptedAnswers', 'correctKey', 'correctOrder', 'rubric']) {
      expect(leaked).not.toContain(key);
    }
  });

  it('survives application reopen with attempts, submissions and pool history intact', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lingua-p2-test-'));
    try {
      const path = join(folder, 'bank.db');
      const repo = new DrizzleLearnerRepository(path);
      const { service, taskId, paperId, ids } = await setupPaper(repo);
      await repo.submitBankObjectiveAnswer(binding.userId,
        answer({ submissionId: 's-reopen', taskId, paperId, questionId: ids['mc']!, userAnswer: 'B' }));
      await repo.submitBankSubjectiveAnswer(binding.userId,
        answer({ submissionId: 'sub-reopen', taskId, paperId, questionId: ids['translation']!, userAnswer: 'hola' }));
      void service;
      // Windows 下 WAL 关闭后仍可能 holding 锁：checkpoint 并切回 DELETE 再关，供清理。
      repo.getRawDb().run('PRAGMA wal_checkpoint(TRUNCATE)');
      repo.getRawDb().run('PRAGMA journal_mode=DELETE');
      repo.getRawDb().close();
      const reopened = new DrizzleLearnerRepository(path);
      try {
        expect(reopened.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 1 });
        const bank = new SqliteQuestionGenerationRepository(reopened.getRawDb());
        expect(bank.getBankSubmission(binding.userId, 'sub-reopen')?.status).toBe('SUBMITTED');
        const mistakes = await reopened.getMistakes(binding.userId, { language: 'en' });
        expect(isOk(mistakes) && mistakes.value.map(m => m.questionId)).toContain(ids['mc']!);
        const replay = await reopened.submitBankObjectiveAnswer(binding.userId,
          answer({ submissionId: 's-reopen', taskId, paperId, questionId: ids['mc']!, userAnswer: 'B' }));
        expect(isOk(replay) && replay.value.isCorrect).toBe(false);
      } finally {
        reopened.getRawDb().run('PRAGMA wal_checkpoint(TRUNCATE)');
        reopened.getRawDb().run('PRAGMA journal_mode=DELETE');
        reopened.getRawDb().close();
      }
    } finally {
      // Windows 下关闭后的文件锁释放时机不稳定：有限重试，仍删不掉则告警后放行，
      // 不因测试卫生问题掩盖已通过的持久化断言（残留位于系统临时目录）。
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          for (const file of ['bank.db', 'bank.db-wal', 'bank.db-shm']) rmSync(join(folder, file), { force: true });
          break;
        } catch {
          if (attempt === 29) console.warn(`[p2-reopen-test] 临时库清理跳过：${folder}`);
          else await new Promise(r => setTimeout(r, 100));
        }
      }
      try { rmdirSync(folder); } catch { /* 残留由系统临时目录策略处理 */ }
    }
  });

  it('separates submission identities across papers for the same answer text', async () => {
    const f = await paper();
    await f.dispose();
    const first = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 'x-paper-1', taskId: f.taskId, paperId: f.paperId, questionId: f.ids['mc']!, userAnswer: 'A' }));
    expect(isOk(first)).toBe(true);
    const next = f.service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: 'next-paper',
      config: (await import('./question-generation.fixtures.js')).config });
    const nextSnapshot = f.service.queryTask(binding.userId, next.taskId);
    const secondPaper = f.bank.assemble(nextSnapshot.binding,
      { requestKey: 'second', title: 'Second', questionIds: [f.ids['mc']!] });
    // 同一提交键换试卷即冲突；换键后同题同答案可独立记录。
    const rebound = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 'x-paper-1', taskId: next.taskId, paperId: secondPaper.paperId, questionId: f.ids['mc']!, userAnswer: 'A' }));
    expect(isErr(rebound)).toBe(true);
    const second = await f.repo.submitBankObjectiveAnswer(binding.userId,
      answer({ submissionId: 'x-paper-2', taskId: next.taskId, paperId: secondPaper.paperId, questionId: f.ids['mc']!, userAnswer: 'A' }));
    expect(isOk(second)).toBe(true);
    expect(f.repo.getRawDb().query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 2 });
  });

  it('redacts private grading receipts from the reopen reader except after valid grading', async () => {
    const f = await paper();
    await f.dispose();
    f.bank.insertBankSubmission({ userId: binding.userId, submissionId: 'leak-check', taskId: f.taskId,
      paperId: f.paperId, questionId: f.ids['short']!, answerType: 'SHORT_ANSWER', userAnswer: 'Hi.' });
    f.bank.settleBankSubmission(binding.userId, 'leak-check', { status: 'GRADING_FAILED', gradingError: 'E_TEST',
      grading: { score: 10, maxScore: 100, feedback: 'Private feedback', suggestions: [] }, model: 'm', adapter: 'a' });
    const listed = f.service.listBankSubmissions(binding.userId, f.taskId, f.paperId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ status: 'GRADING_FAILED', userAnswer: 'Hi.' });
    expect(listed[0]!.grading).toBeNull();
    // 私自保留仍在，供同配置重试复用。
    expect(f.bank.getBankSubmission(binding.userId, 'leak-check')?.grading).toMatchObject({ score: 10 });
    f.bank.settleBankSubmission(binding.userId, 'leak-check', { status: 'GRADED', isCorrect: false, score: 0.1,
      grading: { score: 10, maxScore: 100, feedback: 'Private feedback', suggestions: [] }, model: 'm', adapter: 'a' });
    expect(f.service.listBankSubmissions(binding.userId, f.taskId, f.paperId)[0]!.grading).toMatchObject({ score: 10 });
    expect(() => f.service.listBankSubmissions('other', f.taskId, f.paperId)).toThrow();
  });

  it('keeps grading boundaries pure: no similarity invention, no reference fabrication', () => {    expect(() => normalizeBankObjective({ ...question(), answer: { type: 'SHORT_ANSWER', referenceAnswer: 'x', rubric: 'y' } } as never)).toThrow();
    expect('isCorrect' in gradeBankSubjective('Hello.', ' Hello. ', 'en')).toBe(true);
    expect('pending' in gradeBankSubjective('Hello.', 'Hi there')).toBe(true);
    expect(() => gradeBankSubjective('   ', 'Hi')).toThrow();
  });
});
