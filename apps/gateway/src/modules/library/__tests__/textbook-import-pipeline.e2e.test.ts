import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function rmRetry(dir: string): Promise<void> {
  let last: unknown = null;
  for (let i = 0; i < 30; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw last;
}

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

  it('【真实物理磁盘数据库持久化与冷启动复验】实际落入真实 SQLite 磁盘文件，冷启动重新连接读取验证持久化完整性', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ss-realdb-e2e-'));
    const realDbPath = join(tempDir, 'actual-textbook-test.db');

    let repo: DrizzleLearnerRepository | null = null;
    let coldSqlite: Database | null = null;

    try {
      // 1. 使用真实磁盘文件路径创建仓储与底层 SQLite 实例（非内存库，走真实文件 I/O 与 WAL 日志）
      repo = new DrizzleLearnerRepository(realDbPath);
      const tocTool = new LibrarySubmitTocTool(repo);

      // Phase 0: 目录识别并优先落盘建立骨架
      const tocResult = await tocTool.execute(
        {
          documentId: 'doc_tb_real_disk_01',
          userId: 'user_real_disk',
          title: '真实落盘教材',
          language: 'ja',
          entries: [
            { id: 'u1', level: 'unit', title: '第1单元', startPage: 1 },
            { id: 'l1', level: 'lesson', title: '第1课 真实持久化', startPage: 5, endPage: 12, parentId: 'u1' },
            { id: 'l2', level: 'lesson', title: '第2课 真实事务回填', startPage: 13, endPage: 20, parentId: 'u1' },
          ],
        },
        dummyContext
      );
      expect(isOk(tocResult)).toBe(true);

      // Phase 1&2: 模拟 AgentPool 并发提炼并原子写入物理磁盘
      const mockPool: AgentPoolLike = {
        acquire: async () => ({
          ask: async (prompt) => {
            const promptStr = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
            const isLesson1 = promptStr.includes('课次: l1');
            return {
              text: JSON.stringify({
                title: isLesson1 ? '第1课 真实持久化' : '第2课 真实事务回填',
                passageMd: isLesson1
                  ? '# 第1课 真实持久化\n\n数据已成功写入物理磁盘文件。'
                  : '# 第2课 真实事务回填\n\n事务落盘测试完成。',
                vocabularies: [
                  {
                    surface: isLesson1 ? '永続化' : '排他制御',
                    reading: isLesson1 ? 'えいぞくか' : 'はいたいせいぎょ',
                    glossZh: isLesson1 ? '持久化' : '互斥控制',
                  },
                ],
                knowledgePoints: [
                  {
                    title: isLesson1 ? '～てある（存续态）' : '～ておく（预先准备）',
                    explanation: '知识点说明',
                    examples: [{ japanese: '本が置いてあります。', chinese: '放着书。' }],
                  },
                ],
                exercises: [
                  {
                    type: 'CHOICE',
                    prompt: '数据写入了哪里？',
                    options: ['内存', '真实磁盘数据库', '云端'],
                    answer: '真实磁盘数据库',
                    explanation: '本测试针对真实磁盘 SQLite 库',
                  },
                ],
              }),
            };
          },
          finish: async () => {},
        }),
        close: async () => {},
      };

      const extractor = new LessonBatchExtractor(repo);
      const batchResult = await extractor.extractBatch(
        [
          { documentId: 'doc_tb_real_disk_01', lessonId: 'l1', ocrText: '文本1' },
          { documentId: 'doc_tb_real_disk_01', lessonId: 'l2', ocrText: '文本2' },
        ],
        { pool: mockPool }
      );

      expect(batchResult.successfulJobs).toBe(2);
      expect(batchResult.allLessonsReady).toBe(true);

      // 验证物理磁盘文件确实在文件系统上存在且具有非零体积
      expect(existsSync(realDbPath)).toBe(true);
      const stat = statSync(realDbPath);
      expect(stat.size).toBeGreaterThan(0);

      // 2. 模拟应用完全退出：彻底关闭现有仓储连接句柄
      repo.getRawDb().close();
      repo = null;

      // 3. 模拟冷启动：完全新建一个独立的只读 SQLite 连接从磁盘重新读取（脱离原连接上下文）
      coldSqlite = new Database(realDbPath, { readonly: true });

      // 验证数据库物理完整性（无损坏、无裂缝）
      const integrity = coldSqlite.query('PRAGMA integrity_check;').all() as Array<{ integrity_check: string }>;
      expect(integrity[0]?.integrity_check).toBe('ok');

      // 验证冷启动读取教材元数据
      const coldDoc = coldSqlite
        .query('SELECT id, title, source_kind FROM documents WHERE id = ?')
        .get('doc_tb_real_disk_01') as { id: string; title: string; source_kind: string } | null;
      expect(coldDoc).not.toBeNull();
      expect(coldDoc?.title).toBe('真实落盘教材');

      // 验证冷启动读取课文槽位与 Markdown
      const coldLessons = coldSqlite
        .query('SELECT lesson_id, kind, status, passage_md FROM textbook_lessons WHERE document_id = ? ORDER BY sort_order ASC')
        .all('doc_tb_real_disk_01') as Array<{ lesson_id: string; kind: string; status: string; passage_md: string | null }>;
      expect(coldLessons.length).toBe(3);
      const actualLessons = coldLessons.filter((l) => l.kind === 'lesson');
      expect(actualLessons.length).toBe(2);
      expect(actualLessons.every((l) => l.status === 'ready')).toBe(true);
      expect(actualLessons.find((l) => l.lesson_id === 'l1')?.passage_md).toContain('数据已成功写入物理磁盘文件');
      expect(actualLessons.find((l) => l.lesson_id === 'l2')?.passage_md).toContain('事务落盘测试完成');

      // 验证冷启动读取生词表
      const coldVocab = coldSqlite
        .query('SELECT surface, reading, gloss_zh FROM textbook_vocab WHERE document_id = ?')
        .all('doc_tb_real_disk_01') as Array<{ surface: string; reading: string; gloss_zh: string }>;
      expect(coldVocab.length).toBe(2);
      expect(coldVocab.map((v) => v.surface)).toContain('永続化');
      expect(coldVocab.map((v) => v.surface)).toContain('排他制御');

      // 验证冷启动读取语法与习题
      const coldGrammar = coldSqlite
        .query('SELECT title, examples_json FROM textbook_grammar WHERE document_id = ?')
        .all('doc_tb_real_disk_01') as Array<{ title: string; examples_json: string }>;
      expect(coldGrammar.length).toBe(2);
      expect(coldGrammar.map((g) => g.title)).toContain('～てある（存续态）');

      const coldExercises = coldSqlite
        .query('SELECT prompt, answer FROM textbook_exercises WHERE document_id = ?')
        .all('doc_tb_real_disk_01') as Array<{ prompt: string; answer: string }>;
      expect(coldExercises.length).toBe(2);
      expect(coldExercises.every((e) => e.answer === '真实磁盘数据库')).toBe(true);
    } finally {
      if (repo) {
        try {
          (repo as DrizzleLearnerRepository).getRawDb().close();
        } catch {}
      }
      if (coldSqlite) {
        try {
          (coldSqlite as Database).close();
        } catch {}
      }
      await rmRetry(tempDir);
    }
  });

  it('【一条龙全贯通流水线】executeTextbookPipeline：任务台账 → Phase 0 骨架建槽 → Phase 1&2 并发提炼 → 任务终结全闭环（真实物理磁盘验证）', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'study-studio-pipeline-dragon-'));
    const realDbPath = join(tempDir, 'dragon-pipeline.db');

    let repo: DrizzleLearnerRepository | null = null;
    let coldSqlite: Database | null = null;

    try {
      // 1. 初始化真实磁盘仓储
      repo = new DrizzleLearnerRepository(realDbPath);
      const documentId = 'doc_dragon_001';

      // 模拟符合 AgentPoolLike 契约且返回标准提炼结构的大模型 Worker 池
      const mockPool: AgentPoolLike = {
        acquire: async () => ({
          ask: async () => ({
            text: JSON.stringify({
              passageMd: '# 第 1 课 一条龙精读课文\n\n一条龙流水线贯通测试，无补丁整洁架构。',
              vocabularies: [
                { surface: '一本化', reading: 'いっぽんか', glossZh: '一体化，统一' },
              ],
              knowledgePoints: [
                {
                  title: '～を通じて',
                  explanation: '通过……整个过程',
                  examples: [{ japanese: '一連のパイプラインを通じて処理する。', chinese: '通过一整套流水线进行处理。' }],
                },
              ],
              exercises: [
                {
                  type: 'CHOICE',
                  prompt: '一条龙流水线的作用是什么？',
                  options: ['修补漏洞', '端到端整洁打通', '增加中间层'],
                  answer: '端到端整洁打通',
                  explanation: '杜绝打补丁，从建档到提炼全链路自洽。',
                },
              ],
            }),
          }),
          finish: async () => {},
        }),
        close: async () => {},
      };

      const progressEvents: number[] = [];

      // 2. 直接驱动一条龙高层服务
      const result = await repo.executeTextbookPipeline({
        userId: 'user_dragon_01',
        documentId,
        title: '新编日语一条龙导入教材',
        language: 'ja',
        filename: 'shinpen_nihongo_01.pdf',
        tocEntries: [
          { id: 'u1', level: 'unit', title: '第一单元', startPage: 1, endPage: 20 },
          { id: 'lesson_d1', level: 'lesson', title: '第1课 一体化概念', startPage: 1, endPage: 10, parentId: 'u1' },
          { id: 'lesson_d2', level: 'lesson', title: '第2课 整洁架构实践', startPage: 11, endPage: 20, parentId: 'u1' },
        ],
        lessonJobs: [
          { lessonId: 'lesson_d1', ocrText: '第1课 扫描文本内容...' },
          { lessonId: 'lesson_d2', ocrText: '第2课 扫描文本内容...' },
        ],
        pool: mockPool,
        onProgress: (p) => {
          progressEvents.push(p.completedCount);
        },
      });

      // 3. 校验一条龙管道输出
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const output = result.value;
      expect(output.documentId).toBe(documentId);
      expect(output.title).toBe('新编日语一条龙导入教材');
      expect(output.lessonCount).toBe(2); // 2 core lessons
      expect(output.allLessonsReady).toBe(true);
      expect(output.successfulLessons).toBe(2);
      expect(output.failedLessons).toBe(0);
      expect(output.task.status).toBe('done');
      expect(output.task.lessons).toBe(2);
      expect(progressEvents.length).toBeGreaterThanOrEqual(2);

      // 4. 关闭现有仓储连接，模拟应用完全退出
      repo.getRawDb().close();
      repo = null;

      // 5. 冷启动验证真实磁盘持久化
      coldSqlite = new Database(realDbPath, { readonly: true });

      // PRAGMA 完整性检查
      const integrity = coldSqlite.query('PRAGMA integrity_check;').all() as Array<{ integrity_check: string }>;
      expect(integrity[0]?.integrity_check).toBe('ok');

      // 验证任务台账落盘
      const coldTask = coldSqlite
        .query('SELECT status, lessons, document_id FROM document_imports WHERE id = ?')
        .get(output.task.id) as { status: string; lessons: number; document_id: string } | null;
      expect(coldTask).not.toBeNull();
      expect(coldTask?.status).toBe('done');
      expect(coldTask?.lessons).toBe(2);
      expect(coldTask?.document_id).toBe(documentId);

      // 验证课文槽位状态全部翻转为 ready
      const coldLessons = coldSqlite
        .query('SELECT lesson_id, status, passage_md FROM textbook_lessons WHERE document_id = ? AND kind = ?')
        .all(documentId, 'lesson') as Array<{ lesson_id: string; status: string; passage_md: string }>;
      expect(coldLessons.length).toBe(2);
      expect(coldLessons.every((l) => l.status === 'ready')).toBe(true);
      expect(coldLessons.find((l) => l.lesson_id === 'lesson_d1')?.passage_md).toContain('一条龙精读课文');

      // 验证生词、语法、习题均成功落盘
      const vocabRows = coldSqlite
        .query('SELECT surface, reading, gloss_zh FROM textbook_vocab WHERE document_id = ?')
        .all(documentId) as Array<{ surface: string; reading: string; gloss_zh: string }>;
      expect(vocabRows.length).toBe(2);
      expect(vocabRows.map((v) => v.surface)).toContain('一本化');

      const grammarCount = coldSqlite
        .query('SELECT COUNT(*) as count FROM textbook_grammar WHERE document_id = ?')
        .get(documentId) as { count: number };
      expect(grammarCount.count).toBe(2);

      const exerciseCount = coldSqlite
        .query('SELECT COUNT(*) as count FROM textbook_exercises WHERE document_id = ?')
        .get(documentId) as { count: number };
      expect(exerciseCount.count).toBe(2);
    } finally {
      if (repo) {
        try {
          (repo as DrizzleLearnerRepository).getRawDb().close();
        } catch {}
      }
      if (coldSqlite) {
        try {
          (coldSqlite as Database).close();
        } catch {}
      }
      await rmRetry(tempDir);
    }
  });
});

