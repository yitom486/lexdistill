import { describe, expect, it } from 'bun:test';
import { resolveTocReviewModelRequest } from '../toc-confirm-flow.js';

/**
 * P3.5-FIX 配置优先级（失败测试先行）。
 *
 * 本次显式 > 已保存偏好 > 缺席（缺席即不传，后端走环境变量 > 适配器默认）。
 * 空串一律视为缺席，不透传。
 */
describe('P3.5-FIX resolveTocReviewModelRequest', () => {
  it('双空 → 空对象（后端走环境/默认）', () => {
    expect(resolveTocReviewModelRequest({ session: {}, saved: {} })).toEqual({});
    expect(resolveTocReviewModelRequest({ session: { model: '  ' }, saved: { effort: '' } })).toEqual({});
  });

  it('已保存偏好在本次缺席时生效', () => {
    expect(
      resolveTocReviewModelRequest({ session: {}, saved: { model: 'm-saved', effort: 'high' } })
    ).toEqual({ model: 'm-saved', effort: 'high' });
  });

  it('本次显式覆盖已保存偏好（逐字段）', () => {
    expect(
      resolveTocReviewModelRequest({
        session: { model: 'm-once' },
        saved: { model: 'm-saved', effort: 'low' },
      })
    ).toEqual({ model: 'm-once', effort: 'low' });
    expect(
      resolveTocReviewModelRequest({
        session: { effort: 'high' },
        saved: { model: 'm-saved', effort: 'low' },
      })
    ).toEqual({ model: 'm-saved', effort: 'high' });
  });
});
