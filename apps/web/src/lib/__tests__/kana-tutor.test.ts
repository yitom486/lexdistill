import { describe, expect, it } from 'bun:test';
import { buildKanaTutorContext } from '../kana-tutor.js';
import type { KanaItem } from '@study-studio/protocol';
import { KANA_SEEDS } from '../../../../../packages/storage-sqlite/src/seeds/kana-seed.js';

const A: KanaItem = {
  id: 'kana_a',
  hiragana: 'あ',
  katakana: 'ア',
  romaji: 'a',
  row: 'あ行',
  col: 'あ段',
  mnemonic: '安字的一半',
  learningGuide: {
    soundDescription: '表示日语的 a 音，是一个发音单位。',
    memoryTip: '张大嘴说“啊”。',
    pronunciationTip: '口腔打开，短促地发 a。',
    confusionNotes: '与お看字形。',
    exampleWords: [{ word: '朝', reading: 'あさ', meaning: '早上' }],
  },
  type: 'SEION',
} as KanaItem;

const I: KanaItem = {
  id: 'kana_i',
  hiragana: 'い',
  katakana: 'イ',
  romaji: 'i',
  row: 'あ行',
  col: 'い段',
  type: 'SEION',
} as KanaItem;

describe('buildKanaTutorContext', () => {
  it('uses selected script facts and curated comparisons, with no random pool filler or wrong etymology', () => {
    const a = KANA_SEEDS.find((item) => item.id === 'kana_a')!;
    const ctx = buildKanaTutorContext({ kana: a, pool: [a, I], script: 'KATAKANA' });
    expect(ctx.questionText).toContain('滑梯');
    expect(ctx.questionText).toContain('マ');
    expect(ctx.questionText).toContain('アイス');
    expect(ctx.questionText).not.toContain('绳子');
    expect(ctx.questionText).not.toContain('イ」');
    expect(ctx.explanation).not.toContain('安');
    expect(ctx.explanation).not.toContain('绳子');
    const hira = buildKanaTutorContext({ kana: a, script: 'HIRAGANA' });
    expect(hira.questionText).toContain('绳子');
    expect(hira.questionText).toContain('お');
  });

  it('builds a memorization prompt with face, romaji and confusables', () => {
    const ctx = buildKanaTutorContext({ kana: A, pool: [A, I] });
    expect(ctx.questionText).toContain('あ');
    expect(ctx.questionText).toContain('a');
    expect(ctx.questionText).toContain('口诀');
    expect(ctx.questionText).toContain('い');
    expect(ctx.questionText).toContain('课程事实');
    expect(ctx.questionText).toContain('不要把假名编造成');
    expect(ctx.correctAnswer).toBe('あ / ア (a)');
    expect(ctx.skillTag).toBe('jp.kana.hiragana');
    expect(ctx.explanation).toContain('安字的一半');
    expect(ctx.explanation).toContain('张大嘴说“啊”');
  });

  it('switches face and skill for katakana', () => {
    const ctx = buildKanaTutorContext({ kana: A, pool: [A, I], script: 'KATAKANA' });
    expect(ctx.questionText).toContain('ア');
    expect(ctx.skillTag).toBe('jp.kana.katakana');
  });

  it('asks about the mistake when the drill answer was wrong', () => {
    const ctx = buildKanaTutorContext({ kana: A, pool: [A, I], wasWrong: true, userPick: 'い' });
    expect(ctx.questionText).toContain('认成了「い」');
    expect(ctx.questionText).toContain('为什么错');
    expect(ctx.userAnswer).toBe('い');
  });

  it('never blocks when the pool is empty', () => {
    const ctx = buildKanaTutorContext({ kana: A, pool: [] });
    expect(ctx.questionText).toContain('あ');
    expect(ctx.questionText).not.toContain('undefined');
    expect(ctx.explanation).not.toContain('undefined');
  });
});
