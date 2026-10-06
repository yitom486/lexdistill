import { describe, it, expect } from 'bun:test';
import { gradeObjectiveAnswer } from '../index.js';

/** M7-15 自 Gateway practice-grading.test.ts 迁入（行为一致；Gateway 原文件保留作兼容层覆盖）。 */
describe('practice objective grading (server-authoritative)', () => {
  it('maps option letters to canonical text and keyed legacy options', () => {
    expect(gradeObjectiveAnswer({ type: 'MULTIPLE_CHOICE', options: ['go', 'went'], correctAnswer: 'went' }, 'B').isCorrect).toBe(true);
    expect(gradeObjectiveAnswer({ type: 'MULTIPLE_CHOICE', options: [{ key: 'x', text: 'went' }, { key: 'y', text: 'go' }], correctAnswer: 'went' }, 'x').isCorrect).toBe(true);
    expect(gradeObjectiveAnswer({ type: 'MULTIPLE_CHOICE', options: ['go', 'went'], correctAnswer: 'B' }, 'went').isCorrect).toBe(true);
  });
  it('normalizes English dictation case and width without changing non-English letter case', () => {
    expect(gradeObjectiveAnswer({ type: 'LISTENING_DICTATION', language: 'en', correctAnswer: 'went' }, ' ＷＥＮＴ ').isCorrect).toBe(true);
    expect(gradeObjectiveAnswer({ type: 'FILL_IN_BLANK', language: 'ja', correctAnswer: 'ABC' }, 'abc').isCorrect).toBe(false);
    expect(gradeObjectiveAnswer({ type: 'FILL_IN_BLANK', correctAnswer: '' }, '').authoritative).toBe(false);
  });
  it('grades multiple-choice by exact match', () => {
    expect(
      gradeObjectiveAnswer({ type: 'MULTIPLE_CHOICE', correctAnswer: 'B' }, 'B').isCorrect,
    ).toBe(true);
    const wrong = gradeObjectiveAnswer({ type: 'MULTIPLE_CHOICE', correctAnswer: 'B' }, 'A');
    expect(wrong.isCorrect).toBe(false);
    expect(wrong.authoritative).toBe(true);
  });

  it('accepts fill-blank variants and trims whitespace', () => {
    const q = { type: 'FILL_IN_BLANK', correctAnswer: 'went', acceptableVariants: ['goed'] };
    expect(gradeObjectiveAnswer(q, '  went  ').isCorrect).toBe(true);
    expect(gradeObjectiveAnswer(q, 'goed').isCorrect).toBe(true);
    expect(gradeObjectiveAnswer(q, 'go').isCorrect).toBe(false);
  });

  it('grades sentence reorder by exact match', () => {
    expect(
      gradeObjectiveAnswer({ type: 'SENTENCE_REORDER', correctAnswer: 'a b c' }, 'a b c').isCorrect,
    ).toBe(true);
    expect(
      gradeObjectiveAnswer({ type: 'SENTENCE_REORDER', correctAnswer: 'a b c' }, 'a c b').isCorrect,
    ).toBe(false);
  });

  it('falls back as non-authoritative when the question is missing', () => {
    const res = gradeObjectiveAnswer(undefined, 'anything');
    expect(res.authoritative).toBe(false);
    expect(res.isCorrect).toBe(false);
  });

  it('falls back as non-authoritative when correctAnswer is not a string', () => {
    const res = gradeObjectiveAnswer({ type: 'MULTIPLE_CHOICE' }, 'A');
    expect(res).toEqual({ isCorrect: false, authoritative: false });
  });
});
