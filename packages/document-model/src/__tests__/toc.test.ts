import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  validateTocPageOrder,
  canonicalizeTocEntries,
  type TocEntry,
} from '../toc.js';

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
});
