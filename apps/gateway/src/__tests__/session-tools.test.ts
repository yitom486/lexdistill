import { describe, expect, it } from 'bun:test';
import { needsSessionToolUpgrade } from '../runtime/router/session-tools.js';

describe('needsSessionToolUpgrade', () => {
  it('未声明工具永不升级（主聊行为不变）', () => {
    expect(needsSessionToolUpgrade([], [])).toBe(false);
    expect(needsSessionToolUpgrade(['a'], [])).toBe(false);
  });

  it('齐全不升级；缺任意一个即升级', () => {
    const have = ['vocabulary.learning.context', 'dictionary.lookup'];
    expect(needsSessionToolUpgrade(have, ['vocabulary.learning.context'])).toBe(false);
    expect(needsSessionToolUpgrade(have, [...have, 'vocabulary.learning.submit'])).toBe(true);
    expect(needsSessionToolUpgrade([], ['vocabulary.learning.submit'])).toBe(true);
  });
});
