import { describe, expect, it } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { buildBalancedPracticeBlocks } from '../balanced-plan.js';
import { validateBlockSpec } from '../practice-plan.js';

describe('balanced learning plan', () => {
  it('offers vocabulary, grammar, reading, cloze, listening and writing on every track', () => {
    for (const language of ['en', 'ja', 'ko'] as const) {
      const blocks = buildBalancedPracticeBlocks(language);
      expect(blocks.map(block => block.kind)).toEqual(['VOCAB_REVIEW', 'QUIZ', 'READING', 'CLOZE', 'DICTATION', 'WRITING']);
      expect(blocks.every(block => isOk(validateBlockSpec(block)))).toBe(true);
      expect(blocks.find(block => block.kind === 'CLOZE')?.skillIds).toEqual([`${language === 'ja' ? 'jp' : language}.reading.cloze`]);
      expect(blocks.find(block => block.kind === 'DICTATION')?.gradingMode).toBe('AUTO_IMMEDIATE');
    }
  });
});
