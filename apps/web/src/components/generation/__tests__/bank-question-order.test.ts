import { describe, expect, it } from 'bun:test';
import { joinOrderIndices, restoreOrderIndices } from '../BankQuestionCard.js';

describe('reorder by chunk index', () => {
  it('selects duplicate chunks independently and joins in order', () => {
    const chunks = ['He', 'had', 'had', 'lunch.'];
    expect(joinOrderIndices(chunks, [0, 1, 2, 3])).toBe('He had had lunch.');
    expect(restoreOrderIndices(chunks, 'He had had lunch.')).toEqual([0, 1, 2, 3]);
  });

  it('returns empty when the saved answer cannot be segmented', () => {
    expect(restoreOrderIndices(['a', 'b'], 'a c')).toEqual([]);
    expect(restoreOrderIndices(['a', 'b'], 'a')).toEqual([]);
  });
});
