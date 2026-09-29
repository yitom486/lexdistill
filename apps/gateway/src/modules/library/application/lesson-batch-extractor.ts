import { z } from 'zod';
import { AgentPool } from 'agentpools';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  logger,
} from '@study-studio/shared';
import type {
  ContentRepository,
  CommitLessonKnowledgeInput,
} from '../ports.js';

export interface AgentPoolLease {
  ask(prompt: string | { content: unknown[] }): Promise<{ text: string; stopReason?: string }>;
  finish(): Promise<void>;
}

export interface AgentPoolLike {
  acquire(agentIndex?: number): Promise<AgentPoolLease>;
  close(options?: { drain?: boolean }): Promise<unknown>;
}

export interface LessonExtractionJob {
  documentId: string;
  lessonId: string;
  title?: string | undefined;
  startPage?: number | undefined;
  endPage?: number | undefined;
  ocrText: string;
}

export interface BatchExtractionProgress {
  documentId: string;
  lessonId: string;
  completedCount: number;
  totalCount: number;
  allLessonsReady: boolean;
  stats: {
    vocabCount: number;
    grammarCount: number;
    exerciseCount: number;
    hasPassage: boolean;
  };
}

export interface BatchExtractionOptions {
  poolSize?: number | undefined;
  codexProgram?: string | undefined;
  model?: string | undefined;
  onProgress?: ((progress: BatchExtractionProgress) => void) | undefined;
  pool?: AgentPoolLike | undefined;
}

export interface BatchExtractionSummary {
  documentId: string;
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  allLessonsReady: boolean;
  errors: Array<{ lessonId: string; error: string }>;
}

