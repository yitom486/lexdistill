import { describe, expect, it } from 'bun:test';
import {
  resolveTocEffortDefault,
  resolveTocEffortOptions,
  resolveTocModelDefault,
  toTocModelOptions,
  type TocModelOption,
} from '../TocReviewDialogs.js';

/**
 * 模型真列表纯规则（无硬编码断言方向）：
 * - 默认取尾巴（服务端大→小排，尾巴即便宜小模型），绝不点名任何模型；
 * - 已保存命中才用已保存；hidden/垃圾行一律过滤。
 */

const MODELS: TocModelOption[] = [
  { id: 'm-big', label: 'Big', supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
  { id: 'm-mid', label: 'Mid', supportedEfforts: [], defaultEffort: '' },
  { id: 'm-luna', label: 'Luna', supportedEfforts: ['low', 'medium'], defaultEffort: 'low' },
];

describe('toTocModelOptions（收窄）', () => {
  it('过滤 hidden/空 id/垃圾行，保持服务端顺序，label 回退', () => {
    const out = toTocModelOptions([
      { id: 'a', model: 'a', displayName: 'A', hidden: false },
      { id: 'b', model: 'b', hidden: true },
      { id: '  ', model: 'blank' },
      null,
      'junk',
      { model: 'only-model' },
      { id: 'c', supportedReasoningEfforts: ['low', 42, ''], defaultReasoningEffort: 'low' },
    ]);
    expect(out.map((m) => m.id)).toEqual(['a', 'blank', 'only-model', 'c']);
    expect(out[0]).toMatchObject({ id: 'a', label: 'A' });
    expect(out[1]).toMatchObject({ id: 'blank', label: 'blank' });
    expect(out[2]).toMatchObject({ label: 'only-model', supportedEfforts: [], defaultEffort: '' });
    expect(out[3]).toMatchObject({ supportedEfforts: ['low'], defaultEffort: 'low' });
  });

  it('非数组一律空（读侧永不抛）', () => {
    expect(toTocModelOptions(null)).toEqual([]);
    expect(toTocModelOptions({})).toEqual([]);
    expect(toTocModelOptions('x')).toEqual([]);
  });
});

describe('resolveTocModelDefault（默认取尾巴）', () => {
  it('已保存命中 → 已保存', () => {
    expect(resolveTocModelDefault(MODELS, 'm-mid')).toBe('m-mid');
  });

  it('无已保存/命中失败 → 尾巴（不点名）', () => {
    expect(resolveTocModelDefault(MODELS, '')).toBe('m-luna');
    expect(resolveTocModelDefault(MODELS, 'm-gone')).toBe('m-luna');
  });

  it('空列表 → 空（服务端默认）', () => {
    expect(resolveTocModelDefault([], '')).toBe('');
  });
});

describe('resolveTocEffortOptions/Default', () => {
  it('选中模型自带档优先，否则回退三档', () => {
    expect(resolveTocEffortOptions(MODELS[0]!)).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(resolveTocEffortOptions(MODELS[1]!)).toEqual(['low', 'medium', 'high']);
    expect(resolveTocEffortOptions(null)).toEqual(['low', 'medium', 'high']);
  });

  it('已保存命中 > 模型默认 > low > 首项 > 空', () => {
    const opts = ['low', 'medium', 'high', 'xhigh'];
    expect(resolveTocEffortDefault(opts, MODELS[0]!, 'xhigh')).toBe('xhigh');
    expect(resolveTocEffortDefault(opts, MODELS[0]!, '')).toBe('medium');
    expect(resolveTocEffortDefault(['medium', 'high'], null, '')).toBe('medium');
    expect(resolveTocEffortDefault(['medium', 'high'], null, 'low')).toBe('medium');
    expect(resolveTocEffortDefault([], null, '')).toBe('');
  });
});
