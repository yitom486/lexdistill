import { describe, expect, it } from 'bun:test';
import {
  buildEnglishAiReadingPrompt,
  buildKoreanAiReadingPrompt,
} from '../application/content-language-policy.js';

const HANGUL = /[\uAC00-\uD7A3]/;

describe('Korean AI reading prompt (TOPIK template)', () => {
  it('returns Korean prose with TOPIK band, not the English scaffold', () => {
    const out = buildKoreanAiReadingPrompt({ topic: '여행과 온천', difficulty: 2 });
    expect(HANGUL.test(out.body)).toBe(true);
    expect(HANGUL.test(out.title)).toBe(true);
    expect(out.body).not.toContain('interim EN scaffold');
    expect(out.body).not.toContain('This passage is a temporary English scaffold');
    expect(out.title).toContain('TOPIK 1–2급');
    expect(out.sourceLabel).toContain('TOPIK 1–2급');
  });

  it('scales the TOPIK band with difficulty', () => {
    expect(buildKoreanAiReadingPrompt({ topic: '독서', difficulty: 1 }).title).toContain('1–2급');
    expect(buildKoreanAiReadingPrompt({ topic: '독서', difficulty: 3 }).title).toContain('3–4급');
    expect(buildKoreanAiReadingPrompt({ topic: '독서', difficulty: 5 }).title).toContain('5–6급');
  });

  it('embeds the topic and TOPIK connectors', () => {
    const out = buildKoreanAiReadingPrompt({ topic: '환경 보호', difficulty: 3 });
    expect(out.body).toContain('환경 보호');
    expect(out.body).toContain('그래서');
    expect(out.body).toContain('하지만');
  });
});

describe('English AI reading prompt (regression guard)', () => {
  it('still returns the CET/Kaoyan scaffold', () => {
    const out = buildEnglishAiReadingPrompt({ topic: 'travel', difficulty: 3 });
    expect(out.title).toContain('CEFR B1–B2');
    expect(out.body).toContain('travel');
  });
});
