import { describe, expect, it } from 'bun:test';
import { ok, err, isOk, BusinessError } from '@study-studio/shared';
import { LibraryLessonCommitTool } from '../library-lesson-commit-tool.js';
import type { ContentRepository } from '../../ports.js';
import type { ToolExecutionContext } from '@study-studio/tool-core';

const dummyContext: ToolExecutionContext = {
  userId: 'user_01',
  sessionId: 'sess_01',
};

describe('LibraryLessonCommitTool', () => {
  it('回填合规内容：大模型提炼知识点调用成功并返回统计与进度', async () => {
    let capturedInput: unknown = null;
    const mockRepo: Partial<ContentRepository> = {
      commitLessonKnowledge: async (input) => {
        capturedInput = input;
        return ok({
          documentId: input.documentId,
          lessonId: input.lessonId,
          stats: {
            vocabCount: 2,
            grammarCount: 1,
            exerciseCount: 1,
            hasPassage: true,
          },
          allLessonsReady: true,
        });
      },
    };

    const tool = new LibraryLessonCommitTool(mockRepo as ContentRepository);
    const result = await tool.execute(
      {
        documentId: 'doc_tb_01',
        lessonId: 'l1',
        title: '第1课 小野是日本人',
        passageMd: '# 第1课\n小野さんは日本人です。',
        vocabularies: [
          { surface: '小野', reading: 'おの', pos: '名词', glossZh: '小野（姓氏）' },
          { surface: '日本人', reading: 'にほんじん', pos: '名词', glossZh: '日本人' },
        ],
        knowledgePoints: [
          {
            title: '～は～です',
            explanation: '判断句结构',
            examples: [{ japanese: '私は学生です。', chinese: '我是学生。' }],
          },
        ],
        exercises: [
          {
            type: 'CHOICE',
            prompt: '李さんは中国人___。',
            options: ['です', 'ます', 'でした'],
            answer: 'です',
            explanation: '肯定判断句用です',
          },
        ],
        preview: {
          keyPoints: ['掌握敬体与简体'],
          pitfalls: ['助词错位'],
          canDoGoal: '自我介绍',
        },
        summary: {
          goldenSentences: ['手を洗ってから、ご飯を食べます。'],
          selfCheckQuestions: ['能分清动词变形吗？'],
        },
      },
      dummyContext
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.success).toBe(true);
      expect(result.value.documentId).toBe('doc_tb_01');
      expect(result.value.lessonId).toBe('l1');
      expect(result.value.stats.vocabCount).toBe(2);
      expect(result.value.stats.grammarCount).toBe(1);
      expect(result.value.stats.exerciseCount).toBe(1);
      expect(result.value.stats.hasPassage).toBe(true);
      expect(result.value.allLessonsReady).toBe(true);
      expect(result.value.message).toContain('全书所有章节已全部提炼完成');
    }
    expect(capturedInput).not.toBeNull();
    const captured = capturedInput as { previewJson?: string; summaryJson?: string };
    expect(captured.previewJson).toContain('掌握敬体与简体');
    expect(captured.summaryJson).toContain('手を洗ってから');
  });

  it('白名单拦截：脱离预置目录造课（E_TOC_SLOT_NOT_FOUND）时正确拦截并透传业务错误', async () => {
    const mockRepo: Partial<ContentRepository> = {
      commitLessonKnowledge: async (input) => {
        return err(
          new BusinessError(
            'E_TOC_SLOT_NOT_FOUND',
            `章节槽位 "${input.lessonId}" 不存在于教材 "${input.documentId}" 的预置目录中，请确认目录已优先建立且课次ID完全对齐`,
            'VALIDATION',
            false
          )
        );
      },
    };

    const tool = new LibraryLessonCommitTool(mockRepo as ContentRepository);
    const result = await tool.execute(
      {
        documentId: 'doc_tb_01',
        lessonId: 'l999',
        passageMd: '凭空捏造的第999课',
      },
      dummyContext
    );

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('E_TOC_SLOT_NOT_FOUND');
      expect(result.error.userMessage).toContain('章节槽位 "l999" 不存在');
    }
  });

  it('Schema 校验：非法的习题类型被 Zod 拦截', () => {
    const mockRepo: Partial<ContentRepository> = {};
    const tool = new LibraryLessonCommitTool(mockRepo as ContentRepository);

    const parseResult = tool.schema.safeParse({
      documentId: 'doc_tb_01',
      lessonId: 'l1',
      exercises: [
        {
          type: 'INVALID_TYPE',
          prompt: '题目',
          answer: '答案',
        },
      ],
    });

    expect(parseResult.success).toBe(false);
  });
});
