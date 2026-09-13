import { describe, it, expect } from 'bun:test';
import { gradeObjectiveAnswer } from '../index.js';

/** M7-15 自 Gateway practice-grading.test.ts 迁入（行为一致；Gateway 原文件保留作兼容层覆盖）。 */
describe('practice objective grading (server-authoritative)', () => {
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
