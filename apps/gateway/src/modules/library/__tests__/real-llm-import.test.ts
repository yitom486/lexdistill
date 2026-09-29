import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LibrarySubmitTocTool } from '../tools/library-toc-tool.js';
import {
  createDefaultAgentPool,
  LessonBatchExtractor,
} from '../application/lesson-batch-extractor.js';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '@study-studio/storage-sqlite';
import {
  documents,
  textbookLessons,
  textbookVocab,
  textbookGrammar,
  textbookExercises,
} from '@study-studio/storage-sqlite';
import { eq } from 'drizzle-orm';

const dummyContext = {
  sessionId: 'test-real-llm-session',
  userId: 'user-real-llm',
  toolCallId: 'call-real-llm',
};

describe('真实大模型（Codex App Server）端到端教材导入集成测试', () => {
  it('真实接入大模型：识别教材正文 OCR → 提炼生词/语法/习题 → 原子落盘至物理 SQLite 库 → 同步生成 AST 底稿（测试后环境自销毁）', async () => {
    // 1. 创建独立且隔离的临时目录与 SQLite 物理数据库文件（保证环境绝对干净，零污染）
    const tempDir = await mkdtemp(join(tmpdir(), 'ss-real-llm-test-'));
    const realDbPath = join(tempDir, 'clean-test-textbook.db');

    let repo: DrizzleLearnerRepository | null = null;
    let pool: ReturnType<typeof createDefaultAgentPool> | null = null;

    try {
      repo = new DrizzleLearnerRepository(realDbPath);
      const db = drizzle(repo.getRawDb(), { schema });

      // 2. Phase 0: 目录识别并初始化骨架槽位
      const tocTool = new LibrarySubmitTocTool(repo);
      const tocResult = await tocTool.execute(
        {
          documentId: 'doc_real_llm_01',
          userId: 'user_real_llm_test',
          title: '标准日本语 初级上册（真实模型提炼测试）',
          language: 'ja',
          entries: [
            {
              id: 'l1',
              level: 'lesson',
              title: '第1課 李さんは中国人です',
              startPage: 14,
              endPage: 23,
            },
          ],
        },
        dummyContext
      );

      expect(isOk(tocResult)).toBe(true);
      if (!isOk(tocResult)) return;

      // 验证槽位成功建立在 SQLite 物理库中（status = pending）
      const initialSlot = db
        .select()
        .from(textbookLessons)
        .where(eq(textbookLessons.documentId, 'doc_real_llm_01'))
        .all();
      expect(initialSlot.length).toBe(1);
      expect(initialSlot[0]?.status).toBe('pending');

      // 3. 准备一段真实的教材扫描 OCR 课文内容（包含课文对话、生词表、语法点和练习）
      const sampleOcrText = [
        '第1課 李さんは中国人です',
        '',
        '【基本会話】',
        '李：はじめまして、李秀麗です。JC企画の社員です。どうぞよろしく。',
        '小野：初めまして、小野緑です。こちらこそよろしくお願いいたします。',
        '李：小野さんは日本人ですか。',
        '小野：はい、日本人です。李さんは中国人ですか。',
        '李：はい、中国人です。',
        '',
        '【単語（ことば）】',
        '中国人（ちゅうごくじん） [名] 中国人 ⑤ [例] 李さんは中国人です。',
        '社員（しゃいん） [名] 职员、员工 ① [例] 会社の社員です。',
        'はじめまして [組] 初次见面 ⑤',
        '',
        '【文法・解説】',
        '1. ～は～です（判断句肯定）',
        '接续：名词 + は + 名词 + です',
        '说明：「は」是提示助词，读作「wa」，提示句子的主题。「です」是断定助词，相当于汉语的“是”。',
        '例句：',
        '・わたしは学生です。（我是学生。）',
        '・李さんは社員です。（李先生是员工。）',
        '',
        '【練習】',
        '一、选择适当的词填空：',
        'わたし（　）田中です。',
        'A. は　B. が　C. を',
        '答案：A',
        '解析：「は」提示主语/主题。',
      ].join('\n');

      // 4. 真实启动 AgentPool 租借并调用真实大模型（Codex App Server）
      console.log('>>> [Real LLM Test] 正在启动真实 AgentPool 并租借 Codex App Server Worker...');
      pool = createDefaultAgentPool({ poolSize: 1 });

      const extractor = new LessonBatchExtractor(repo);
      console.log('>>> [Real LLM Test] 正在向真实大模型发送课文提炼请求...');
      const extractResult = await extractor.extractBatch(
        [
          {
            documentId: 'doc_real_llm_01',
            lessonId: 'l1',
            title: '第1課 李さんは中国人です',
            startPage: 14,
            endPage: 23,
            ocrText: sampleOcrText,
          },
        ],
        { pool }
      );

      console.log('>>> [Real LLM Test] 大模型提炼并回填结果:', {
        successfulJobs: extractResult.successfulJobs,
        failedJobs: extractResult.failedJobs,
        allLessonsReady: extractResult.allLessonsReady,
      });

      expect(extractResult.successfulJobs).toBe(1);
      expect(extractResult.failedJobs).toBe(0);
      expect(extractResult.allLessonsReady).toBe(true);

      // 5. 严格验证真实 SQLite 物理库中的落库数据完整性
      const readyLessons = db
        .select()
        .from(textbookLessons)
        .where(eq(textbookLessons.documentId, 'doc_real_llm_01'))
        .all();
      expect(readyLessons.length).toBe(1);
      expect(readyLessons[0]?.status).toBe('ready');
      expect(readyLessons[0]?.passageMd).toBeDefined();
      expect(readyLessons[0]?.passageMd?.length).toBeGreaterThan(10);
      console.log('>>> [Real LLM Test] 真实大模型生成的精读 Markdown 全文预览:\n', readyLessons[0]?.passageMd?.slice(0, 200));

      const readyVocabs = db
        .select()
        .from(textbookVocab)
        .where(eq(textbookVocab.documentId, 'doc_real_llm_01'))
        .all();
      expect(readyVocabs.length).toBeGreaterThanOrEqual(2);
      console.log(
        '>>> [Real LLM Test] 真实大模型提取落库的生词列表:',
        readyVocabs.map((v) => ({ surface: v.surface, reading: v.reading, gloss: v.glossZh }))
      );

      const readyGrammars = db
        .select()
        .from(textbookGrammar)
        .where(eq(textbookGrammar.documentId, 'doc_real_llm_01'))
        .all();
      expect(readyGrammars.length).toBeGreaterThanOrEqual(1);
      console.log(
        '>>> [Real LLM Test] 真实大模型提取落库的语法列表:',
        readyGrammars.map((g) => ({ title: g.title, explanation: g.explanation?.slice(0, 50) }))
      );

      const readyExercises = db
        .select()
        .from(textbookExercises)
        .where(eq(textbookExercises.documentId, 'doc_real_llm_01'))
        .all();
      expect(readyExercises.length).toBeGreaterThanOrEqual(1);
      console.log(
        '>>> [Real LLM Test] 真实大模型提取落库的习题列表:',
        readyExercises.map((e) => ({ prompt: e.prompt, answer: e.answer }))
      );

      // 6. 验证底稿 documents.ast_json 是否已同事务自动聚合重组为合规的 TextbookAST
      const docRow = db
        .select()
        .from(documents)
        .where(eq(documents.id, 'doc_real_llm_01'))
        .all()[0]!;
      expect(docRow.astJson).not.toBeNull();
      const parsedAst = JSON.parse(docRow.astJson!);
      expect(parsedAst.id).toBe('doc_real_llm_01');
      expect(parsedAst.lessons.length).toBe(1);
      expect(parsedAst.lessons[0].vocabularies.length).toBeGreaterThanOrEqual(2);
      expect(parsedAst.lessons[0].grammarPoints.length).toBeGreaterThanOrEqual(1);
      console.log('>>> [Real LLM Test] 底稿 AST 同步成功！整书总课次数:', parsedAst.lessons.length);

    } finally {
      // 7. 环境彻底清理与自销毁（Clean State Invariant）：
      // 确保关闭连接池、关闭数据库、删除临时物理文件，不留下任何残留。
      if (pool) {
        try {
          await pool.close({ drain: true });
        } catch {
          // ignore
        }
      }
      if (repo) {
        try {
          repo.getRawDb().close();
        } catch {
          // ignore
        }
      }
      if (existsSync(tempDir)) {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
      console.log('>>> [Real LLM Test] 临时测试库与进程已彻底清理自销毁，测试前后环境完全纯净。');
    }
  }, 180000); // 预留大模型在并发全量测试环境下的分析超时时间
});
