import { describe, expect, it } from 'bun:test';
import { LEARNING_SHELL_CONFIGS, resolveGuardTab } from '../learning-shell.js';

describe('resolveGuardTab (P5-E6)', () => {
  it('设置页面在所有学习轨道均可访问', () => {
    for (const track of ['ja', 'en', 'ko'] as const) {
      expect(resolveGuardTab(track, 'SETTINGS')).toBe('SETTINGS');
    }
  });
  it('keeps legal tabs unchanged for all tracks', () => {
    for (const track of ['en', 'ja', 'ko'] as const) {
      for (const tab of LEARNING_SHELL_CONFIGS[track].allowedTabs) {
        expect(resolveGuardTab(track, tab)).toBe(tab);
      }
    }
  });

  it('sends JA-only modules back to QUIZ on en/ko tracks', () => {
    expect(resolveGuardTab('en', 'KANA')).toBe('QUIZ');
    expect(resolveGuardTab('en', 'PITCH')).toBe('QUIZ');
    expect(resolveGuardTab('en', 'TEXTBOOK')).toBe('QUIZ');
    expect(resolveGuardTab('en', 'SHADOWING')).toBe('QUIZ');
    expect(resolveGuardTab('ko', 'KANA')).toBe('QUIZ');
  });

  it('keeps HANGUL on ko track; sends it back to QUIZ on en/ja tracks', () => {
    expect(resolveGuardTab('ko', 'HANGUL')).toBe('HANGUL');
    expect(resolveGuardTab('en', 'HANGUL')).toBe('QUIZ');
    expect(resolveGuardTab('ja', 'HANGUL')).toBe('QUIZ');
  });

  it('sends writing back to READING on ko track; shadowing follows JA-only rule', () => {
    expect(resolveGuardTab('ko', 'WRITING')).toBe('READING');
    expect(resolveGuardTab('ko', 'SHADOWING')).toBe('QUIZ');
  });

  it('falls back to track fallbackTab for unknown invalid tabs', () => {
    expect(resolveGuardTab('en', 'STATS')).toBe('TODAY');
    expect(resolveGuardTab('ja', 'STATS')).toBe('TODAY');
    expect(resolveGuardTab('ko', 'STATS')).toBe('TODAY');
  });
});
