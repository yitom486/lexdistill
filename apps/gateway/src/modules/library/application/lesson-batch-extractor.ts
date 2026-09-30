import { z } from 'zod';
import { AgentPool } from 'agentpools';
import { resolveCodexBinary } from '@study-studio/agent-runtime/src/adapters/codex/index.js';
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
  ask(prompt: string | { content: unknown[] }): Promise<{
    text: string;
    stopReason?: string;
    toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  }>;
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
  /** 本课在目录中已知的子条目（微观白名单） */
  subSections?: string[] | undefined;
  ocrText: string;
}

export interface BatchExtractionProgress {
  documentId: string;
  lessonId: string;
  completedCount: number;
  totalCount: number;
  allLessonsReady: boolean;
  successfulCount?: number;
  error?: string;
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
  effort?: string | undefined;
  /** 是否强制重新提炼全书（默认 false：若已为 ready 则直接跳过以保全复习记录并节约算力） */
  forceOverwrite?: boolean | undefined;
  onProgress?: ((progress: BatchExtractionProgress) => void) | undefined;
  pool?: AgentPoolLike | undefined;
  poolFactory?: typeof createDefaultAgentPool | undefined;
  signal?: AbortSignal | undefined;
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
  preview: z
    .object({
      keyPoints: z.array(z.string()).optional(),
      pitfalls: z.array(z.string()).optional(),
      canDoGoal: z.string().optional(),
    })
    .optional(),
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
  summary: z
    .object({
      goldenSentences: z.array(z.string()).optional(),
      selfCheckQuestions: z.array(z.string()).optional(),
    })
    .optional(),
}).refine((data) => Boolean(data.passageMd?.trim() || data.vocabularies?.length || data.knowledgePoints?.length || data.exercises?.length), {
  message: '必须包含实际教材内容',
});

export type ExtractedLessonData = z.infer<typeof ExtractedLessonSchema>;

