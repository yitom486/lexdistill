import { describe, expect, it, spyOn } from 'bun:test';
import { SubmissionLedger } from '../useSubmissionIdentity.js';

const seed = (userAnswer: string, submissionId = 'seed-id', timeSpentMs = 1234) => ({
  submissionId, taskId: 'task', paperId: 'paper-1', questionId: 'q1', answerType: 'FILL_BLANK',
  userAnswer, status: 'SUBMITTED' as const, isCorrect: null, score: null,
  timeSpentMs, attemptId: null, gradingError: null, model: null, adapter: null, grading: null,
});

describe('SubmissionLedger', () => {
  it('keeps the full UUID so equal 32-bit prefixes do not collide', () => {
    const uuid = spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('12345678-0000-4000-8000-000000000001')
      .mockReturnValueOnce('12345678-0000-4000-8000-000000000002');
    try {
      const ledger = new SubmissionLedger('paper-1', 'q1');
      expect(ledger.identify('is').submissionId).toBe('ui-12345678-0000-4000-8000-000000000001');
      expect(ledger.identify('are').submissionId).toBe('ui-12345678-0000-4000-8000-000000000002');
    } finally { uuid.mockRestore(); }
  });
  it('keeps one random identity per answer across retries without content hashing', () => {
    let now = 1000;
    let counter = 0;
    const ledger = new SubmissionLedger('paper-1', 'q1', () => now, () => `ui-test-${counter++}`);
    const first = ledger.identify('is');
    now += 500;
    expect(ledger.identify('is')).toEqual(first);
    expect(first.submissionId).toBe('ui-test-0');
    expect(first.timeSpentMs).toBe(0);
    // 曾经碰撞的答案对各自独立。
    expect(ledger.identify('answer-89279').submissionId).not.toBe(ledger.identify('answer-410886').submissionId);
  });

  it('isolates papers and questions and reuses backend seeds on reopen', () => {
    let counter = 0;
    const fresh = () => `ui-test-${counter++}`;
    const ledger = new SubmissionLedger('paper-1', 'q1', () => 0, fresh);
    ledger.seed([seed('is', 'backend-id', 4321)]);
    expect(ledger.identify('is')).toEqual({ submissionId: 'backend-id', timeSpentMs: 4321 });
    expect(ledger.identify('are').submissionId).toBe('ui-test-0');
    const otherPaper = new SubmissionLedger('paper-2', 'q1', () => 0, fresh);
    otherPaper.seed([seed('is', 'backend-id', 4321)]);
    // 同一答案换卷即独立身份，不沿用上一卷编号与耗时。
    expect(otherPaper.identify('is').submissionId).not.toBe('backend-id');
    const otherQuestion = new SubmissionLedger('paper-1', 'q2', () => 0, fresh);
    expect(otherQuestion.identify('is').submissionId).not.toBe('backend-id');
  });
});
