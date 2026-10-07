import { describe, expect, it } from 'bun:test';
import { needsSessionToolUpgrade, resolveResumeThreadId } from '../runtime/router/session-tools.js';

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

describe('resolveResumeThreadId', () => {
  it('显式任务放弃 resume（旧线程工具不可验证），hint 轮保留', () => {
    expect(resolveResumeThreadId('thr-old', ['vocabulary.learning.context'])).toBeUndefined();
    expect(resolveResumeThreadId('thr-old', [])).toBe('thr-old');
    expect(resolveResumeThreadId(undefined, ['vocabulary.learning.context'])).toBeUndefined();
    expect(resolveResumeThreadId(undefined, [])).toBeUndefined();
  });
});
