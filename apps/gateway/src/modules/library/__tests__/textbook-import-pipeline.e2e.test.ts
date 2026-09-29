import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { isOk } from '@study-studio/shared';
import {
  initSchema,
  textbookLessons,
  textbookVocab,
  textbookGrammar,
  textbookExercises,
  documents,
} from '@study-studio/storage-sqlite';
import * as schema from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LibrarySubmitTocTool } from '../tools/library-toc-tool.js';
import { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import {
  LessonBatchExtractor,
  type AgentPoolLike,
  type AgentPoolLease,
} from '../application/lesson-batch-extractor.js';
import type { ToolExecutionContext } from '@study-studio/tool-core';

function freshTestEnvironment() {
  const repo = new DrizzleLearnerRepository(':memory:');
  const sqlite = repo.getRawDb();
  const db = drizzle(sqlite, { schema });
  return { sqlite, db, repo };
}

const dummyContext: ToolExecutionContext = {
  userId: 'user_e2e_01',
  sessionId: 'session_e2e_01',
};

describe('教材导入 AI-Native 管道端到端集成测试 (E2E Pipeline)', () => {
  it('【正向完整闭环】目录建立 → 槽位初始化 → 大模型并发提炼 → 白名单回填 → 全书就绪', async () => {
    const { db, repo } = freshTestEnvironment();

    // 1. Phase 0: 模拟 Vision 大模型识别目录并调用 LibrarySubmitTocTool
    const tocTool = new LibrarySubmitTocTool(repo);
    const tocResult = await tocTool.execute(
      {
        documentId: 'doc_tb_minna_01',
        userId: 'user_e2e_01',
        title: '大家的日语第一册',
        language: 'ja',
        entries: [
          { id: 'u1', level: 'unit', title: '第1单元 基础交流', startPage: 1 },
          { id: 'l1', level: 'lesson', title: '第1课 小野是日本人', startPage: 6, endPage: 15, parentId: 'u1' },
          { id: 'l2', level: 'lesson', title: '第2课 这是我的书', startPage: 16, endPage: 25, parentId: 'u1' },
        ],
      },
      dummyContext
    );

    expect(isOk(tocResult)).toBe(true);
    if (isOk(tocResult)) {
      expect(tocResult.value.lessonCount).toBe(2);
      expect(tocResult.value.totalEntries).toBe(3);
    }

    // 校验真实 SQLite 数据库：全量槽位处于 pending 状态
    const initialLessons = db.select().from(textbookLessons).where(eq(textbookLessons.documentId, 'doc_tb_minna_01')).all();
    expect(initialLessons.length).toBe(3); // 1 unit + 2 lessons
    expect(initialLessons.filter((l) => l.kind === 'lesson').length).toBe(2);
    expect(initialLessons.every((l) => l.status === 'pending')).toBe(true);
    expect(initialLessons.every((l) => l.passageMd === null)).toBe(true);

    // 2. Phase 1 & 2: 大模型提炼知识点与回填（注入 Mock AgentPool 模拟真实 LLM 输出）
    const mockResponses: Record<string, string> = {
      l1: [
        '这是分析第1课的结果：',
        '```json',
        JSON.stringify({
          title: '第1课 小野是日本人',
          passageMd: '# 第1课\n\n小野さんは日本人です。李さんは中国人です。',
          vocabularies: [
            { surface: '小野', reading: 'おの', pos: '名', glossZh: '小野（姓氏）', pitch: '⓪' },
            { surface: '日本人', reading: 'にほんじん', pos: '名', glossZh: '日本人', pitch: '④' },
          ],
          knowledgePoints: [
            {
              title: '～は～です',
              connection: '名词 + は + 名词 + です',
              explanation: '判断句的肯定形式。',
              examples: [{ japanese: '私は学生です。', chinese: '我是学生。' }],
            },
          ],
          exercises: [
            {
              type: 'CHOICE',
              prompt: '小野さんは___です。',
              options: ['日本人', '中国人', 'アメリカ人'],
              answer: '日本人',
              explanation: '课文原句',
            },
          ],
        }),
        '```',
      ].join('\n'),
      l2: JSON.stringify({
        title: '第2课 这是我的书',
        passageMd: '# 第2课\n\nこれは私の本です。それは辞書です。',
        vocabularies: [
          { surface: '本', reading: 'ほん', pos: '名', glossZh: '书', pitch: '①' },
        ],
        knowledgePoints: [
          {
            title: 'これ/それ/あれ',
            connection: '指示代词',
            explanation: '指代近处、中等距离和远处的事物。',
            examples: [{ japanese: 'これはペンです。', chinese: '这是钢笔。' }],
          },
        ],
        exercises: [
          {
            type: 'TRANSLATION',
            prompt: '这是书。',
            answer: 'これは本です。',
            explanation: '判断句与代词结合',
          },
        ],
      }),
    };

    const mockPool: AgentPoolLike = {
      acquire: async () => ({
        ask: async (prompt) => {
          const promptStr = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
          const targetLessonId = promptStr.includes('课次: l1') ? 'l1' : 'l2';
          return { text: mockResponses[targetLessonId] ?? '{}' };
        },
        finish: async () => {},
      }),
      close: async () => {},
    };

    const progressLogs: Array<{ completed: number; total: number; allReady: boolean }> = [];
    const extractor = new LessonBatchExtractor(repo);

    const summary = await extractor.extractBatch(
      [
        { documentId: 'doc_tb_minna_01', lessonId: 'l1', ocrText: '小野さんは日本人です...' },
        { documentId: 'doc_tb_minna_01', lessonId: 'l2', ocrText: 'これは私の本です...' },
      ],
      {
        pool: mockPool,
        onProgress: (p) => {
          progressLogs.push({ completed: p.completedCount, total: p.totalCount, allReady: p.allLessonsReady });
        },
      }
    );

    // 断言批处理汇总
    expect(summary.totalJobs).toBe(2);
    expect(summary.successfulJobs).toBe(2);
    expect(summary.failedJobs).toBe(0);
    expect(summary.allLessonsReady).toBe(true);
    expect(progressLogs.length).toBe(2);
    expect(progressLogs[1]?.allReady).toBe(true);

    // 3. 严格核验真实 SQLite 数据库落地状态（SSOT 资产）
    const finalizedLessons = db.select().from(textbookLessons).where(eq(textbookLessons.documentId, 'doc_tb_minna_01')).all();
    const actualLessons = finalizedLessons.filter((l) => l.kind === 'lesson');
    expect(actualLessons.length).toBe(2);
    expect(actualLessons.every((l) => l.status === 'ready')).toBe(true);
    expect(actualLessons.find((l) => l.lessonId === 'l1')?.passageMd).toContain('小野さんは日本人です');
    expect(actualLessons.find((l) => l.lessonId === 'l2')?.passageMd).toContain('これは私の本です');

    const vocabs = db.select().from(textbookVocab).where(eq(textbookVocab.documentId, 'doc_tb_minna_01')).all();
    expect(vocabs.length).toBe(3); // l1(2) + l2(1)
    expect(vocabs.map((v) => v.surface)).toContain('小野');
    expect(vocabs.map((v) => v.surface)).toContain('本');

    const grammars = db.select().from(textbookGrammar).where(eq(textbookGrammar.documentId, 'doc_tb_minna_01')).all();
    expect(grammars.length).toBe(2); // l1(1) + l2(1)
    expect(grammars.map((g) => g.title)).toContain('～は～です');
    expect(grammars.map((g) => g.title)).toContain('これ/それ/あれ');

    const exercises = db.select().from(textbookExercises).where(eq(textbookExercises.documentId, 'doc_tb_minna_01')).all();
    expect(exercises.length).toBe(2); // l1(1) + l2(1)
  });

  it('【负向防御 Case 1】目录识别页码倒退时拦截，数据库零写入', async () => {
    const { db, repo } = freshTestEnvironment();
    const tocTool = new LibrarySubmitTocTool(repo);

    const result = await tocTool.execute(
      {
        documentId: 'doc_invalid_order',
        userId: 'user_e2e_01',
        title: '倒退教材',
        entries: [
          { id: 'l1', level: 'lesson', title: '第1课', startPage: 20 },
          { id: 'l2', level: 'lesson', title: '第2课', startPage: 10 }, // 页码倒退
        ],
      },
      dummyContext
    );

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('E_TOC_PAGE_ORDER_INVALID');
      expect(result.error.userMessage).toContain('目录页码未单调递增');
    }

    // 验证数据库中未创建任何数据
    const docs = db.select().from(documents).where(eq(documents.id, 'doc_invalid_order')).all();
    expect(docs.length).toBe(0);
  });

  it('【负向防御 Case 2】大模型幻觉造课（槽位脱离已落库目录）时直接拦截', async () => {
    const { repo } = freshTestEnvironment();

    // 先建立正常单课目录
    const tocTool = new LibrarySubmitTocTool(repo);
    await tocTool.execute(
      {
        documentId: 'doc_strict_toc',
        userId: 'user_e2e_01',
        title: '严谨教材',
        entries: [{ id: 'l1', level: 'lesson', title: '第1课', startPage: 1 }],
      },
      dummyContext
    );

    // 模拟大模型试图提交未在目录中声明的 l999 槽位
    const commitTool = new LibraryLessonCommitTool(repo);
    const result = await commitTool.execute(
      {
        documentId: 'doc_strict_toc',
        lessonId: 'l999',
        passageMd: '凭空捏造的内容',
      },
      dummyContext
    );

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('E_TOC_SLOT_NOT_FOUND');
      expect(result.error.userMessage).toContain('未找到课次 "l999"');
    }
  });

  it('【负向容错 Case 3】大模型输出破损 JSON：提取器安全捕获并记录错误，批处理不崩溃', async () => {
    const { repo } = freshTestEnvironment();
    const tocTool = new LibrarySubmitTocTool(repo);
    await tocTool.execute(
      {
        documentId: 'doc_broken_json',
        userId: 'user_e2e_01',
        title: '测试教材',
        entries: [{ id: 'l1', level: 'lesson', title: '第1课', startPage: 1 }],
      },
      dummyContext
    );

    const mockPool: AgentPoolLike = {
      acquire: async () => ({
        ask: async () => ({ text: '【截断损坏输出】{"title": "第一课", "passageMd": ' }),
        finish: async () => {},
      }),
      close: async () => {},
    };

    const extractor = new LessonBatchExtractor(repo);
    const summary = await extractor.extractBatch(
      [{ documentId: 'doc_broken_json', lessonId: 'l1', ocrText: '课文扫描文本' }],
      { pool: mockPool }
    );

    expect(summary.totalJobs).toBe(1);
    expect(summary.successfulJobs).toBe(0);
    expect(summary.failedJobs).toBe(1);
    expect(summary.errors.length).toBe(1);
    expect(summary.errors[0]?.error).toContain('无法解析为 JSON');
  });

  it('【负向容错 Case 4】大模型输出违背 Schema（非法枚举题型）：被 Zod 拦截', async () => {
    const { repo } = freshTestEnvironment();
    const tocTool = new LibrarySubmitTocTool(repo);
    await tocTool.execute(
      {
        documentId: 'doc_bad_schema',
        userId: 'user_e2e_01',
        title: '测试教材',
        entries: [{ id: 'l1', level: 'lesson', title: '第1课', startPage: 1 }],
      },
      dummyContext
    );

    const mockPool: AgentPoolLike = {
      acquire: async () => ({
        ask: async () => ({
          text: JSON.stringify({
            exercises: [
              {
                type: 'UNSUPPORTED_QUESTION_TYPE', // 非 CHOICE/FILL_BLANK/TRANSLATION
                prompt: '题目',
                answer: '答案',
              },
            ],
          }),
        }),
        finish: async () => {},
      }),
      close: async () => {},
    };

    const extractor = new LessonBatchExtractor(repo);
    const summary = await extractor.extractBatch(
      [{ documentId: 'doc_bad_schema', lessonId: 'l1', ocrText: '课文扫描文本' }],
      { pool: mockPool }
    );

    expect(summary.successfulJobs).toBe(0);
    expect(summary.failedJobs).toBe(1);
    expect(summary.errors[0]?.error).toContain('大模型提炼的结构不符合规范');
  });

  it('【负向容错 Case 5】底层 Worker 抛错与网络超时：安全隔离捕获并正确释放 Lease', async () => {
    const { repo } = freshTestEnvironment();
    const tocTool = new LibrarySubmitTocTool(repo);
    await tocTool.execute(
      {
        documentId: 'doc_worker_error',
        userId: 'user_e2e_01',
        title: '测试教材',
        entries: [{ id: 'l1', level: 'lesson', title: '第1课', startPage: 1 }],
      },
      dummyContext
    );

    let leaseFinished = false;
    const mockPool: AgentPoolLike = {
      acquire: async () => ({
        ask: async () => {
          throw new Error('Codex connection timed out after 30000ms');
        },
        finish: async () => {
          leaseFinished = true;
        },
      }),
      close: async () => {},
    };

    const extractor = new LessonBatchExtractor(repo);
    const summary = await extractor.extractBatch(
      [{ documentId: 'doc_worker_error', lessonId: 'l1', ocrText: '课文' }],
      { pool: mockPool }
    );

    expect(summary.successfulJobs).toBe(0);
    expect(summary.failedJobs).toBe(1);
    expect(summary.errors[0]?.error).toContain('Codex connection timed out');
    expect(leaseFinished).toBe(true); // 保证即使抛错 lease 也被安全释放归还
  });

  it('【部分成功部分失败隔离与重试】第1课成功第2课失败，状态独立且可幂等重试', async () => {
    const { db, repo } = freshTestEnvironment();

    // 建立两课
    const tocTool = new LibrarySubmitTocTool(repo);
    await tocTool.execute(
      {
        documentId: 'doc_partial_retry',
        userId: 'user_e2e_01',
        title: '部分失败教材',
        entries: [
          { id: 'l1', level: 'lesson', title: '第1课', startPage: 1 },
          { id: 'l2', level: 'lesson', title: '第2课', startPage: 10 },
        ],
      },
      dummyContext
    );

    // 第一次批处理：l1 成功，l2 返回无效 JSON 失败
    const mockPoolFirstTry: AgentPoolLike = {
      acquire: async () => ({
        ask: async (prompt) => {
          const str = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
          if (str.includes('课次: l1')) {
            return { text: JSON.stringify({ passageMd: '第一课成功课文' }) };
          }
          return { text: 'bad json for l2' };
        },
        finish: async () => {},
      }),
      close: async () => {},
    };

    const extractor = new LessonBatchExtractor(repo);
    const firstSummary = await extractor.extractBatch(
      [
        { documentId: 'doc_partial_retry', lessonId: 'l1', ocrText: '内容1' },
        { documentId: 'doc_partial_retry', lessonId: 'l2', ocrText: '内容2' },
      ],
      { pool: mockPoolFirstTry }
    );

    expect(firstSummary.successfulJobs).toBe(1);
    expect(firstSummary.failedJobs).toBe(1);
    expect(firstSummary.allLessonsReady).toBe(false);

    // 核验数据库：l1 为 ready，l2 仍为 pending
    const lessonsAfterFirst = db.select().from(textbookLessons).where(eq(textbookLessons.documentId, 'doc_partial_retry')).all();
    expect(lessonsAfterFirst.find((l) => l.lessonId === 'l1')?.status).toBe('ready');
    expect(lessonsAfterFirst.find((l) => l.lessonId === 'l2')?.status).toBe('pending');

    // 第二次对 l2 发起重试：模拟修复后的大模型输出
    const mockPoolRetry: AgentPoolLike = {
      acquire: async () => ({
        ask: async () => ({
          text: JSON.stringify({ passageMd: '第二课重试成功课文' }),
        }),
        finish: async () => {},
      }),
      close: async () => {},
    };

    const retrySummary = await extractor.extractBatch(
      [{ documentId: 'doc_partial_retry', lessonId: 'l2', ocrText: '内容2' }],
      { pool: mockPoolRetry }
    );

    expect(retrySummary.successfulJobs).toBe(1);
    expect(retrySummary.failedJobs).toBe(0);
    expect(retrySummary.allLessonsReady).toBe(true);

    // 核验数据库：全书已彻底全部就绪
    const lessonsFinal = db.select().from(textbookLessons).where(eq(textbookLessons.documentId, 'doc_partial_retry')).all();
    expect(lessonsFinal.every((l) => l.status === 'ready')).toBe(true);
  });
});
