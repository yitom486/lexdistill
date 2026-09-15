import { describe, expect, it } from 'bun:test';
import {
  groundStructureClassifications,
  type HeadingCandidate,
} from '../document-structure.js';

const candidates: HeadingCandidate[] = [
  { page: 3, text: '第3課' },
  { page: 5, text: '会話' },
];

describe('document structure domain', () => {
  it('grounds exact candidate text to its first observed page', () => {
    const result = groundStructureClassifications(
      [{ text: '第3課', kind: 'lesson', lessonNo: '123456789012345678', skillId: null }],
      [...candidates, { page: 8, text: '第3課' }],
      new Set()
    );

    expect(result).toEqual({
      classes: [{ text: '第3課', page: 3, kind: 'lesson', lessonNo: '1234567890123456', skillId: null }],
      dropped: 0,
    });
  });

  it('drops invalid kinds and text that is not grounded', () => {
    const result = groundStructureClassifications(
      [
        { text: '第3課', kind: 'chapter' },
        { text: '第99課', kind: 'lesson' },
      ],
      candidates,
      new Set()
    );

    expect(result).toEqual({ classes: [], dropped: 2 });
  });

  it('clears an unknown skill while preserving the grounded classification', () => {
    const result = groundStructureClassifications(
      [{ text: '会話', kind: 'section', skillId: 'jp.unknown' }],
      candidates,
      new Set(['jp.particle.ni_vs_de'])
    );

    expect(result.classes).toEqual([
      { text: '会話', page: 5, kind: 'section', lessonNo: null, skillId: null },
    ]);
    expect(result.dropped).toBe(0);
  });
});
