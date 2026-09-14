import { describe, expect, it } from 'bun:test';
import { canonicalJson, fingerprintCanonical } from '@study-studio/storage-sqlite';
import { TEXTBOOK_BOOKS } from '@study-studio/storage-sqlite';

/**
 * P1-D0 Task 6：canonical fingerprint 原型（纯函数，未接生产）。
 * seed gating 设计依据：静态种子 AST 的指纹必须跨运行稳定。
 */
describe('canonical fingerprint', () => {
  it('键序无关、数组保序、语义变化即变', () => {
    const a = { b: 1, a: [1, 2, { x: 'v' }] };
    const b = { a: [1, 2, { x: 'v' }], b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(fingerprintCanonical(a)).toBe(fingerprintCanonical(b));
    expect(fingerprintCanonical({ a: [2, 1] })).not.toBe(fingerprintCanonical({ a: [1, 2] }));
    expect(fingerprintCanonical({ a: 1 })).not.toBe(fingerprintCanonical({ a: 2 }));
  });

  it('volatile 警示：时间戳/provisional id 进料即改变指纹（调用方禁喂）', () => {
    const base = { title: 'B', lessons: [] as unknown[] };
    const h1 = fingerprintCanonical({ ...base, at: '2026-09-10T00:00:00.000Z' });
    const h2 = fingerprintCanonical({ ...base, at: '2026-09-10T00:00:01.000Z' });
    expect(h1).not.toBe(h2);
    // 另见 P1-A0：Date.now() ms 精度连调可碰撞，故此处用显式不同值而非两次 now()
  });

  it('真实种子 AST 指纹跨运行稳定（seed gating 可用）', () => {
    expect(TEXTBOOK_BOOKS.length).toBeGreaterThan(0);
    for (const book of TEXTBOOK_BOOKS) {
      const h1 = fingerprintCanonical(book);
      const h2 = fingerprintCanonical(JSON.parse(JSON.stringify(book)) as unknown);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
