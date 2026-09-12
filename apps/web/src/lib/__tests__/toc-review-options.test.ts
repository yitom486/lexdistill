import { describe, expect, it } from 'bun:test';
import { resolveTocReviewModelRequest } from '../toc-confirm-flow.js';

/**
 * P3.5-FIX2 配置三态（失败测试先行）。
 *
 * inherit-saved / force-default / explicit 三者明确区分：
 * - inherit → 用已保存偏好（空则缺席）；
 * - default → 强制默认，绝不回退已保存值；
 * - explicit → 用本次值（空白视为未填，按默认处理）。
 */
describe('P3.5-FIX2 resolveTocReviewModelRequest 三态', () => {
  it('双 inherit 空偏好 → 空对象（后端走环境/默认）', () => {
    expect(
      resolveTocReviewModelRequest({
        session: { model: '', modelMode: 'inherit', effort: '', effortMode: 'inherit' },
        saved: { model: '', effort: '' },
      })
    ).toEqual({});
  });

  it('inherit 生效已保存偏好', () => {
    expect(
      resolveTocReviewModelRequest({
        session: { model: '', modelMode: 'inherit', effort: '', effortMode: 'inherit' },
        saved: { model: 'm-saved', effort: 'high' },
      })
    ).toEqual({ model: 'm-saved', effort: 'high' });
  });

  it('force-default：已保存模型存在也不得回退', () => {
    expect(
      resolveTocReviewModelRequest({
        session: { model: '', modelMode: 'default', effort: '', effortMode: 'default' },
        saved: { model: 'm-saved', effort: 'high' },
      })
    ).toEqual({});
    // 混合：模型强制默认 + effort 跟随偏好
    expect(
      resolveTocReviewModelRequest({
        session: { model: '', modelMode: 'default', effort: '', effortMode: 'inherit' },
        saved: { model: 'm-saved', effort: 'high' },
      })
    ).toEqual({ effort: 'high' });
  });

  it('explicit 覆盖一切；空白 explicit 按默认处理', () => {
    expect(
      resolveTocReviewModelRequest({
        session: { model: 'm-once', modelMode: 'explicit', effort: 'low', effortMode: 'explicit' },
        saved: { model: 'm-saved', effort: 'high' },
      })
    ).toEqual({ model: 'm-once', effort: 'low' });
    expect(
      resolveTocReviewModelRequest({
        session: { model: '  ', modelMode: 'explicit', effort: '', effortMode: 'explicit' },
        saved: { model: 'm-saved', effort: 'high' },
      })
    ).toEqual({});
  });
});
