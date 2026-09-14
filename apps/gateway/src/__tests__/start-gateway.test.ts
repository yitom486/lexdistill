import { describe, expect, it } from 'bun:test';
import { isAddressInUse } from '../bootstrap/start-gateway.js';

/**
 * M8：EADDRINUSE 双判语义锁定（errno 口径＋文案口径，跨 Bun 版本稳健）。
 * 端口冲突大声失败与优雅关机的真实路径由隔离端口实演覆盖（见 13 号卡），
 * 本单测锁定判别函数本身，避免回归到单口径。
 */
describe('start-gateway isAddressInUse', () => {
  it('errno 口径：code=EADDRINUSE 即命中', () => {
    expect(isAddressInUse({ code: 'EADDRINUSE' })).toBe(true);
    expect(isAddressInUse({ code: 'EADDRINUSE', message: 'other' })).toBe(true);
  });

  it('文案口径：message 含 address already in use 即命中（大小写不敏感）', () => {
    expect(isAddressInUse(new Error('listen EADDRINUSE: address already in use 127.0.0.1:8080'))).toBe(
      true
    );
    expect(isAddressInUse({ message: 'Address already in use' })).toBe(true);
    expect(isAddressInUse({ message: 'bind EADDRINUSE failed' })).toBe(true);
  });

  it('非端口占用一律不命中', () => {
    expect(isAddressInUse(null)).toBe(false);
    expect(isAddressInUse(undefined)).toBe(false);
    expect(isAddressInUse(42)).toBe(false);
    expect(isAddressInUse('EADDRINUSE')).toBe(false);
    expect(isAddressInUse({ code: 'ENOENT' })).toBe(false);
    expect(isAddressInUse({ message: 42 })).toBe(false);
    expect(isAddressInUse(new Error('connection refused'))).toBe(false);
    expect(isAddressInUse({})).toBe(false);
  });
});