import { buildLessonExtractionPrompt } from './prompts/index.js';
export { buildLessonExtractionPrompt };

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
    logger.warn('[LessonBatchExtractor] 大模型返回文本 JSON 解析失败', {
      error: String(cause),
      snippet: cleaned.slice(0, 150),
    });
    return err(
      new BusinessError(
        'E_LLM_JSON_PARSE_FAILED',
        '大模型返回的内容无法解析为 JSON，建议重试本课',
        'VALIDATION',
        true
      )
    );
  }

  const parsed = ExtractedLessonSchema.safeParse(rawJson);
  if (!parsed.success) {
    logger.warn('[LessonBatchExtractor] 大模型返回 JSON Schema 校验失败', {
      issues: parsed.error.issues,
    });
    return err(
      new BusinessError(
        'E_LLM_SCHEMA_INVALID',
        '大模型提炼的结构不符合规范，建议重试本课',
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
  effort?: string | undefined;
}): AgentPoolLike {
  const poolSize = options.poolSize ?? 3;
  const program = resolveCodexBinary(options.program ?? process.env.STUDY_STUDIO_CODEX_PATH);
  const agents = Array.from({ length: poolSize }, () => ({
    runtime: 'codexAppServer' as const,
    program,
    args: ['app-server', ...(options.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(options.effort)}`] : [])],
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
    pool: AgentPoolLike,
    signal?: AbortSignal
  ): Promise<Result<{ allLessonsReady: boolean; stats: BatchExtractionProgress['stats'] }, BusinessError>> {
    if (!job.ocrText.trim()) {
      return err(new BusinessError('E_LLM_SCHEMA_INVALID', '本课页面未提取到文字，请核对页码或 OCR 结果后重试', 'VALIDATION', true));
    }
    const prompt = buildLessonExtractionPrompt(job);

    let lease: AgentPoolLease | null = null;
    let responseText = '';
    let responseToolCalls: Array<{ name: string; input: Record<string, unknown> }> | undefined;

    try {
      lease = await pool.acquire();
      const response = await lease.ask(prompt);
      responseText = response.text;
      responseToolCalls = response.toolCalls;
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

    if (signal?.aborted) return err(new BusinessError('E_CANCELLED', '教材提取已中止，已保存内容保留', 'AGENT_RUNTIME'));

    let extracted: ExtractedLessonData;

    // 1. 原生工具调用优先：若底层 Agent/Worker 通过 tool_call 回填了结构化参数
    const toolCall = responseToolCalls?.find(
      (tc) =>
        tc.name === 'library.commit_lesson_knowledge' ||
        tc.name === 'library_commit_lesson_knowledge'
    );

    if (toolCall) {
      logger.info(`[LessonBatchExtractor] 课次 "${job.lessonId}" 命中原生工具调用回填 (${toolCall.name})`);
      const parsedToolInput = ExtractedLessonSchema.safeParse(toolCall.input);
      if (!parsedToolInput.success) {
        logger.warn('[LessonBatchExtractor] 工具调用参数 Schema 校验失败', {
          lessonId: job.lessonId,
          issues: parsedToolInput.error.issues,
        });
        return err(
          new BusinessError(
            'E_LLM_SCHEMA_INVALID',
            '大模型提炼的结构不符合规范（工具调用参数非法），建议重试本课',
            'VALIDATION',
            true
          )
        );
      }
      extracted = parsedToolInput.data;
    } else {
      // 2. 文本解析兜底：处理标准或代码块包裹的 JSON 字符串
      logger.info(`[LessonBatchExtractor] 课次 "${job.lessonId}" 未检测到工具调用，采用文本 JSON 解析兜底`);
      const parsedResult = parseLessonExtractionJson(responseText);
      if (!parsedResult.ok) {
        return parsedResult;
      }
      extracted = parsedResult.value;
    }
    const commitInput: CommitLessonKnowledgeInput = {
      documentId: job.documentId,
      lessonId: job.lessonId,
      ...(extracted.passageMd ? { passageMd: extracted.passageMd } : {}),
      ...(extracted.preview ? { previewJson: JSON.stringify(extracted.preview) } : {}),
      ...(extracted.summary ? { summaryJson: JSON.stringify(extracted.summary) } : {}),
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

    let completedCount = 0;
    let successfulJobs = 0;
    let failedJobs = 0;
    let finalAllLessonsReady = false;
    const errors: Array<{ lessonId: string; error: string }> = [];

    // 0. 幂等性检查：若非强制覆盖，查询已入库就绪槽位，跳过无谓的 LLM 调用（省算力防覆盖）
    const existingStats = await this.repo.getTextbookAssetStats(documentId);
    if (!existingStats.ok) return {
      documentId, totalJobs: jobs.length, successfulJobs: 0, failedJobs: jobs.length, allLessonsReady: false,
      errors: jobs.map((job) => ({ lessonId: job.lessonId, error: existingStats.error.userMessage })),
    };
    const existingLessons = new Map(existingStats.value.lessonDetails.map((lesson) => [lesson.lessonId, lesson]));
    const readyLessonIds = new Set(options.forceOverwrite ? [] : existingStats.value.lessonDetails
      .filter((lesson) => lesson.status === 'ready').map((lesson) => lesson.lessonId));

    const pendingJobs: LessonExtractionJob[] = [];
    for (const job of jobs) {
      if (readyLessonIds.has(job.lessonId)) {
        completedCount += 1;
        successfulJobs += 1;
        logger.info(`[LessonBatchExtractor] 课次 "${job.lessonId}" 已就绪，默认跳过提炼 (idempotent skip)`);
        options.onProgress?.({
          documentId: job.documentId,
          lessonId: job.lessonId,
          completedCount,
          successfulCount: successfulJobs,
          totalCount: jobs.length,
          allLessonsReady: false,
          stats: {
            vocabCount: existingLessons.get(job.lessonId)?.vocabCount ?? 0,
            grammarCount: existingLessons.get(job.lessonId)?.grammarCount ?? 0,
            exerciseCount: existingLessons.get(job.lessonId)?.exerciseCount ?? 0,
            hasPassage: existingLessons.get(job.lessonId)?.hasPassage ?? false,
          },
        });
      } else {
        pendingJobs.push(job);
      }
    }

    logger.info('[LessonBatchExtractor] 开始执行章节批处理提取', {
      documentId,
      totalJobs: jobs.length,
      pendingJobs: pendingJobs.length,
      skippedReady: readyLessonIds.size,
    });

    if (pendingJobs.length === 0) {
      const stats = await this.repo.getTextbookAssetStats(documentId);
      return {
        documentId,
        totalJobs: jobs.length,
        successfulJobs,
        failedJobs: 0,
        allLessonsReady: stats.ok && stats.value.lessons > 0 && stats.value.readyLessons === stats.value.lessons,
        errors: [],
      };
    }

    const shouldClosePool = !options.pool;
    const pool =
      options.pool ??
      (options.poolFactory ?? createDefaultAgentPool)({
        poolSize: options.poolSize,
        program: options.codexProgram,
        model: options.model,
        effort: options.effort,
      });

    try {
      let nextJob = 0;
      const runWorker = async () => {
        while (nextJob < pendingJobs.length) {
          const job = pendingJobs[nextJob++];
          if (!job) return;
          if (options.signal?.aborted) return;
          const result = await this.extractAndCommitSingleLesson(job, pool, options.signal);
          if (options.signal?.aborted) return;
          completedCount += 1;

          if (result.ok) {
            successfulJobs += 1;
            finalAllLessonsReady = result.value.allLessonsReady;
            logger.info(`[LessonBatchExtractor] 课次 "${job.lessonId}" 提炼并原子落库成功`, {
              documentId: job.documentId,
              allLessonsReady: result.value.allLessonsReady,
              stats: result.value.stats,
            });
            options.onProgress?.({
              documentId: job.documentId,
              lessonId: job.lessonId,
              completedCount,
              successfulCount: successfulJobs,
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
            options.onProgress?.({
              documentId: job.documentId, lessonId: job.lessonId, completedCount,
              successfulCount: successfulJobs, totalCount: jobs.length, allLessonsReady: false,
              error: result.error.userMessage,
              stats: { vocabCount: 0, grammarCount: 0, exerciseCount: 0, hasPassage: false },
            });
            logger.warn(`[LessonBatchExtractor] 课次 "${job.lessonId}" 提炼失败`, {
              documentId: job.documentId,
              code: result.error.code,
              error: result.error.userMessage,
            });
          }
        }
      };
      const workers = Math.min(pendingJobs.length, Math.max(1, options.poolSize ?? 3));
      await Promise.all(Array.from({ length: workers }, runWorker));
    } finally {
      if (shouldClosePool) {
        try {
          await pool.close({ drain: true });
        } catch (e) {
          logger.warn('[LessonBatchExtractor] pool close error:', { error: String(e) });
        }
      }
    }

    const finalStats = await this.repo.getTextbookAssetStats(documentId);
    finalAllLessonsReady = finalStats.ok && finalStats.value.lessons > 0 &&
      finalStats.value.readyLessons === finalStats.value.lessons;
    logger.info('[LessonBatchExtractor] 批处理提炼结束', {
      documentId,
      totalJobs: jobs.length,
      successfulJobs,
      failedJobs,
      allLessonsReady: finalAllLessonsReady,
    });

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
