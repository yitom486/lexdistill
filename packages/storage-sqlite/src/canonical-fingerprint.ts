import { createHash } from 'node:crypto';

/**
 * Canonical fingerprint 原型（P1-D0 Task 6，纯函数，未接生产）。
 *
 * 用途：seed gating / derived freshness 判断 —— canonical input 不变即跳过 shred。
 * - deterministic：递归键排序，不受 JSON property order 影响；
 * - 数组保序（lessons/dialogues 顺序即语义）；
 * - undefined/函数/symbol 跳过；Date 按 ISO（种子 AST 无时间字段，见 seed 检查）；
 * - 调用方保证不喂 volatile 字段（时间戳/provisional id 会使每次 hash 变化——
 *   seed 手写 AST 无此类字段，已验证；user import 的 `pdf-<ts>` id 绝不能进此口径）。
 */
export function canonicalJson(value: unknown): string {
  return stringifyCanonical(value);
}

function stringifyCanonical(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return JSON.stringify(value) ?? '';
  if (t === 'string') return JSON.stringify(value);
  if (t === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stringifyCanonical).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (t === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).filter((k) => {
      const v = rec[k];
      return v !== undefined && typeof v !== 'function' && typeof v !== 'symbol';
    }).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifyCanonical(rec[k])}`).join(',')}}`;
  }
  return '';
}

export function fingerprintCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
