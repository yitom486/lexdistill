import { describe, expect, it } from 'bun:test';
import { ok, err, isOk, BusinessError } from '@study-studio/shared';
import {
  LessonBatchExtractor,
  parseLessonExtractionJson,
  buildLessonExtractionPrompt,
  type AgentPoolLike,
  type AgentPoolLease,
} from '../lesson-batch-extractor.js';
import type { ContentRepository } from '../../ports.js';

describe('LessonBatchExtractor', () => {
  describe('parseLessonExtractionJson', () => {
    it('正确解析标准 JSON', () => {
      const json = JSON.stringify({
        title: '第1课 小野是日本人',
        passageMd: '# 课文\n小野さんは日本人です。',
        vocabularies: [
          { surface: '小野', reading: 'おの', glossZh: '小野' },
        ],
        knowledgePoints: [
          { title: '～は～です', explanation: '肯定判断句' },
        ],
        exercises: [
          { type: 'CHOICE', prompt: '他是日本人吗？', answer: 'はい', options: ['はい', 'いいえ'] },
        ],
      });

      const res = parseLessonExtractionJson(json);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.title).toBe('第1课 小野是日本人');
        expect(res.value.vocabularies?.length).toBe(1);
        expect(res.value.knowledgePoints?.length).toBe(1);
      }
    });

    it('兼容处理包裹在 Markdown 代码块中的 JSON', () => {
      const wrapped = '这是提炼的内容：\n```json\n{"title": "第一课", "passageMd": "内容"}\n```\n请查收。';
      const res = parseLessonExtractionJson(wrapped);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.title).toBe('第一课');
        expect(res.value.passageMd).toBe('内容');
      }
    });

    it('损坏的 JSON 拦截并返回业务错误', () => {
      const broken = '{ title: "not valid json" ';
      const res = parseLessonExtractionJson(broken);
      expect(isOk(res)).toBe(false);
      if (!isOk(res)) {
        expect(res.error.code).toBe('E_LLM_JSON_PARSE_FAILED');
      }
    });

    it('不合法的 Schema 结构被拦截', () => {
      const invalid = JSON.stringify({
        exercises: [{ type: 'NON_EXISTENT_TYPE', prompt: 'test', answer: 'ans' }],
      });
      const res = parseLessonExtractionJson(invalid);
      expect(isOk(res)).toBe(false);
      if (!isOk(res)) {
        expect(res.error.code).toBe('E_LLM_SCHEMA_INVALID');
      }
    });
  });

  describe('Prompt 构建', () => {
    it('buildLessonExtractionPrompt 包含核心要素', () => {
      const prompt = buildLessonExtractionPrompt({
        documentId: 'doc_1',
        lessonId: 'l1',
        title: '第一课',
        ocrText: '李さんは中国人です。',
      });
      expect(prompt).toContain('doc_1');
      expect(prompt).toContain('l1');
      expect(prompt).toContain('第一课');
      expect(prompt).toContain('李さんは中国人です。');
    });
  });

  describe('extractAndCommitSingleLesson & extractBatch', () => {
    it('单课提炼与落库成功流程', async () => {
      let leaseFinished = false;
      const mockLease: AgentPoolLease = {
        ask: async () => ({
          text: JSON.stringify({
            title: '第1课 小野是日本人',
            passageMd: '小野さんは日本人です。',
            vocabularies: [{ surface: '小野', reading: 'おの' }],
          }),
        }),
        finish: async () => {
          leaseFinished = true;
        },
      };

      const mockPool: AgentPoolLike = {
        acquire: async () => mockLease,
        close: async () => {},
      };

      let committedInput: unknown = null;
      const mockRepo: Partial<ContentRepository> = {
        commitLessonKnowledge: async (input) => {
          committedInput = input;
          return ok({
            documentId: input.documentId,
            lessonId: input.lessonId,
            stats: {
              vocabCount: 1,
              grammarCount: 0,
              exerciseCount: 0,
              hasPassage: true,
            },
            allLessonsReady: true,
          });
        },
      };

      const extractor = new LessonBatchExtractor(mockRepo as ContentRepository);
      const res = await extractor.extractAndCommitSingleLesson(
        {
          documentId: 'doc_tb_1',
          lessonId: 'l1',
          title: '第1课',
          ocrText: '小野さんは日本人です。',
        },
        mockPool
      );

      expect(isOk(res)).toBe(true);
      expect(leaseFinished).toBe(true);
      expect(committedInput).not.toBeNull();
    });

    it('并发批处理调度与进度通知', async () => {
      let poolClosed = false;
      const mockPool: AgentPoolLike = {
        acquire: async () => ({
          ask: async (_prompt) => ({
            text: JSON.stringify({
              passageMd: '课文全文',
              vocabularies: [{ surface: '単語' }],
            }),
          }),
          finish: async () => {},
        }),
        close: async () => {
          poolClosed = true;
        },
      };

      const committedLessons: string[] = [];
      const mockRepo: Partial<ContentRepository> = {
        commitLessonKnowledge: async (input) => {
          committedLessons.push(input.lessonId);
          return ok({
            documentId: input.documentId,
            lessonId: input.lessonId,
            stats: {
              vocabCount: 1,
              grammarCount: 0,
              exerciseCount: 0,
              hasPassage: true,
            },
            allLessonsReady: committedLessons.length === 3,
          });
        },
      };

      const progressEvents: number[] = [];
      const extractor = new LessonBatchExtractor(mockRepo as ContentRepository);

      const summary = await extractor.extractBatch(
        [
          { documentId: 'doc_tb_1', lessonId: 'l1', ocrText: '文本1' },
          { documentId: 'doc_tb_1', lessonId: 'l2', ocrText: '文本2' },
          { documentId: 'doc_tb_1', lessonId: 'l3', ocrText: '文本3' },
        ],
        {
          pool: mockPool,
          onProgress: (p) => {
            progressEvents.push(p.completedCount);
          },
        }
      );

      expect(summary.totalJobs).toBe(3);
      expect(summary.successfulJobs).toBe(3);
      expect(summary.failedJobs).toBe(0);
      expect(summary.allLessonsReady).toBe(true);
      expect(progressEvents.length).toBe(3);
      expect(committedLessons.length).toBe(3);
    });

    it('单课失败时不崩溃批处理整体流程，妥善聚合错误', async () => {
      const mockPool: AgentPoolLike = {
        acquire: async () => ({
          ask: async () => ({
            text: 'not a valid json output',
          }),
          finish: async () => {},
        }),
        close: async () => {},
      };

      const mockRepo: Partial<ContentRepository> = {
        commitLessonKnowledge: async () => {
          return err(new BusinessError('E_FAIL', '回填失败', 'DATABASE', false));
        },
      };

      const extractor = new LessonBatchExtractor(mockRepo as ContentRepository);
      const summary = await extractor.extractBatch(
        [{ documentId: 'doc_tb_1', lessonId: 'l1', ocrText: '坏数据' }],
        { pool: mockPool }
      );

      expect(summary.totalJobs).toBe(1);
      expect(summary.successfulJobs).toBe(0);
      expect(summary.failedJobs).toBe(1);
      expect(summary.errors.length).toBe(1);
      expect(summary.errors[0]?.lessonId).toBe('l1');
    });

    it('教学增强字段 (preview/summary) 成功解析并以 JSON 字符串回填', async () => {
      const captured: { input?: import('@study-studio/storage-sqlite').CommitLessonKnowledgeInput } = {};
      const mockPool: AgentPoolLike = {
        acquire: async () => ({
          ask: async () => ({
            text: JSON.stringify({
              title: '第1课',
              preview: {
                keyPoints: ['敬体与简体'],
                pitfalls: ['は与が'],
                canDoGoal: '打招呼',
              },
              summary: {
                goldenSentences: ['はじめまして。'],
                selfCheckQuestions: ['能分清动词分类吗？'],
              },
            }),
          }),
          finish: async () => {},
        }),
        close: async () => {},
      };

      const mockRepo: Partial<ContentRepository> = {
        commitLessonKnowledge: async (input) => {
          captured.input = input;
          return ok({
            documentId: input.documentId,
            lessonId: input.lessonId,
            stats: { vocabCount: 0, grammarCount: 0, exerciseCount: 0, hasPassage: false },
            allLessonsReady: true,
          });
        },
      };

      const extractor = new LessonBatchExtractor(mockRepo as ContentRepository);
      const res = await extractor.extractAndCommitSingleLesson(
        { documentId: 'doc_1', lessonId: 'l1', ocrText: '文本' },
        mockPool
      );

      expect(isOk(res)).toBe(true);
      expect(captured.input).toBeDefined();
      expect(captured.input?.previewJson).toContain('敬体与简体');
      expect(captured.input?.summaryJson).toContain('はじめまして。');
    });

    it('幂等性跳过：若课次已处于 ready 状态且未开启 forceOverwrite，默认跳过提炼以省算力防覆盖', async () => {
      let llmCalled = false;
      const mockPool: AgentPoolLike = {
        acquire: async () => ({
          ask: async () => {
            llmCalled = true;
            return { text: '{}' };
          },
          finish: async () => {},
        }),
        close: async () => {},
      };

      const mockRepo: Partial<ContentRepository> = {
        listTextbookLessonSlots: async () =>
          ok([
            {
              documentId: 'doc_ready_01',
              lessonId: 'l1',
              lessonNumber: 1,
              title: '第1课',
              sortOrder: 1,
              kind: 'lesson',
              parentId: null,
              startPage: 1,
              endPage: 5,
              status: 'ready',
              hasPassage: true,
              hasPreview: true,
              hasSummary: true,
            },
          ]),
        commitLessonKnowledge: async () => {
          throw new Error('should not be called');
        },
      };

      const extractor = new LessonBatchExtractor(mockRepo as ContentRepository);
      const summary = await extractor.extractBatch(
        [{ documentId: 'doc_ready_01', lessonId: 'l1', ocrText: '文本' }],
        { pool: mockPool, forceOverwrite: false }
      );

      expect(summary.totalJobs).toBe(1);
      expect(summary.successfulJobs).toBe(1);
      expect(summary.failedJobs).toBe(0);
      expect(llmCalled).toBe(false); // 成功拦截，未消耗大模型算力
    });

    it('原生工具调用优先：当模型通过 tool_call 回填结构化参数时直接入库', async () => {
      const captured: { input?: import('@study-studio/storage-sqlite').CommitLessonKnowledgeInput } = {};
      const mockPool: AgentPoolLike = {
        acquire: async () => ({
          ask: async () => ({
            text: '我已调用工具提交了本课内容。',
            toolCalls: [
              {
                name: 'library.commit_lesson_knowledge',
                input: {
                  title: '第1课 原生工具调用',
                  passageMd: '# 第1课\n这是工具调用回填的课文。',
                  vocabularies: [
                    { surface: '文脈', reading: 'ぶんみゃく', glossZh: '上下文' },
                  ],
                  preview: {
                    keyPoints: ['工具调用强类型约束'],
                  },
                },
              },
            ],
          }),
          finish: async () => {},
        }),
        close: async () => {},
      };

      const mockRepo: Partial<ContentRepository> = {
        commitLessonKnowledge: async (input) => {
          captured.input = input;
          return ok({
            documentId: input.documentId,
            lessonId: input.lessonId,
            stats: {
              vocabCount: 1,
              grammarCount: 0,
              exerciseCount: 0,
              hasPassage: true,
            },
            allLessonsReady: true,
          });
        },
      };

      const extractor = new LessonBatchExtractor(mockRepo as ContentRepository);
      const res = await extractor.extractAndCommitSingleLesson(
        { documentId: 'doc_tool_1', lessonId: 'l1', ocrText: '课文' },
        mockPool
      );

      expect(res.ok).toBe(true);
      expect(captured.input?.title).toBe('第1课 原生工具调用');
      expect(captured.input?.passageMd).toContain('工具调用回填');
      expect(captured.input?.vocabularies?.length).toBe(1);
      expect(captured.input?.previewJson).toContain('工具调用强类型约束');
    });
  });
});
