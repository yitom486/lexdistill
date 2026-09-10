import { describe, expect, it } from 'bun:test';

interface LessonLike {
  id: string;
  lessonNumber: number;
  title: string;
}

/**
 * P1-C0 identity drift 复现（characterization：锁定当前 positional 算法行为，不修生产）。
 *
 * 当前算法（markdown-to-ast.ts:265,284）：lesson_id = `${bookId}-l${si + 1}`，
 * 其中 si 是 parser group 位置。reparse 不做任何 old↔new reconciliation。
 * 以下测试证明：同一 locator.lessonId 在 reparse 后可能指向不同语义 lesson。
 */

/** 当前生产算法的最小复刻：按最终 group 顺序编号。 */
function assignCurrentIds(bookId: string, titles: string[]): LessonLike[] {
  return titles.map((title, si) => ({ id: `${bookId}-l${si + 1}`, lessonNumber: si + 1, title }));
}

/** locator 解析：按 lessonId 找课（textbook-focus.ts 同语义）。 */
function resolveById(lessons: LessonLike[], lessonId: string): LessonLike | undefined {
  return lessons.find((l) => l.id === lessonId);
}

describe('P1-C0 identity drift（当前算法 characterization）', () => {
  it('前置插入 Review：l2 从 B 漂移到 Review', () => {
    const before = assignCurrentIds('doc', ['A', 'B', 'C']);
    expect(resolveById(before, 'doc-l2')?.title).toBe('B');
    // parser 改进：前置 group 被保留（Review 成课）
    const after = assignCurrentIds('doc', ['A', 'Review', 'B', 'C']);
    // 同一 locator 指向不同语义
    expect(resolveById(after, 'doc-l2')?.title).toBe('Review');
    expect(resolveById(after, 'doc-l3')?.title).toBe('B');
  });

  it('删除前置误切 lesson：l1 从杂页漂移到 A，后续全移位', () => {
    const before = assignCurrentIds('doc', ['封面杂页', 'A', 'B']);
    const after = assignCurrentIds('doc', ['A', 'B']);
    expect(resolveById(before, 'doc-l2')?.title).toBe('A');
    expect(resolveById(after, 'doc-l2')?.title).toBe('B');
  });

  it('中间插入：插入点之后全部漂移，之前稳定', () => {
    const after = assignCurrentIds('doc', ['A', 'B', '插补课', 'C']);
    expect(resolveById(after, 'doc-l1')?.title).toBe('A');
    expect(resolveById(after, 'doc-l2')?.title).toBe('B');
    expect(resolveById(after, 'doc-l3')?.title).toBe('插补课');
    expect(resolveById(after, 'doc-l4')?.title).toBe('C');
  });

  it('边界：仅 OCR 标题修正（位置不变）→ id 稳定，不漂移', () => {
    const before = assignCurrentIds('doc', ['だい -第11課']);
    const after = assignCurrentIds('doc', ['第11課']);
    // 同位置 → 同 id：drift 只发生在结构变化，不发生在文本修正
    expect(resolveById(after, 'doc-l1')?.id).toBe(resolveById(before, 'doc-l1')?.id);
  });

  it('relay append：旧 id 全保留，新课追加（append-only 无漂移）', () => {
    const base = assignCurrentIds('doc', ['A', 'B']);
    // relay 语义：base 数组原样 concat，新课 id 取自新 AST（时间戳前缀不撞）
    const appended: LessonLike[] = [
      { id: 'doc-part2-l1', lessonNumber: 3, title: 'C' },
    ];
    const merged = [...base, ...appended];
    expect(resolveById(merged, 'doc-l1')?.title).toBe('A');
    expect(resolveById(merged, 'doc-l2')?.title).toBe('B');
    expect(merged).toHaveLength(3);
  });

  it('filter 规则变化导致 group 被丢弃：后续 id 前移', () => {
    // 旧 parser：空内容组也成课；新 parser：无有效内容组被过滤（markdown-to-ast:281）
    const before = assignCurrentIds('doc', ['A', '空组', 'B']);
    const after = assignCurrentIds('doc', ['A', 'B']);
    expect(resolveById(before, 'doc-l3')?.title).toBe('B');
    expect(resolveById(after, 'doc-l2')?.title).toBe('B');
  });
});
