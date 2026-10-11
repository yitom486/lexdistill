import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  validateTocPageOrder,
  canonicalizeTocEntries,
  type TocEntry,
} from '../toc.js';
import { planTextbookTasks } from '../textbook-tasks.js';

describe('validateTocPageOrder', () => {
  it('合规递增目录：校验成功并正确统计', () => {
    const entries: TocEntry[] = [
      { id: 'u1', level: 'unit', title: '第一单元 日常交流', startPage: 1 },
      { id: 'l1', level: 'lesson', title: '第1课 初次见面', startPage: 3, endPage: 10, parentId: 'u1' },
      { id: 'l2', level: 'lesson', title: '第2课 在餐厅', startPage: 11, endPage: 20, parentId: 'u1' },
      { id: 'u2', level: 'unit', title: '第二单元 商业出行', startPage: 21 },
      { id: 'l3', level: 'lesson', title: '第3课 问路', startPage: 22, endPage: 30, parentId: 'u2' },
    ];

    const res = validateTocPageOrder(entries);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.lessonCount).toBe(3);
      expect(res.value.totalEntries).toBe(5);
      expect(res.value.minPage).toBe(1);
      expect(res.value.maxPage).toBe(30);
    }
  });

  it('倒退页码：自动拦截并抛出 E_TOC_PAGE_ORDER_INVALID', () => {
    const entries: TocEntry[] = [
      { id: 'l1', level: 'lesson', title: '第1课', startPage: 10 },
      { id: 'l2', level: 'lesson', title: '第2课', startPage: 20 },
      { id: 'l3', level: 'lesson', title: '第3课', startPage: 15 }, // 倒退回 15
    ];

    const res = validateTocPageOrder(entries);
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.code).toBe('E_TOC_PAGE_ORDER_INVALID');
      expect(res.error.userMessage).toContain('第 2 课');
      expect(res.error.userMessage).toContain('第 3 课');
    }
  });

  it('自身 endPage < startPage：拦截并抛出 E_TOC_PAGE_RANGE_INVALID', () => {
    const entries: TocEntry[] = [
      { id: 'l1', level: 'lesson', title: '第1课', startPage: 10, endPage: 5 },
    ];

    const res = validateTocPageOrder(entries);
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.code).toBe('E_TOC_PAGE_RANGE_INVALID');
    }
  });

  it('一级单元标题本身就是提取任务，不要求特定语义类型', () => {
    const entries: TocEntry[] = [
      { id: 'u1', level: 'unit', title: '只有单元', startPage: 1 },
    ];

    const res = validateTocPageOrder(entries);
    expect(isOk(res)).toBe(true);
  });

  it('重复 ID：拦截并抛出 E_TOC_DUPLICATE_ID', () => {
    const entries: TocEntry[] = [
      { id: 'l1', level: 'lesson', title: '第1课', startPage: 1 },
      { id: 'l1', level: 'lesson', title: '第2课', startPage: 5 },
    ];

    const res = validateTocPageOrder(entries);
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.code).toBe('E_TOC_DUPLICATE_ID');
    }
  });
});

describe('canonicalizeTocEntries', () => {
  it('自动补全缺失的 endPage 并赋予从 1 开始的 sortOrder', () => {
    const entries: TocEntry[] = [
      { id: 'l1', level: 'lesson', title: ' 第1课 ', startPage: 1 },
      { id: 'l2', level: 'lesson', title: '第2课', startPage: 15 },
    ];

    const canonical = canonicalizeTocEntries(entries);
    expect(canonical).toHaveLength(2);
    expect(canonical[0]!.sortOrder).toBe(1);
    expect(canonical[0]!.title).toBe('第1课');
    expect(canonical[0]!.endPage).toBe(14); // 自动推断为 15 - 1

    expect(canonical[1]!.sortOrder).toBe(2);
    expect(canonical[1]!.endPage).toBeUndefined(); // 最后一课由实际 PDF 总页数或用户结束页确定
  });

  it('单元下含成课与课内附属小节时：以成课为单位切分，附属小节归属于所属课', () => {
    const entries: TocEntry[] = [
      { id: 'u1', level: 'unit', title: '第1单元 基本交流', startPage: 1 },
      { id: 'l1', level: 'lesson', title: '第1课 李さんは中国人です', startPage: 3, parentId: 'u1' },
      { id: 's1', level: 'section', title: '出迎え', startPage: 3, parentId: 'l1' },
      { id: 's2', level: 'section', title: '基本课文', startPage: 4, parentId: 'l1' },
      { id: 'l2', level: 'lesson', title: '第2课 これは本です', startPage: 11, parentId: 'u1' },
      { id: 'sum', level: 'section', title: '单元末总结', startPage: 20, parentId: 'u1' },
      { id: 'u2', level: 'unit', title: '第2单元 商务应用（无细课独立单元）', startPage: 25 },
    ];

    const planned = planTextbookTasks(entries);
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      const tasks = planned.value;
      // 任务切分面应包含：第1课、第2课、单元末总结、以及无子课的第2单元
      expect(tasks.map(t => [t.root.id, t.root.title])).toEqual([
        ['l1', '第1课 李さんは中国人です'],
        ['l2', '第2课 これは本です'],
        ['sum', '单元末总结'],
        ['u2', '第2单元 商务应用（无细课独立单元）'],
      ]);

      // 第1课的 entries 包含自身及出迎え、基本课文，ancestors 包含第1单元
      const l1Task = tasks.find(t => t.root.id === 'l1')!;
      expect(l1Task.ancestors.map(a => a.id)).toEqual(['u1']);
      expect(l1Task.entries.map(e => e.id)).toEqual(['l1', 's1', 's2']);

      // 单元末总结作为与课平齐的独立 session 切分面，ancestors 包含第1单元
      const sumTask = tasks.find(t => t.root.id === 'sum')!;
      expect(sumTask.ancestors.map(a => a.id)).toEqual(['u1']);
      expect(sumTask.entries.map(e => e.id)).toEqual(['sum']);

      // 无细课的第2单元自身作为切分面，ancestors 为空
      const u2Task = tasks.find(t => t.root.id === 'u2')!;
      expect(u2Task.ancestors).toEqual([]);
      expect(u2Task.entries.map(e => e.id)).toEqual(['u2']);
    }
  });
});
