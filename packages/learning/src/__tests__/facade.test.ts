import { describe, expect, it } from 'bun:test';
import {
  scheduleFsrsReviewV1 as viaFacade,
  blueprintFor as blueprintViaFacade,
  type FsrsState as FsrsStateViaFacade,
} from '../index.js';
import { scheduleFsrsReviewV1 as viaCore } from '@study-studio/review-core';
import { blueprintFor as blueprintViaCore } from '@study-studio/practice-core';
import type { FsrsState as FsrsStateViaCore } from '@study-studio/learning-algorithms';

/** M6-3 facade 表面锁：具名导出即规范包的实现本身，不漂移、不包装。 */
describe('learning facade', () => {
  it('排程与蓝图入口与规范包同一实现', () => {
    expect(viaFacade).toBe(viaCore);
    expect(blueprintViaFacade).toBe(blueprintViaCore);
  });

  it('转出排程状态类型（编译期锁：缺失即 typecheck 失败）', () => {
    const state: FsrsStateViaFacade = {
      stability: 1,
      difficulty: 5,
      reps: 0,
      lapses: 0,
      dueAt: '2026-09-07T12:00:00.000Z',
      state: 'NEW',
    };
    const same: FsrsStateViaCore = state;
    expect(same.state).toBe('NEW');
  });
});
