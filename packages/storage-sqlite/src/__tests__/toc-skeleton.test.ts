import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { isOk } from '@study-studio/shared';
import { initSchema } from '../ddl.js';
import * as schema from '../schema.js';
import { seedTextbookTocSkeleton, listTextbookLessonSlots } from '../adapters/library/toc-skeleton.js';
import type { TocEntry } from '@study-studio/document-model';

function freshDb() {
  const sqlite = new Database(':memory:');
  initSchema(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe('seedTextbookTocSkeleton', () => {
  it('合规递增目录：成功原子落库，文档创建且全量章节槽位处于 pending 状态', async () => {
    const { db } = freshDb();
    const entries: TocEntry[] = [
      { id: 'u1', level: 'unit', title: 'Unit 1 基础篇', startPage: 1 },
      { id: 'l1', level: 'lesson', title: '第1课 打招呼', startPage: 5, endPage: 12, parentId: 'u1' },
      { id: 'l2', level: 'lesson', title: '第2课 自我介绍', startPage: 13, endPage: 20, parentId: 'u1' },
    ];

    const res = await seedTextbookTocSkeleton(
      { db },
      {
        documentId: 'doc_tb_01',
        userId: 'user_01',
        title: '新编日语第一册',
        language: 'ja',
        entries,
      }
    );

    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.documentId).toBe('doc_tb_01');
      expect(res.value.lessonCount).toBe(2);
      expect(res.value.totalEntries).toBe(3);
      expect(res.value.minPage).toBe(1);
      expect(res.value.maxPage).toBe(20);
    }

    // 检查 documents 记录
    const docs = db.select().from(schema.documents).where(eq(schema.documents.id, 'doc_tb_01')).all();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toBe('新编日语第一册');
    expect(docs[0]!.language).toBe('ja');

    // 检查 textbook_lessons 槽位记录
    const lessons = db
      .select()
      .from(schema.textbookLessons)
      .where(eq(schema.textbookLessons.documentId, 'doc_tb_01'))
      .orderBy(schema.textbookLessons.sortOrder)
      .all();

    expect(lessons).toHaveLength(3);
    // 单元槽位
    expect(lessons[0]!.lessonId).toBe('u1');
    expect(lessons[0]!.kind).toBe('chapter');
    expect(lessons[0]!.sortOrder).toBe(1);
    expect(lessons[0]!.status).toBe('pending');
    expect(lessons[0]!.startPage).toBe(1);

    // 第1课
    expect(lessons[1]!.lessonId).toBe('l1');
    expect(lessons[1]!.kind).toBe('lesson');
    expect(lessons[1]!.parentId).toBe('u1');
    expect(lessons[1]!.sortOrder).toBe(2);
    expect(lessons[1]!.status).toBe('pending');
    expect(lessons[1]!.startPage).toBe(5);
    expect(lessons[1]!.endPage).toBe(12);

    // 第2课
    expect(lessons[2]!.lessonId).toBe('l2');
    expect(lessons[2]!.sortOrder).toBe(3);
    expect(lessons[2]!.status).toBe('pending');
    expect(lessons[2]!.startPage).toBe(13);
    expect(lessons[2]!.endPage).toBe(20);
  });

  it('页码倒退时拦截并拒绝，零写入', async () => {
    const { db } = freshDb();
    const entries: TocEntry[] = [
      { id: 'l1', level: 'lesson', title: '第1课', startPage: 20 },
      { id: 'l2', level: 'lesson', title: '第2课', startPage: 10 }, // 倒退
    ];

    const res = await seedTextbookTocSkeleton(
      { db },
      {
        documentId: 'doc_invalid_01',
        userId: 'user_01',
        title: '倒退教材',
        entries,
      }
    );

    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.code).toBe('E_TOC_PAGE_ORDER_INVALID');
    }

    // 确认零写入
    const docs = db.select().from(schema.documents).where(eq(schema.documents.id, 'doc_invalid_01')).all();
    expect(docs).toHaveLength(0);
    const lessons = db
      .select()
      .from(schema.textbookLessons)
      .where(eq(schema.textbookLessons.documentId, 'doc_invalid_01'))
      .all();
    expect(lessons).toHaveLength(0);
  });

  it('幂等更新：用户微调确认后再次提交，槽位全量更新且无脏数据', async () => {
    const { db } = freshDb();
    const v1Entries: TocEntry[] = [
      { id: 'l1', level: 'lesson', title: '第1课', startPage: 1 },
      { id: 'l2', level: 'lesson', title: '第2课', startPage: 10 },
    ];

    await seedTextbookTocSkeleton(
      { db },
      {
        documentId: 'doc_update_01',
        userId: 'user_01',
        title: '初始标题',
        entries: v1Entries,
      }
    );

    // 用户在前端微调了标题和页码
    const v2Entries: TocEntry[] = [
      { id: 'l1', level: 'lesson', title: '第1课（精校标题）', startPage: 2 },
      { id: 'l2', level: 'lesson', title: '第2课（精校标题）', startPage: 15 },
    ];

    const res2 = await seedTextbookTocSkeleton(
      { db },
      {
        documentId: 'doc_update_01',
        userId: 'user_01',
        title: '最终确认标题',
        entries: v2Entries,
      }
    );

    expect(isOk(res2)).toBe(true);

    const lessons = db
      .select()
      .from(schema.textbookLessons)
      .where(eq(schema.textbookLessons.documentId, 'doc_update_01'))
      .orderBy(schema.textbookLessons.sortOrder)
      .all();

    expect(lessons).toHaveLength(2);
    expect(lessons[0]!.title).toBe('第1课（精校标题）');
    expect(lessons[0]!.startPage).toBe(2);
    expect(lessons[1]!.title).toBe('第2课（精校标题）');
    expect(lessons[1]!.startPage).toBe(15);
  });

  it('listTextbookLessonSlots: 能够按 sortOrder 准确返回已入库课次槽位及就绪状态', async () => {
    const { db } = freshDb();
    const entries: TocEntry[] = [
      { id: 'l1', level: 'lesson', title: '第1课', startPage: 1, endPage: 5 },
      { id: 'l2', level: 'lesson', title: '第2课', startPage: 6, endPage: 10 },
    ];

    await seedTextbookTocSkeleton(
      { db },
      {
        documentId: 'doc_slots_01',
        userId: 'user_01',
        title: '测试槽位查询',
        entries,
      }
    );

    const slotsRes = await listTextbookLessonSlots({ db }, 'doc_slots_01');
    expect(isOk(slotsRes)).toBe(true);
    if (isOk(slotsRes)) {
      expect(slotsRes.value).toHaveLength(2);
      expect(slotsRes.value[0]!.lessonId).toBe('l1');
      expect(slotsRes.value[0]!.status).toBe('pending');
      expect(slotsRes.value[1]!.lessonId).toBe('l2');
      expect(slotsRes.value[1]!.status).toBe('pending');
    }
  });
});
