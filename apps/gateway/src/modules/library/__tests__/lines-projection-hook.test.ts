import { describe, expect, it, afterEach, afterAll } from 'bun:test';
import { err, ok, BusinessError } from '@lexdistill/shared';
import { fireLinesProjection } from '../application/lines-projection-hook.js';

/**
 * P2-2a1：投影异常路径锁定。
 * - err／抛错一律吞掉并 warn，主流程继续（await 后代码可达）；
 * - 日志只含结构化安全字段，原始底层错误（ECONNREFUSED／地址）不得落日志。
 */
describe('fireLinesProjection (P2-2a1)', () => {
  const seen: unknown[][] = [];
  const origWarn = console.warn;
  console.warn = ((...args: unknown[]) => {
    seen.push(args);
  }) as typeof console.warn;
  afterEach(() => {
    seen.length = 0;
  });
  afterAll(() => {
    console.warn = origWarn;
  });

  it('成功：零 warn', async () => {
    await fireLinesProjection(async () => ok({ inserted: 2, skipped: 0 }), 't', 'u1', 'd1');
    expect(seen).toEqual([]);
  });

  it('err 返回：warn 一次带 code，主流程继续', async () => {
    let continued = false;
    await fireLinesProjection(
      async () => err(new BusinessError('E_INVALID_INPUT', 'x', 'VALIDATION')),
      't-scope',
      'u1',
      'd9'
    );
    continued = true;
    expect(continued).toBe(true);
    expect(seen.length).toBe(1);
    const logged = JSON.stringify(seen[0]);
    expect(logged).toContain('E_INVALID_INPUT');
    expect(logged).toContain('d9');
  });

  it('抛底层异常：经翻译链，只记 code，不泄露原文', async () => {
    let continued = false;
    await fireLinesProjection(
      async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:9999');
      },
      't-scope',
      'u1',
      'd9'
    );
    continued = true;
    expect(continued).toBe(true);
    expect(seen.length).toBe(1);
    const logged = JSON.stringify(seen[0]);
    expect(logged).toContain('E_NETWORK_DISCONNECTED');
    expect(logged).not.toContain('ECONNREFUSED');
    expect(logged).not.toContain('127.0.0.1');
  });
});