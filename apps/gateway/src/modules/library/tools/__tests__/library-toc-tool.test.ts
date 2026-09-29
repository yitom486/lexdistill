import { describe, expect, it } from 'bun:test';
import { ok, err, isOk, BusinessError } from '@study-studio/shared';
import { LibrarySubmitTocTool } from '../library-toc-tool.js';
import type { ContentRepository } from '../../ports.js';
import type { ToolExecutionContext } from '@study-studio/tool-core';

const dummyContext: ToolExecutionContext = {
  userId: 'user_01',
  sessionId: 'sess_01',
};

describe('LibrarySubmitTocTool', () => {
  it('合规递增目录：工具调用成功并返回槽位就绪信息', async () => {
    let capturedInput: unknown = null;
    const mockRepo: Partial<ContentRepository> = {
      seedTextbookTocSkeleton: async (input) => {
        capturedInput = input;
        return ok({
          documentId: input.documentId,
          title: input.title,
          lessonCount: 2,
          totalEntries: 3,
          minPage: 1,
          maxPage: 25,
        });
      },
    };

    const tool = new LibrarySubmitTocTool(mockRepo as ContentRepository);
    const result = await tool.execute(
      {
        documentId: 'doc_tb_101',
        userId: 'user_01',
        title: '新标日初级上册',
        language: 'ja',
        entries: [
          { id: 'u1', level: 'unit', title: '第1单元 基本交流', startPage: 1 },
          { id: 'l1', level: 'lesson', title: '第1课 小野是日本人', startPage: 5, endPage: 14, parentId: 'u1' },
          { id: 'l2', level: 'lesson', title: '第2课 这是我的书', startPage: 15, endPage: 25, parentId: 'u1' },
        ],
      },
      dummyContext
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.success).toBe(true);
      expect(result.value.lessonCount).toBe(2);
      expect(result.value.totalEntries).toBe(3);
      expect(result.value.minPage).toBe(1);
      expect(result.value.maxPage).toBe(25);
      expect(result.value.message).toContain('目录成功落库');
    }
    expect(capturedInput).not.toBeNull();
  });

  it('仓储校验拦截（页码倒退）：工具透传业务错误', async () => {
    const mockRepo: Partial<ContentRepository> = {
      seedTextbookTocSkeleton: async () => {
        return err(new BusinessError('E_TOC_PAGE_ORDER_INVALID', '目录页码未单调递增', 'VALIDATION', false));
      },
    };

    const tool = new LibrarySubmitTocTool(mockRepo as ContentRepository);
    const result = await tool.execute(
      {
        documentId: 'doc_tb_102',
        userId: 'user_01',
        title: '倒退教材',
        language: 'ja',
        entries: [
          { id: 'l1', level: 'lesson', title: '第1课', startPage: 20 },
          { id: 'l2', level: 'lesson', title: '第2课', startPage: 10 },
        ],
      },
      dummyContext
    );

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('E_TOC_PAGE_ORDER_INVALID');
      expect(result.error.userMessage).toContain('目录页码未单调递增');
    }
  });

  it('Schema 校验拦截：非法的枚举 level 被 Zod 拦截', () => {
    const mockRepo: Partial<ContentRepository> = {};
    const tool = new LibrarySubmitTocTool(mockRepo as ContentRepository);

    const parseResult = tool.schema.safeParse({
      documentId: 'doc_tb_103',
      userId: 'user_01',
      title: '非法教材',
      entries: [
        { id: 'l1', level: 'unknown_level', title: '第1课', startPage: 1 },
      ],
    });

    expect(parseResult.success).toBe(false);
  });
});
