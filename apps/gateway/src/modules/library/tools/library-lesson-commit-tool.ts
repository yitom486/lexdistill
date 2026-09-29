import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, type Result, BusinessError } from '@study-studio/shared';
import type { ContentRepository } from '../ports.js';

export const LibraryLessonCommitInputSchema = z.object({
  documentId: z.string().min(1).describe('所属教材文档ID'),
  lessonId: z.string().min(1).describe('目标课次槽位ID（必须为已落库目录中存在的槽位ID，如 l1, l2）'),
  title: z.string().optional().describe('大模型精校后的课文标题（可选）'),
  passageMd: z.string().optional().describe('该课完整精读课文/对话全文 Markdown（排版规整，带段落对照与发音）'),
  vocabularies: z
    .array(
      z.object({
        surface: z.string().min(1).describe('生词词面，如汉字/单词原形'),
        reading: z.string().optional().describe('注音/假名/音标'),
        pos: z.string().optional().describe('词性（如 名词、動詞1类 等）'),
        glossZh: z.string().optional().describe('中文释义'),
        pitch: z.string().optional().describe('声调/音调标注，如 ⓪'),
        exampleJa: z.string().optional().describe('课文原语例句'),
        exampleZh: z.string().optional().describe('例句中文翻译'),
      })
    )
    .optional()
    .describe('本课提炼出的核心生词列表'),
  knowledgePoints: z
    .array(
      z.object({
        title: z.string().min(1).describe('语法条目或知识点句型名称，如 ～てから'),
        connection: z.string().optional().describe('接续规则说明'),
        explanation: z.string().optional().describe('语法解析与用法注意'),
        examples: z
          .array(
            z.object({
              japanese: z.string().describe('原语句子'),
              chinese: z.string().optional().describe('中文译文'),
            })
          )
          .optional()
          .describe('语法高质量例句列表'),
      })
    )
    .optional()
    .describe('本课提炼出的核心语法与知识点列表'),
  exercises: z
    .array(
      z.object({
        type: z.enum(['CHOICE', 'FILL_BLANK', 'TRANSLATION']).describe('题型'),
        prompt: z.string().min(1).describe('题干'),
        options: z.array(z.string()).optional().describe('选项数组（CHOICE 必填）'),
        answer: z.string().describe('标准答案'),
        explanation: z.string().optional().describe('答案解析'),
      })
    )
    .optional()
    .describe('课后习题列表'),
  preview: z
    .object({
      keyPoints: z.array(z.string()).optional().describe('本课核心掌握要点清单'),
      pitfalls: z.array(z.string()).optional().describe('易错与难点预警'),
      canDoGoal: z.string().optional().describe('学完本课后的实际语言应用目标（Can-do）'),
    })
    .optional()
    .describe('课前预习导学卡片'),
  summary: z
    .object({
      goldenSentences: z.array(z.string()).optional().describe('本课必须掌握的黄金核心句'),
      selfCheckQuestions: z.array(z.string()).optional().describe('课后自测检验问题清单'),
    })
    .optional()
    .describe('课后总结自测卡片'),
});

export type LibraryLessonCommitInput = z.infer<typeof LibraryLessonCommitInputSchema>;

export interface LibraryLessonCommitOutput {
  success: boolean;
  documentId: string;
  lessonId: string;
  stats: {
    vocabCount: number;
    grammarCount: number;
    exerciseCount: number;
    hasPassage: boolean;
  };
  allLessonsReady: boolean;
  message: string;
}

/**
 * 章节内容提炼原子回填工具（Native Server Tool）：
 * - 大模型在并发提炼某课 OCR 文本后调用本工具回填；
 * - 强制执行目录白名单核验（E_TOC_SLOT_NOT_FOUND），脱离已建目录凭空造课直接拦截；
 * - 校验通过后，原子更新课文槽位为 ready，并将生词、语法、短文一体化落库；
 * - 返回全书各课完成进度与当前课回填统计。
 */
export class LibraryLessonCommitTool implements ToolDefinition<LibraryLessonCommitInput, LibraryLessonCommitOutput> {
  public readonly name = 'library.commit_lesson_knowledge';
  public readonly description =
    '大模型提炼某一课的 OCR 文本后调用本工具回填生词、语法、课后习题与精读课文短文 Markdown。本工具强制校验该 lessonId 是否存在于已建立的目录中，通过后原子落库并将槽位状态翻转为 ready。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = LibraryLessonCommitInputSchema;

  constructor(private readonly repo: ContentRepository) {}

  public async execute(
    input: LibraryLessonCommitInput,
    _context: ToolExecutionContext
  ): Promise<Result<LibraryLessonCommitOutput, BusinessError>> {
    void _context;

    const result = await this.repo.commitLessonKnowledge({
      documentId: input.documentId,
      lessonId: input.lessonId,
      ...(input.title ? { title: input.title } : {}),
      ...(input.passageMd ? { passageMd: input.passageMd } : {}),
      ...(input.preview ? { previewJson: JSON.stringify(input.preview) } : {}),
      ...(input.summary ? { summaryJson: JSON.stringify(input.summary) } : {}),
      ...(input.vocabularies ? { vocabularies: input.vocabularies } : {}),
      ...(input.knowledgePoints ? { knowledgePoints: input.knowledgePoints } : {}),
      ...(input.exercises ? { exercises: input.exercises } : {}),
    });

    if (!result.ok) {
      return result;
    }

    const { stats, allLessonsReady } = result.value;
    const progressNotice = allLessonsReady
      ? '🎉 全书所有章节已全部提炼完成！'
      : '本课回填成功，其余章节提炼仍在进行中。';

    return ok({
      success: true,
      documentId: result.value.documentId,
      lessonId: result.value.lessonId,
      stats,
      allLessonsReady,
      message: `课次 "${result.value.lessonId}" 回填成功！录入生词 ${stats.vocabCount} 条、语法 ${stats.grammarCount} 条、习题 ${stats.exerciseCount} 道${stats.hasPassage ? '，精读课文已就绪' : ''}。${progressNotice}`,
    });
  }
}
