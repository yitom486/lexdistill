import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq, and, sql } from 'drizzle-orm';
import { isOk } from '@study-studio/shared';
import { initSchema } from '../ddl.js';
import * as schema from '../schema.js';
import { seedTextbookTocSkeleton } from '../adapters/library/toc-skeleton.js';
import { commitLessonKnowledge } from '../adapters/library/commit-lesson-knowledge.js';

function freshDb() {
  const sqlite = new Database(':memory:');
  initSchema(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe('commitLessonKnowledge', () => {
  it('合规回填：白名单校验通过，原子落库生词、语法、短文，状态翻转为 ready', async () => {
    const { db } = freshDb();

    // 1. 预先建立骨架（两课）
    await seedTextbookTocSkeleton(
      { db },
      {
        documentId: 'doc_commit_01',
        userId: 'u1',
        title: '新标日测试版',
        entries: [
          { id: 'l1', level: 'lesson', title: '第1课 小李是学生', startPage: 1 },
          { id: 'l2', level: 'lesson', title: '第2课 那是书', startPage: 10 },
        ],
      }
    );

    // 2. 大模型提炼第 1 课并回填
    const resL1 = await commitLessonKnowledge(
      { db },
      {
        documentId: 'doc_commit_01',
        lessonId: 'l1',
        title: '第1课 小李是学生（精校）',
        passageMd: '# 第1课\n\n李さんは中国人です。\n王さんも中国人です。',
        vocabularies: [
          {
            surface: '学生',
            reading: 'がくせい',
            pos: '名词',
            glossZh: '学生',
            pitch: '⓪',
            exampleJa: '李さんは学生です。',
            exampleZh: '小李是学生。',
          },
        ],
        knowledgePoints: [
          {
            title: '～は～です',
            connection: '名词1＋は＋名词2＋です',
            explanation: '判断句，表示“...是...”。',
            examples: [{ japanese: 'わたしは学生です。', chinese: '我是学生。' }],
          },
        ],
        exercises: [
          {
            type: 'CHOICE',
            prompt: '李さん（　）学生です。',
            options: ['は', 'が', 'を'],
            answer: 'A',
            explanation: '提示主题用助词「は」。',
          },
        ],
      }
    );

    expect(isOk(resL1)).toBe(true);
    if (isOk(resL1)) {
      expect(resL1.value.stats.vocabCount).toBe(1);
      expect(resL1.value.stats.grammarCount).toBe(1);
      expect(resL1.value.stats.exerciseCount).toBe(1);
      expect(resL1.value.stats.hasPassage).toBe(true);
      expect(resL1.value.allLessonsReady).toBe(false); // 第2课还是 pending
    }

    // 检查第 1 课槽位状态与内容
    const l1Slot = db
      .select()
      .from(schema.textbookLessons)
      .where(and(eq(schema.textbookLessons.documentId, 'doc_commit_01'), eq(schema.textbookLessons.lessonId, 'l1')))
      .get();
    expect(l1Slot?.status).toBe('ready');
    expect(l1Slot?.title).toBe('第1课 小李是学生（精校）');
    expect(l1Slot?.passageMd).toContain('李さんは中国人です');

    // 检查生词
    const vocabs = db
      .select()
      .from(schema.textbookVocab)
      .where(and(eq(schema.textbookVocab.documentId, 'doc_commit_01'), eq(schema.textbookVocab.lessonId, 'l1')))
      .all();
    expect(vocabs).toHaveLength(1);
    expect(vocabs[0]!.surface).toBe('学生');
    expect(vocabs[0]!.reading).toBe('がくせい');

    // 检查语法
    const grammars = db
      .select()
      .from(schema.textbookGrammar)
      .where(and(eq(schema.textbookGrammar.documentId, 'doc_commit_01'), eq(schema.textbookGrammar.lessonId, 'l1')))
      .all();
    expect(grammars).toHaveLength(1);
    expect(grammars[0]!.title).toBe('～は～です');

    // 检查习题
    const exercises = db
      .select()
      .from(schema.textbookExercises)
      .where(and(eq(schema.textbookExercises.documentId, 'doc_commit_01'), eq(schema.textbookExercises.lessonId, 'l1')))
      .all();
    expect(exercises).toHaveLength(1);
    expect(exercises[0]!.answer).toBe('A');

    // 检查全文搜索虚表
    const fts = db
      .all(sql`SELECT * FROM textbook_fts WHERE document_id = 'doc_commit_01' AND lesson_id = 'l1'`) as Array<{ surface: string }>;
    expect(fts.length).toBeGreaterThan(0);
    expect(fts[0]!.surface).toBe('学生');

    // 3. 回填第 2 课，全书变成 allLessonsReady = true
    const resL2 = await commitLessonKnowledge(
      { db },
      {
        documentId: 'doc_commit_01',
        lessonId: 'l2',
        passageMd: '短文2',
      }
    );
    expect(isOk(resL2)).toBe(true);
    if (isOk(resL2)) {
      expect(resL2.value.allLessonsReady).toBe(true);
    }
  });

  it('脱离目录白名单凭空造课：拦截并报错 E_TOC_SLOT_NOT_FOUND', async () => {
    const { db } = freshDb();

    // 预置目录只有 l1
    await seedTextbookTocSkeleton(
      { db },
      {
        documentId: 'doc_strict_01',
        userId: 'u1',
        title: '测试教材',
        entries: [{ id: 'l1', level: 'lesson', title: '第1课', startPage: 1 }],
      }
    );

    // 大模型尝试提交 l999（目录里根本没有）
    const res = await commitLessonKnowledge(
      { db },
      {
        documentId: 'doc_strict_01',
        lessonId: 'l999',
        passageMd: '幻觉课文',
      }
    );

    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.code).toBe('E_TOC_SLOT_NOT_FOUND');
      expect(res.error.userMessage).toContain('未找到课次');
    }

    // 数据库零脏写入
    const vocabs = db.select().from(schema.textbookVocab).where(eq(schema.textbookVocab.documentId, 'doc_strict_01')).all();
    expect(vocabs).toHaveLength(0);
  });
});