export const ExtractedLessonSchema = z.object({
  title: z.string().optional(),
  passageMd: z.string().optional(),
  vocabularies: z
    .array(
      z.object({
        surface: z.string().min(1),
        reading: z.string().optional(),
        pos: z.string().optional(),
        glossZh: z.string().optional(),
        pitch: z.string().optional(),
        exampleJa: z.string().optional(),
        exampleZh: z.string().optional(),
      })
    )
    .optional(),
  knowledgePoints: z
    .array(
      z.object({
        title: z.string().min(1),
        connection: z.string().optional(),
        explanation: z.string().optional(),
        examples: z
          .array(
            z.object({
              japanese: z.string(),
              chinese: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  exercises: z
    .array(
      z.object({
        type: z.enum(['CHOICE', 'FILL_BLANK', 'TRANSLATION']),
        prompt: z.string().min(1),
        options: z.array(z.string()).optional(),
        answer: z.string(),
        explanation: z.string().optional(),
      })
    )
    .optional(),
});

export type ExtractedLessonData = z.infer<typeof ExtractedLessonSchema>;

/**
 * 构造面向大模型的章节提炼标准提示词。
 */
export function buildLessonExtractionPrompt(job: LessonExtractionJob): string {
  return [
    '你是一个专业的语言教材数字化与知识提取专家。',
    `请深入分析以下提供的教材章节 OCR 扫描文本（教材ID: ${job.documentId}，课次: ${job.lessonId}${job.title ? `，标题: ${job.title}` : ''}）：`,
    '',
    '【待提炼课文 OCR 文本】：',
    job.ocrText,
    '',
    '请提炼本课核心内容，并严格以合法 JSON 输出，不要输出任何多余的前言、结语或解释。',
    'JSON 结构定义如下：',
    '{',
    '  "title": "精校后的课文标题（可选）",',
    '  "passageMd": "完整排版的精读课文/对话全文 Markdown（带清晰段落结构与注音/排版）",',
    '  "vocabularies": [',
    '    {',
    '      "surface": "生词原形/汉字",',
    '      "reading": "假名/注音/音标",',
    '      "pos": "词性",',
    '      "glossZh": "中文释义",',
    '      "pitch": "声调标注（如 ⓪）",',
    '      "exampleJa": "课文例句",',
    '      "exampleZh": "例句中文翻译"',
    '    }',
    '  ],',
    '  "knowledgePoints": [',
    '    {',
    '      "title": "语法/知识点条目名称",',
    '      "connection": "接续规则说明",',
    '      "explanation": "语法详细讲解与用法注意",',
    '      "examples": [',
    '        {',
    '          "japanese": "例句原句",',
    '          "chinese": "例句中文翻译"',
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "exercises": [',
    '    {',
    '      "type": "CHOICE",',
    '      "prompt": "题目内容",',
    '      "options": ["选项A", "选项B", "选项C"],',
    '      "answer": "正确答案",',
    '      "explanation": "解析"',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

/**
 * 从大模型返回文本中安全提取并解析 JSON。
 */
export function parseLessonExtractionJson(text: string): Result<ExtractedLessonData, BusinessError> {
  let cleaned = text.trim();

  // 1. 去除 Markdown 代码块标记（如 ```json ... ```）
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(cleaned);
  if (codeBlockMatch?.[1]) {
    cleaned = codeBlockMatch[1].trim();
  } else {
    // 2. 兜底寻找最外层的 `{ ... }`
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(cleaned);
  } catch (cause) {
    return err(
      new BusinessError(
        'E_LLM_JSON_PARSE_FAILED',
        `大模型返回的内容无法解析为 JSON: ${String(cause)}`,
        'VALIDATION',
        true
      )
    );
  }

  const parsed = ExtractedLessonSchema.safeParse(rawJson);
  if (!parsed.success) {
    return err(
      new BusinessError(
        'E_LLM_SCHEMA_INVALID',
        `大模型提炼的结构不符合规范: ${parsed.error.message}`,
        'VALIDATION',
        true
      )
    );
  }

  return ok(parsed.data);
}

/**
 * 创建生产环境默认 AgentPool 实例。
 */
export function createDefaultAgentPool(options: {
  poolSize?: number | undefined;
  program?: string | undefined;
  model?: string | undefined;
}): AgentPoolLike {
  const poolSize = options.poolSize ?? 3;
  const program = options.program ?? process.env.STUDY_STUDIO_CODEX_PATH ?? 'codex';
  const agents = Array.from({ length: poolSize }, () => ({
    runtime: 'codexAppServer' as const,
    program,
    args: ['app-server'],
    cwd: process.cwd(),
    ...(options.model ? { model: options.model } : {}),
  }));

  return new AgentPool({
    apiVersion: 2,
    agents,
    maxQueued: 64,
  });
}

/**
 * 章节并发提炼与回填批处理执行器（依托 agentpools 独占租用与内置重试）：
 * 1. 依托 AgentPool 进行 Worker 独占租用与长连接复用；
 * 2. 自动限制并发度，避免并发过载；
 * 3. 提炼结果经白名单核验原子落库，并将对应槽位状态翻转为 ready；
 * 4. 实时向上层推送提炼进度。
 */
export class LessonBatchExtractor {
  constructor(private readonly repo: ContentRepository) {}

  public async extractAndCommitSingleLesson(
    job: LessonExtractionJob,
    pool: AgentPoolLike
  ): Promise<Result<{ allLessonsReady: boolean; stats: BatchExtractionProgress['stats'] }, BusinessError>> {
    const prompt = buildLessonExtractionPrompt(job);

    let lease: AgentPoolLease | null = null;
    let responseText = '';

    try {
      lease = await pool.acquire();
      const response = await lease.ask(prompt);
      responseText = response.text;
    } catch (cause) {
      return err(
        translateToBusinessError(cause, {
          category: 'AGENT_RUNTIME',
          fallbackMessage: `租借 Worker 提炼课次 "${job.lessonId}" 失败`,
        })
      );
    } finally {
      if (lease) {
        try {
          await lease.finish();
        } catch (e) {
          logger.warn('[LessonBatchExtractor] lease finish error:', { error: String(e) });
        }
      }
    }

    const parsedResult = parseLessonExtractionJson(responseText);
    if (!parsedResult.ok) {
      return parsedResult;
    }

    const extracted = parsedResult.value;
    const commitInput: CommitLessonKnowledgeInput = {
      documentId: job.documentId,
      lessonId: job.lessonId,
      ...(extracted.title ? { title: extracted.title } : {}),
      ...(extracted.passageMd ? { passageMd: extracted.passageMd } : {}),
      ...(extracted.vocabularies ? { vocabularies: extracted.vocabularies } : {}),
      ...(extracted.knowledgePoints ? { knowledgePoints: extracted.knowledgePoints } : {}),
      ...(extracted.exercises ? { exercises: extracted.exercises } : {}),
    };

    const commitResult = await this.repo.commitLessonKnowledge(commitInput);
    if (!commitResult.ok) {
      return commitResult;
    }

    return ok({
      allLessonsReady: commitResult.value.allLessonsReady,
      stats: commitResult.value.stats,
    });
  }

  public async extractBatch(
    jobs: LessonExtractionJob[],
    options: BatchExtractionOptions = {}
  ): Promise<BatchExtractionSummary> {
    if (jobs.length === 0) {
      return {
        documentId: '',
        totalJobs: 0,
        successfulJobs: 0,
        failedJobs: 0,
        allLessonsReady: true,
        errors: [],
      };
    }

    const documentId = jobs[0]!.documentId;
    const shouldClosePool = !options.pool;
    const pool =
      options.pool ??
      createDefaultAgentPool({
        poolSize: options.poolSize,
        program: options.codexProgram,
        model: options.model,
      });

    let completedCount = 0;
    let successfulJobs = 0;
    let failedJobs = 0;
    let finalAllLessonsReady = false;
    const errors: Array<{ lessonId: string; error: string }> = [];

    try {
      await Promise.all(
        jobs.map(async (job) => {
          const result = await this.extractAndCommitSingleLesson(job, pool);
          completedCount += 1;

          if (result.ok) {
            successfulJobs += 1;
            finalAllLessonsReady = result.value.allLessonsReady;
            options.onProgress?.({
              documentId: job.documentId,
              lessonId: job.lessonId,
              completedCount,
              totalCount: jobs.length,
              allLessonsReady: result.value.allLessonsReady,
              stats: result.value.stats,
            });
          } else {
            failedJobs += 1;
            errors.push({
              lessonId: job.lessonId,
              error: result.error.userMessage,
            });
            logger.warn(`[LessonBatchExtractor] 课次 "${job.lessonId}" 提炼失败:`, {
              error: result.error.userMessage,
            });
          }
        })
      );
    } finally {
      if (shouldClosePool) {
        try {
          await pool.close({ drain: true });
        } catch (e) {
          logger.warn('[LessonBatchExtractor] pool close error:', { error: String(e) });
        }
      }
    }

    return {
      documentId,
      totalJobs: jobs.length,
      successfulJobs,
      failedJobs,
      allLessonsReady: finalAllLessonsReady,
      errors,
    };
  }
}
