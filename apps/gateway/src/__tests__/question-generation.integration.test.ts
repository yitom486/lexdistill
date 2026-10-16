import { afterEach, describe, expect, it } from 'bun:test';
import { isOk, type BusinessError, type Result } from '@lexdistill/shared';
import type { BankSubmitReceipt, BankPaperReceipt, BankQuestionRecord } from '@lexdistill/protocol';
import { GENERATION_TOOL_NAMES } from '../modules/question-generation/public.js';
import { binding, config, fixture, listening, question, sixFormats } from './question-generation.fixtures.js';

function value<T>(result: Result<unknown, BusinessError>): T {
  if (!isOk(result)) throw result.error;
  return result.value as T;
}
describe('fixed generation tools with real isolated SQLite', () => {
  let f: ReturnType<typeof fixture>;
  afterEach(async () => { if (f) { await f.tools.dispose(); f.sqlite.close(); } });
  it('isolates six task tools and freezes host settings in the dynamic prompt', async () => {
    f = fixture();
    expect(f.tools.registry.list().map(t => t.name)).toEqual([...GENERATION_TOOL_NAMES]);
    expect(f.tools.registry.list().filter(t => t.permission === 'WRITE').map(t => t.name)).toEqual(['generation.submit', 'generation.audio', 'generation.paper']);
    expect(f.tools.dynamicPrompt()).toContain('configured-female');
    expect(f.tools.dynamicPrompt()).toContain('configured-model');
    const snapshot = value<{ config: typeof config }>(await f.invoke('generation.config', {}));
    snapshot.config.maxQuestions = 99;
    expect(f.repository.config(binding).config.maxQuestions).toBe(20);
    expect(isOk(await f.invoke('generation.config', { userId: 'other' }))).toBe(false);
    expect(isOk(await f.invoke('learning.content', {}))).toBe(false);
  });
  it('persists all six answer types, generates dialogue audio and assembles an idempotent mixed paper', async () => {
    f = fixture();
    const input = { requestKey: 'batch', questions: sixFormats() };
    const saved = value<BankSubmitReceipt>(await f.invoke('generation.submit', input));
    expect(saved.added).toBe(6); expect(saved.usedQuestions).toBe(6);
    for (const table of ['multiple_choice', 'fill_blank', 'reorder', 'short_answer', 'translation', 'writing']) {
      expect(f.sqlite.query(`SELECT count(*) AS n FROM bank_${table}_questions`).get()).toEqual({ n: 1 });
    }
    expect(await f.invoke('generation.submit', input)).toEqual(await f.invoke('generation.submit', input));
    const materialId = saved.materialIds[3]!;
    expect(isOk(await f.invoke('generation.paper', { requestKey: 'paper', title: 'Mixed practice', questionIds: saved.questionIds }))).toBe(false);
    const audio = await f.invoke('generation.audio', { materialId }); expect(isOk(audio)).toBe(true);
    expect(await f.invoke('generation.audio', { materialId })).toEqual(audio);
    const paperInput = { requestKey: 'paper', title: 'Mixed practice', questionIds: [...saved.questionIds].reverse() };
    const paper = value<BankPaperReceipt>(await f.invoke('generation.paper', paperInput));
    expect(value<BankPaperReceipt>(await f.invoke('generation.paper', paperInput))).toEqual(paper);
    const rows = f.sqlite.query('SELECT question_id,snapshot_json FROM bank_paper_items WHERE paper_id=? ORDER BY ordinal').all(paper.paperId) as { question_id: string; snapshot_json: string }[];
    expect(rows.map(r => r.question_id)).toEqual(paperInput.questionIds);
    expect(JSON.parse(rows[2]!.snapshot_json).material.mode).toBe('DIALOGUE');
    expect(f.sqlite.query('SELECT count(*) AS n FROM quiz_attempts').get()).toEqual({ n: 0 });
    await f.tools.dispose('COMPLETED');
    expect(f.repository.readAudio(binding.userId, binding.taskId, materialId).bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(() => f.repository.readAudio('other', binding.taskId, materialId)).toThrow();
  });
  it('reuses duplicate questions under new request keys without consuming extra quota', async () => {
    f = fixture({ maxQuestions: 1 });
    const first = value<BankSubmitReceipt>(await f.invoke('generation.submit', { requestKey: 'one', questions: [question()] }));
    const next = value<BankSubmitReceipt>(await f.invoke('generation.submit', { requestKey: 'two', questions: [question(), question()] }));
    expect(next.added).toBe(0); expect(next.usedQuestions).toBe(1);
    expect(next.questionIds).toEqual([first.questionIds[0]!, first.questionIds[0]!]);
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'one', questions: [question({ prompt: 'Changed' })] }))).toBe(false);
  });
  it('rolls back an entire over-quota batch, including materials, typed rows and receipts', async () => {
    f = fixture({ maxQuestions: 1 });
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'batch', questions: [question(), listening()] }))).toBe(false);
    for (const table of ['bank_questions', 'bank_materials', 'generation_task_questions', 'generation_receipts']) expect(f.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'batch', questions: [question()] }))).toBe(true);
  });
  it('enforces per-category quotas and configured answer formats', async () => {
    f = fixture({ categoryLimits: { GRAMMAR: 1 }, allowedAnswerTypes: ['MULTIPLE_CHOICE'] });
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'quota', questions: [question(), question({ prompt: 'Different' })] }))).toBe(false);
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'category', questions: [listening()] }))).toBe(false);
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'format', questions: [question({ answer: { type: 'FILL_BLANK', acceptedAnswers: ['is'] } })] }))).toBe(false);
  });
  it('rolls back earlier writes on a database failure and allows the same batch to retry', async () => {
    f = fixture();
    f.sqlite.run("CREATE TEMP TRIGGER fail_bank_insert BEFORE INSERT ON bank_questions WHEN NEW.prompt='Fail here' BEGIN SELECT RAISE(ABORT,'test write failure'); END");
    const input = { requestKey: 'retry', questions: [question(), question({ prompt: 'Fail here' })] };
    expect(isOk(await f.invoke('generation.submit', input))).toBe(false);
    expect(f.sqlite.query('SELECT count(*) AS n FROM bank_questions').get()).toEqual({ n: 0 });
    f.sqlite.run('DROP TRIGGER fail_bank_insert');
    expect(value<BankSubmitReceipt>(await f.invoke('generation.submit', input)).added).toBe(2);
  });
  it('enforces paper count and category limits when drawing from an existing pool', async () => {
    f = fixture();
    const saved = value<BankSubmitReceipt>(await f.invoke('generation.submit', { requestKey: 'batch', questions: [question(), question({ prompt: 'Second' })] }));
    const task = { ...binding, taskId: 'paper-only' };
    f.repository.createTask(task, { ...config, categoryLimits: { GRAMMAR: 1 } }, f.expiresAt);
    expect(() => f.repository.assemble(task, { requestKey: 'many', title: 'Paper', questionIds: saved.questionIds })).toThrow();
    f.repository.assemble(task, { requestKey: 'one', title: 'Paper', questionIds: [saved.questionIds[0]!] });
    expect(() => f.repository.assemble(task, { requestKey: 'two', title: 'Paper', questionIds: [saved.questionIds[1]!] })).toThrow();
    f.repository.finishTask(task, 'COMPLETED');
  });
  it('rejects language/level/tier mismatch, invalid answer keys and speaker scripts', async () => {
    f = fixture();
    const invalid = [question({ targetLevel: 'N5' }), question({ difficultyTier: 5 }), question({ skillIds: ['ja.grammar'] }),
      question({ answer: { type: 'MULTIPLE_CHOICE', options: [{ key: 'A', text: 'one' }, { key: 'A', text: 'two' }], correctKey: 'Z' } }),
      question({ answer: { type: 'REORDER', chunks: ['a', 'b'], correctOrder: [0, 0] } }),
      listening(), listening('NEWS')];
    invalid[5]!.material = { type: 'LISTENING', title: 'Bad', mode: 'DIALOGUE', turns: [{ speaker: 'NARRATOR', text: 'Hi' }] };
    invalid[6]!.material = { type: 'LISTENING', title: 'Bad news', mode: 'NEWS', turns: [{ speaker: 'NARRATOR', text: 'Hi' }] };
    for (const [i, q] of invalid.entries()) expect(isOk(await f.invoke('generation.submit', { requestKey: `bad${i}`, questions: [q] }))).toBe(false);
    expect(f.repository.config(binding).usedQuestions).toBe(0);
  });
  it('blocks another user, session, turn and expired tasks before reads or writes', async () => {
    f = fixture();
    for (const context of [{ ...binding, userId: 'other' }, { ...binding, sessionId: 'other' }, { ...binding, turnId: 'other' }]) {
      expect(isOk(await f.invoke('generation.submit', { requestKey: 'bad', questions: [question()] }, context))).toBe(false);
      expect(() => f.repository.config(context)).toThrow();
    }
    f.sqlite.query('UPDATE generation_tasks SET expires_at=?').run('2000-01-01T00:00:00.000Z');
    expect(isOk(await f.invoke('generation.config', {}))).toBe(false);
    expect(isOk(await f.invoke('generation.submit', { requestKey: 'expired', questions: [question()] }))).toBe(false);
  });
  it('reads existing per-user answer/mistake history without creating a second history store', async () => {
    f = fixture();
    const saved = value<BankSubmitReceipt>(await f.invoke('generation.submit', { requestKey: 'batch', questions: [question(), question({ prompt: 'Untouched' })] }));
    f.sqlite.query(`INSERT INTO quiz_attempts (id,user_id,language,question_id,user_answer,is_correct,score,time_spent_ms,tested_skill_id,created_at)
      VALUES (?,?, 'en',?,'B',0,0,100,'en.grammar.present',?)`).run('attempt', binding.userId, saved.questionIds[0]!, new Date().toISOString());
    f.sqlite.query(`INSERT INTO quiz_attempts (id,user_id,language,question_id,user_answer,is_correct,score,time_spent_ms,tested_skill_id,created_at)
      VALUES ('foreign','other','en',?,'B',0,0,100,'en.grammar.present',?)`).run(saved.questionIds[1]!, new Date().toISOString());
    const wrong = value<{ items: BankQuestionRecord[] }>(await f.invoke('generation.pool', { history: 'MISTAKES' })).items;
    expect(wrong.map(q => q.id)).toEqual([saved.questionIds[0]!]); expect(wrong[0]!.history).toEqual({ attempts: 1, wrongAttempts: 1, hasMistake: true });
    expect(value<{ items: BankQuestionRecord[] }>(await f.invoke('generation.pool', { history: 'UNANSWERED' })).items.map(q => q.id)).toEqual([saved.questionIds[1]!]);
  });
  it('rejects foreign, duplicate and excessive paper items and preserves a failed request for retry', async () => {
    f = fixture({ maxPaperItems: 1 });
    const q = value<BankSubmitReceipt>(await f.invoke('generation.submit', { requestKey: 'batch', questions: [question()] })).questionIds[0]!;
    for (const ids of [['missing'], [q, q]]) expect(isOk(await f.invoke('generation.paper', { requestKey: 'paper', title: 'Test', questionIds: ids }))).toBe(false);
    expect(f.sqlite.query('SELECT count(*) AS n FROM bank_papers').get()).toEqual({ n: 0 });
    expect(isOk(await f.invoke('generation.paper', { requestKey: 'paper', title: 'Test', questionIds: [q] }))).toBe(true);
    expect(isOk(await f.invoke('generation.paper', { requestKey: 'paper', title: 'Changed', questionIds: [q] }))).toBe(false);
  });
  it('uses immutable task creation and validates JA/EN/KO levels rather than guessing', async () => {
    f = fixture();
    expect(() => f.repository.createTask(binding, { ...config, maxQuestions: 99 }, f.expiresAt)).toThrow();
    for (const [language, targetLevel] of [['ja', 'A1'], ['en', 'N5'], ['ko', 'N5']] as const) expect(() => f.repository.createTask({ ...binding, taskId: language }, { ...config, language, targetLevel }, f.expiresAt)).toThrow();
    for (const [language, targetLevel] of [['ja', 'N5'], ['ko', 'TOPIK_1']] as const) {
      const b = { ...binding, taskId: language };
      f.repository.createTask(b, { ...config, language, targetLevel }, f.expiresAt);
      const saved = f.repository.submit(b, { requestKey: 'localized', questions: [question({ targetLevel, skillIds: [`${language}.grammar.present`] })] });
      expect(saved.added).toBe(1); expect(f.repository.config(b).config.targetLevel).toBe(targetLevel);
    }
  });
  it('protects type-specific foreign keys at the database boundary', async () => {
    f = fixture();
    const q = value<BankSubmitReceipt>(await f.invoke('generation.submit', { requestKey: 'batch', questions: [question()] })).questionIds[0]!;
    expect(() => f.sqlite.query('INSERT INTO bank_writing_questions(question_id,answer_json) VALUES (?,?)').run(q, '{}')).toThrow();
  });
});
