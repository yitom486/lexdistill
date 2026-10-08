import { describe, expect, it } from 'bun:test';
import { parseAcpConfigOptions } from '@yitom/acp-client';
import {
  discoverThinking,
  findThinkingConfigOption,
  parseModelVariant,
  resolveThinkingModelId,
  selectModelThinkingControl,
} from '../runtime/router/model-thinking.js';
import { findModelConfigOption } from '@yitom/acp-client';

const parsedOf = (configOptions: unknown) => parseAcpConfigOptions(configOptions);

describe('findThinkingConfigOption（rank2 规则移植，与楷模逐字一致）', () => {
  it('thought/reason/effort 命名命中；model/mode 不命中', () => {
    const options = parsedOf([
      { configId: 'model', options: [{ value: 'm' }] },
      { configId: 'thought_level', name: 'Thinking', options: [{ value: 'high' }] },
    ]);
    expect(findThinkingConfigOption(options)?.configId).toBe('thought_level');
    const reason = parsedOf([{ configId: 'reasoning', options: [{ value: 'high' }] }]);
    expect(findThinkingConfigOption(reason)?.configId).toBe('reasoning');
    expect(findThinkingConfigOption(parsedOf([{ configId: 'model' }]))).toBeUndefined();
  });
});

describe('discoverThinking', () => {
  it('独立选项优先（旧网关 includes(effort) 会漏 reasoning 系命名）', () => {
    const parsed = parsedOf([
      { configId: 'model', category: 'model', options: [{ value: 'm' }] },
      { configId: 'reasoning', options: [{ value: 'high' }, { value: 'low' }] },
    ]);
    const found = discoverThinking(parsed, findModelConfigOption(parsed));
    expect(found).toMatchObject({ effortConfigId: 'reasoning', variant: false, efforts: ['high', 'low'] });
  });

  it('方括号变体：候选＋variant 标记', () => {
    const parsed = parsedOf([
      {
        configId: 'model', category: 'model',
        currentValue: 'm[reasoning_effort=low]',
        options: [{ value: 'm[reasoning_effort=low]' }, { value: 'm[reasoning_effort=high]' }],
      },
    ]);
    const found = discoverThinking(parsed, findModelConfigOption(parsed));
    expect(found.effortConfigId).toBeNull();
    expect(found.variant).toBe(true);
    expect(found.efforts).toEqual(['low', 'high']);
  });

  it('opencode 现状（model＋mode，无变体）：空＋非变体（如下游一致不发明）', () => {
    const parsed = parsedOf([
      { configId: 'model', category: 'model', currentValue: 'opencode/big-pickle', options: [{ value: 'a' }, { value: 'a-fast' }] },
      { configId: 'mode', category: 'mode', currentValue: 'build', options: [{ value: 'build' }, { value: 'plan' }] },
    ]);
    const found = discoverThinking(parsed, findModelConfigOption(parsed));
    expect(found).toMatchObject({ effortConfigId: null, efforts: [], variant: false });
  });
});

describe('selectModelThinkingControl', () => {
  it('单候选/无尾缀 → null；≥2 → control', () => {
    const single = findModelConfigOption(parsedOf([
      { configId: 'model', currentValue: 'grok-4.7', options: [{ value: 'grok-4.7' }] },
    ]));
    expect(selectModelThinkingControl(single)).toBeNull();
    const multi = findModelConfigOption(parsedOf([
      {
        configId: 'model', currentValue: 'm[reasoning_effort=low]',
        options: [{ value: 'm[reasoning_effort=low]' }, { value: 'm[reasoning_effort=high]' }],
      },
    ]));
    expect(selectModelThinkingControl(multi)).toMatchObject({ base: 'm', key: 'reasoning_effort', candidates: ['low', 'high'] });
  });
});

describe('resolveThinkingModelId', () => {
  it('方括号：只回 listed 原值；不可解析 null', () => {
    const model = findModelConfigOption(parsedOf([
      {
        configId: 'model', currentValue: 'm[reasoning_effort=low]',
        options: [{ value: 'm[reasoning_effort=low]' }, { value: 'm[reasoning_effort=high]' }],
      },
    ]))!;
    expect(resolveThinkingModelId(model, 'high')).toEqual({ configId: 'model', value: 'm[reasoning_effort=high]' });
    expect(resolveThinkingModelId(model, 'ultra')).toBeNull();
    // 指定模型 base 改写（用户换 base 后档位跟随新 base）
    expect(resolveThinkingModelId(model, 'high', 'm')).toEqual({ configId: 'model', value: 'm[reasoning_effort=high]' });
  });

  it('parseModelVariant 基础形状', () => {
    expect(parseModelVariant('m[reasoning_effort = xhigh , foo=1]')).toEqual({
      base: 'm', params: { reasoning_effort: 'xhigh', foo: '1' },
    });
    expect(parseModelVariant('plain')).toEqual({ base: 'plain', params: {} });
  });
});
