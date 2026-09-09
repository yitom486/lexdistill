import { describe, expect, it } from 'bun:test';

/**
 * P1-B1 ordering 契约回归（离线，不碰 DB）。
 *
 * 真实依据（2026-09-10 只读验证，doc_mtt3n2rp0v4d5u）：
 * canonical AST 最终 lessons[] 相邻项 lessonNumber 会跳号（16→18→20），
 * 因为 parser 先按 group 位置分号（si+1），后过滤无内容 group。
 * 因此 P1-B sort_order 唯一正确来源 = 最终数组 index + 1（连续 1-based），
 * 禁止 sort_order = lesson_number，也禁止 ORDER BY lesson_number → ROW_NUMBER。
 *
 * 本文件把“提议的 shred 投影”写成纯函数契约（P1-B 实施时搬进 shred）：
 * - AST projection：sort_order(i) = i + 1
 * - relay projection：新课 sort_order = 现有 canonical 课数 + i + 1（不是 maxNo + i + 1）
 */

/** 提议的 shred 投影：canonical AST 数组 → 每课 sort_order（P1-B 实施目标）。 */
function proposedSortOrders(lessonCount: number): number[] {
  return Array.from({ length: lessonCount }, (_, i) => i + 1);
}

/** 提议的 relay 投影：现有 canonical 课数 + 追加序号 → 新课 sort_order。 */
function proposedRelaySortOrder(existingCanonicalCount: number, appendIndex0: number): number {
  return existingCanonicalCount + appendIndex0 + 1;
}

interface LessonLike {
  id: string;
  lessonNumber: number;
  title: string;
}

/** 真实 gap 形态的匿名化 fixture（源自 minna1 idx14-20：no=15/16/18/20/21/22/23）。 */
const GAP_FIXTURE: LessonLike[] = [
  { id: 'doc-l15', lessonNumber: 15, title: '第16課' },
  { id: 'doc-l16', lessonNumber: 16, title: '第17課' },
  { id: 'doc-l18', lessonNumber: 18, title: '第19課' },
  { id: 'doc-l20', lessonNumber: 20, title: '第21課' },
  { id: 'doc-l21', lessonNumber: 21, title: '第22課' },
  { id: 'doc-l22', lessonNumber: 22, title: '第23課' },
  { id: 'doc-l23', lessonNumber: 23, title: '第24課 294' },
];

describe('P1-B ordering 契约：sort_order 来自数组位置', () => {
  it('gap 回归：lessonNumber 16/18/20 跳号，但 sort_order 必须连续', () => {
    // 先锁定 gap 现实：相邻项差值 > 1（当前 parser 行为 characterization）
    const numbers = GAP_FIXTURE.map((l) => l.lessonNumber);
    expect(numbers).toEqual([15, 16, 18, 20, 21, 22, 23]);
    // 提议投影：连续 1-based，与 lessonNumber 脱钩
    expect(proposedSortOrders(GAP_FIXTURE.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 反例锁定：若用 lesson_number 当 sort_order，第 3 项会是 18 而不是 3
    expect(GAP_FIXTURE[2]?.lessonNumber).toBe(18);
  });

  it('relay 回归：新课 sort_order = 现有课数 + i + 1，而非 maxNo + i + 1', () => {
    // 现有 7 课 canonical，最大 lessonNumber 是 23
    const maxNo = Math.max(...GAP_FIXTURE.map((l) => l.lessonNumber));
    expect(maxNo).toBe(23);
    // legacy 做法会给出 24（把 23 当顺序，错）；正确做法给出 8
    expect(maxNo + 0 + 1).toBe(24);
    expect(proposedRelaySortOrder(GAP_FIXTURE.length, 0)).toBe(8);
    expect(proposedRelaySortOrder(GAP_FIXTURE.length, 1)).toBe(9);
  });

  it('ordering 与 display 完全独立：噪声 title 不影响顺序', () => {
    // 第24課 294 带页码噪声、title 与 number 错位（第16課/no=15），顺序只看数组下标
    const orders = proposedSortOrders(GAP_FIXTURE.length);
    const byId = new Map(GAP_FIXTURE.map((l, i) => [l.id, orders[i]]));
    expect(byId.get('doc-l15')).toBe(1);
    expect(byId.get('doc-l18')).toBe(3);
    expect(byId.get('doc-l23')).toBe(7);
  });

  it('identity drift 登记：lesson_id 后缀与 title 可能错位（本轮不修）', () => {
    // 真实 debt：id 后缀 -l15、lessonNumber 15，但 title 是第16課——三者已分叉
    const l = GAP_FIXTURE[0]!;
    expect(l.id).toBe('doc-l15');
    expect(l.lessonNumber).toBe(15);
    expect(l.title).toBe('第16課');
  });
});
