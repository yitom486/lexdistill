import { describe, expect, it } from 'bun:test';
import { clearRuntimeOptionsCacheForTest, getAgentRuntimeOptions } from '../runtime/router/runtime-options.js';

describe('getAgentRuntimeOptions', () => {
  it('未知运行时如实返回空＋error，不抛；二次命中缓存', async () => {
    clearRuntimeOptionsCacheForTest();
    const first = await getAgentRuntimeOptions('no-such-runtime', {
      createClient: () => { throw new Error('未知或未注册的 ACP 运行时模板'); },
    });
    expect(first.models).toEqual([]);
    expect(first.efforts).toEqual([]);
    expect(typeof first.error).toBe('string');
    const second = await getAgentRuntimeOptions('no-such-runtime', {
      createClient: () => { throw new Error('不应第二次创建客户端'); },
    });
    expect(second).toEqual(first);
  });
});
