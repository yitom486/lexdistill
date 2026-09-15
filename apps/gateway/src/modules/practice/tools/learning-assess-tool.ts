import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  extractErrorText,
  generateId,
  translateToBusinessError,
} from '@study-studio/shared';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { AgentAdapter } from '@study-studio/agent-runtime';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { artifactInputHash } from '@study-studio/storage-sqlite';
import { logger } from '@study-studio/shared';

export const LearningAssessInputSchema = z.object({
  action: z.enum(['grade', 'diagnose', 'grade_batch']).optional(),
  questionId: z.string().optional(),
  prompt: z.string().optional(),
  standardAnswer: z.string().optional(),
  userSubmission: z.string().optional(),
  testedSkillId: z.string().optional(),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  /**
   * P6-3：评测模式（默认 rule，零模型成本，向后兼容）。
   * 'ai' 经 AgentAdapter 请求模型（提交动作显式触发）；模型不可用/输出不可解析时
   * 自动回退规则引擎并标记 source='rule-fallback'，永不阻塞提交、不伪造分数。
   */
  mode: z.enum(['rule', 'ai']).optional(),
  // grade_batch：按 itemId 对齐的批量评测输入
  items: z
    .array(
      z.object({
        itemId: z.string(),
        prompt: z.string(),
        standardAnswer: z.string(),
        userSubmission: z.string(),
        testedSkillId: z.string().optional(),
        language: z.enum(['ja', 'en', 'ko']).optional(),
      })
    )
    .optional(),
});

export type LearningAssessInput = z.infer<typeof LearningAssessInputSchema>;

export interface LearningAssessOutput {
  isCorrect: boolean;
  score: number; // 0–100
  accuracyRate: number; // 0–1.0
  grammarFeedback: string;
  nativeNuanceAdvice: string;
  refinementSuggestion: string;
  mistakeDetected: boolean;
  negativeTransferTag?: string | undefined;
  /** P6-3：结论来源（ai=模型；rule=规则引擎；rule-fallback=模型失败回退） */
  source?: 'rule' | 'ai' | 'rule-fallback' | undefined;
}

/** P6-3：模型批改 JSON 的运行时校验（非法/缺字段即回退规则；score 范围由代码钳制）。 */
export const AiGradingJsonSchema = z.object({
  /** 批量模式下回传对齐用；单题模式忽略 */
  itemId: z.string().optional(),
  isCorrect: z.boolean(),
  score: z.number(),
  grammarFeedback: z.string().min(1),
  nativeNuanceAdvice: z.string().min(1),
  refinementSuggestion: z.string().min(1),
  mistakeDetected: z.boolean().optional(),
  negativeTransferTag: z.string().optional(),
});
export type AiGradingJson = z.infer<typeof AiGradingJsonSchema>;

export interface LearningAssessBatchOutput {
  results: Array<{ itemId: string; grading: LearningAssessOutput }>;
  summary: {
    total: number;
    correct: number;
    averageScore: number;
    commonIssues: string[];
  };
}

export class LearningAssessTool
  implements ToolDefinition<LearningAssessInput, LearningAssessOutput | LearningAssessBatchOutput>
{
  public readonly name = 'learning.assess';
  public readonly description =
    '智能评测与诊断引擎：对客观题或主观造句/翻译进行多维语法诊断、母语负迁移分析与地道润色建议。支持 grade_batch 批量评测，输出按 itemId 对齐的结构化结果与共性问题总结。mode=ai 时经模型批改（失败自动回退规则，默认 rule 零成本）。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = LearningAssessInputSchema;

  /**
   * @param adapter 可选的模型适配器（AgentAdapter 接口，不绑定具体厂商）。
   * 未注入时 mode=ai 自动回退规则引擎；注册链由装配根传入 server 的 adapter。
   */
  constructor(
    private readonly learnerRepo: LearnerRepository,
    private readonly adapter?: AgentAdapter | undefined
  ) {}

  public async execute(
    input: LearningAssessInput,
    context: ToolExecutionContext
  ): Promise<Result<LearningAssessOutput | LearningAssessBatchOutput, BusinessError>> {
    try {
      const action = input.action ?? 'grade';

      if (action === 'grade_batch') {
        return this.gradeBatch(input, context);
      }

      if (!input.prompt || !input.standardAnswer || !input.userSubmission) {
        return err(new BusinessError('E_INVALID_INPUT', '评测需要 prompt/standardAnswer/userSubmission', 'VALIDATION'));
      }
      const params = {
        prompt: input.prompt,
        standardAnswer: input.standardAnswer,
        userSubmission: input.userSubmission,
        testedSkillId: input.testedSkillId ?? 'general',
        language: input.language ?? 'ja',
      };
      if (input.mode === 'ai') {
        return await this.gradeOneWithAiFallback(params, context);
      }
      return ok({ ...this.gradeOne(params), source: 'rule' as const });
    } catch (e) {
      return err(
        new BusinessError(
          'E_TOOL_EXECUTION',
          `评测诊断失败: ${extractErrorText(e) || '未知错误'}`,
          'TOOL_EXECUTION'
        )
      );
    }
  }

  private gradeOne(params: {
    prompt: string;
    standardAnswer: string;
    userSubmission: string;
    testedSkillId: string;
    language: 'en' | 'ja' | 'ko';
  }): LearningAssessOutput {
    const { language } = params;
    const cleanSub = params.userSubmission.trim();
    const cleanStd = params.standardAnswer.trim();

    // 精确匹配
    if (cleanSub === cleanStd) {
      return {
        isCorrect: true,
        score: 100,
        accuracyRate: 1.0,
        grammarFeedback: '完全契合标准范例，句式结构与用词规范严谨。',
        nativeNuanceAdvice: '表达地道自然，用词与语境调性高度吻合。',
        refinementSuggestion: cleanStd,
        mistakeDetected: false,
      };
    }

    // 母语负迁移与语法诊断规则
    let negativeTransferTag: string | undefined;
    let grammarFeedback = '整体语义通顺，但助词或动词接续与母语思维有所偏差。';
    let nativeNuanceAdvice = '建议遵循日语“名词 + 格助词 + 谓语”的标准语序节奏。';
    let score = 75;

    if (language === 'ja') {
      if (cleanSub.includes('で') && cleanStd.includes('に')) {
        negativeTransferTag = 'ZH_TRANSFER_LOCATION_DE_INSTEAD_OF_NI';
        grammarFeedback = '检测到母语负迁移：中文“在”常被习惯性映射为「で」，但在静态存在句中必须用「に」。';
        nativeNuanceAdvice = '请牢记：“静态落脚用 に，动态发力才用 で”。';
        score = 55;
      } else if (cleanSub.includes('に') && cleanStd.includes('で')) {
        negativeTransferTag = 'PARTICLE_NI_INSTEAD_OF_DE';
        grammarFeedback = '助词选择偏差：动作行为发生地需要格助词「で」，「に」用于归着点。';
        score = 60;
      } else {
        score = Math.max(50, Math.min(90, Math.round((cleanSub.length / cleanStd.length) * 80)));
      }
    } else {
      // 非日语：按长度比给一个保守分，避免宣称日语专属规则适用于英/韩
      score = Math.max(50, Math.min(90, Math.round((cleanSub.length / Math.max(1, cleanStd.length)) * 80)));
    }

    const isCorrect = score >= 80;

    return {
      isCorrect,
      score,
      accuracyRate: Number((score / 100).toFixed(2)),
      grammarFeedback,
      nativeNuanceAdvice,
      refinementSuggestion: cleanStd,
      mistakeDetected: !isCorrect,
      negativeTransferTag,
    };
  }

  private gradeBatch(
    input: LearningAssessInput,
    context: ToolExecutionContext
  ): Promise<Result<LearningAssessBatchOutput, BusinessError>> | Result<LearningAssessBatchOutput, BusinessError> {
    if (!input.items || input.items.length === 0) {
      return err(new BusinessError('E_INVALID_INPUT', 'grade_batch 需要 items', 'VALIDATION'));
    }
    if (input.mode === 'ai') {
      return this.gradeBatchWithAiFallback(input, context);
    }
    const results = input.items.map((it) => ({
      itemId: it.itemId,
      grading: {
        ...this.gradeOne({
          prompt: it.prompt,
          standardAnswer: it.standardAnswer,
          userSubmission: it.userSubmission,
          testedSkillId: it.testedSkillId ?? 'general',
          language: it.language ?? 'ja',
        }),
        source: 'rule' as const,
      },
    }));
    const correct = results.filter((r) => r.grading.isCorrect).length;
    const avg = results.reduce((s, r) => s + r.grading.score, 0) / results.length;
    // 共性问题：收集出现过的 negativeTransferTag
    const issueSet = new Set<string>();
    for (const r of results) {
      if (r.grading.negativeTransferTag) issueSet.add(r.grading.negativeTransferTag);
    }
    return ok({
      results,
      summary: {
        total: results.length,
        correct,
        averageScore: Math.round(avg),
        commonIssues: [...issueSet],
      },
    });
  }

  /**
   * P6-3：单题 AI 批改（失败一律回退规则引擎并标记，不抛错、不阻塞提交）。
   */
  private async gradeOneWithAiFallback(
    params: {
      prompt: string;
      standardAnswer: string;
      userSubmission: string;
      testedSkillId: string;
      language: 'en' | 'ja' | 'ko';
    },
    context: ToolExecutionContext
  ): Promise<Result<LearningAssessOutput, BusinessError>> {
    const ai = await this.requestAiGrading(
      [
        {
          prompt: params.prompt,
          standardAnswer: params.standardAnswer,
          userSubmission: params.userSubmission,
          testedSkillId: params.testedSkillId,
          language: params.language,
        },
      ],
      context
    );
    if (isOk(ai) && ai.value[0]) {
      const { itemId: _drop, ...grading } = ai.value[0];
      return ok({
        ...grading,
        accuracyRate: Number((grading.score / 100).toFixed(2)),
        source: 'ai' as const,
      });
    }
    return ok({ ...this.gradeOne(params), source: 'rule-fallback' as const });
  }

  /**
   * P6-3：批量 AI 批改（整批 1 次模型调用控成本；单题解析失败仅该题回退规则）。
   */
  private async gradeBatchWithAiFallback(
    input: LearningAssessInput,
    context: ToolExecutionContext
  ): Promise<Result<LearningAssessBatchOutput, BusinessError>> {
    const items = input.items ?? [];
    const ai = await this.requestAiGrading(
      items.map((it) => ({
        prompt: it.prompt,
        standardAnswer: it.standardAnswer,
        userSubmission: it.userSubmission,
        testedSkillId: it.testedSkillId ?? 'general',
        language: it.language ?? 'ja',
      })),
      context
    );
    const aiByIndex = isOk(ai) ? ai.value : [];
    // 先按 itemId 对齐（模型乱序/缺题时仍正确），无 itemId 的按位置兜底
    const aiById = new Map<string, (typeof aiByIndex)[number]>();
    const aiPositional: typeof aiByIndex = [];
    for (const g of aiByIndex) {
      if (g.itemId) aiById.set(g.itemId, g);
      else aiPositional.push(g);
    }
    const strip = (g: (typeof aiByIndex)[number]) => {
      const { itemId: _drop, ...rest } = g;
      return { ...rest, accuracyRate: Number((g.score / 100).toFixed(2)) };
    };
    const results = items.map((it) => {
      const graded = aiById.get(it.itemId) ?? aiPositional.shift();
      if (graded) return { itemId: it.itemId, grading: { ...strip(graded), source: 'ai' as const } };
      return {
        itemId: it.itemId,
        grading: {
          ...this.gradeOne({
            prompt: it.prompt,
            standardAnswer: it.standardAnswer,
            userSubmission: it.userSubmission,
            testedSkillId: it.testedSkillId ?? 'general',
            language: it.language ?? 'ja',
          }),
          source: 'rule-fallback' as const,
        },
      };
    });
    const correct = results.filter((r) => r.grading.isCorrect).length;
    const avg = results.reduce((s, r) => s + r.grading.score, 0) / Math.max(1, results.length);
    const issueSet = new Set<string>();
    for (const r of results) {
      if (r.grading.negativeTransferTag) issueSet.add(r.grading.negativeTransferTag);
    }
    return ok({
      results,
      summary: {
        total: results.length,
        correct,
        averageScore: Math.round(avg),
        commonIssues: [...issueSet],
      },
    });
  }

  /**
   * P6-3：经 AgentAdapter 请求模型批改（分析会话不注入任何工具，模型只返回 JSON）。
   * 返回与输入等长的规范化结果数组；任一环节失败返回 err（由调用方回退规则）。
   */
  private async requestAiGrading(
    items: Array<{
      itemId?: string | undefined;
      prompt: string;
      standardAnswer: string;
      userSubmission: string;
      testedSkillId: string;
      language: 'en' | 'ja' | 'ko';
    }>,
    context: ToolExecutionContext
  ): Promise<Result<Array<Omit<LearningAssessOutput, 'source' | 'accuracyRate'> & { itemId?: string | undefined }>, BusinessError>> {
    if (!this.adapter) {
      return err(new BusinessError('E_ASSESS_NO_ADAPTER', '未注入模型适配器，已回退规则批改。', 'AGENT_RUNTIME', true));
    }
    if (items.length === 0) {
      return err(new BusinessError('E_INVALID_INPUT', 'AI 批改需要至少一道题', 'VALIDATION'));
    }
    const sessionRes = await this.adapter.createSession({
      sessionId: generateId('assess'),
      userId: context.userId,
      systemPrompt: GRADING_SYSTEM_PROMPT,
      tools: [],
    });
    if (!isOk(sessionRes)) return err(sessionRes.error);
    const session = sessionRes.value;
    let outcome: Result<
      Array<Omit<LearningAssessOutput, 'source' | 'accuracyRate'> & { itemId?: string | undefined }>,
      BusinessError
    >;
    try {
      const numbered = items
        .map(
          (it, i) =>
            `【第${i + 1}题 itemId=${it.itemId}｜语种=${it.language}｜考点=${it.testedSkillId}】\n题干：${it.prompt}\n参考答案：${it.standardAnswer}\n学生作答：${it.userSubmission}`
        )
        .join('\n\n');
      const message =
        items.length === 1
          ? `请批改下面这道题，只返回 JSON：\n${numbered}`
          : `请逐题批改下面 ${items.length} 道题，只返回 JSON（results 数组按 itemId 对齐）：\n${numbered}`;
      let text = '';
      let streamError: BusinessError | undefined;
      for await (const ev of session.send({ message })) {
        if (ev.type === 'TEXT_DELTA') {
          text += ev.delta;
        } else if (ev.type === 'ERROR') {
          streamError = ev.error;
          break;
        } else if (ev.type === 'COMPLETED') {
          if (ev.finalOutput) text = ev.finalOutput;
          break;
        }
      }
      outcome = streamError ? err(streamError) : parseAiGradingResults(text, items.length);
    } catch (error) {
      outcome = err(
        translateToBusinessError(error, { category: 'AGENT_RUNTIME', action: 'requestAiGrading' })
      );
    } finally {
      void session.close().catch(() => {});
    }
    // P4-1 artifact：成功失败都记一行（只插不改）；artifact 自身失败只 warn，
    // 绝不推翻批改结果（不伪造成功，也不用 artifact 错误覆盖业务错误）。
    await this.recordGradeArtifact(items, outcome, context.userId);
    return outcome;
  }

  /**
   * P4-1 批改运行审计：输入只记快照 hash（不记原文/作答/回复）。
   * 非 Drizzle 仓储（单测 mock）跳过，不阻断批改。
   */
  private async recordGradeArtifact(
    items: Array<{
      itemId?: string | undefined;
      prompt: string;
      standardAnswer: string;
      userSubmission: string;
      testedSkillId: string;
      language: 'en' | 'ja' | 'ko';
    }>,
    outcome: Result<unknown, BusinessError>,
    userId: string
  ): Promise<void> {
    // G5 边界：经门面写入，不直调 getRawDb；非 Drizzle（单测 mock）跳过。
    if (!(this.learnerRepo instanceof DrizzleLearnerRepository)) return;
    const res = await this.learnerRepo.recordAiArtifactRun(
      {
        userId,
        action: items.length === 1 ? 'grade' : 'grade_batch',
        inputSnapshot: JSON.stringify(
          items.map((it) => [
            it.itemId ?? null,
            it.prompt,
            it.standardAnswer,
            it.userSubmission,
            it.testedSkillId,
            it.language,
          ])
        ),
        adapter: this.adapter?.id ?? 'none',
        model: 'adapter-default',
        promptVersion: artifactInputHash(GRADING_SYSTEM_PROMPT).slice(0, 16),
        schemaVersion: 'AiGradingJson/1',
        status: isOk(outcome) ? 'completed' : 'failed',
        ...(isOk(outcome) ? {} : { errorCode: outcome.error.code }),
      }
    );
    if (!isOk(res)) {
      logger.warn('[assess] artifact 记录失败（批改结果不受影响）', { code: res.error.code });
    }
  }
}

/** P6-3：批改系统提示（反馈文本为中文，与中文学习壳层一致）。 */
const GRADING_SYSTEM_PROMPT = [
  '你是外语学习批改引擎。用户给你题干、参考答案、学生作答与目标语种（ja=日语，en=英语，ko=韩语）。',
  '只返回 JSON，不要输出 markdown 围栏之外的任何文字。',
  '单题格式：{"isCorrect": boolean, "score": 0-100整数, "grammarFeedback": "中文一两句", "nativeNuanceAdvice": "中文一两句", "refinementSuggestion": "地道改写", "mistakeDetected": boolean}。',
  '多题格式：{"results": [{"itemId": "原样回传", ...单题字段}]}。',
  '评分：意思正确且表达自然 85-100；有小瑕疵但可理解 60-84；错误影响理解 0-59。',
].join('\n');

/**
 * P6-3：从模型文本提取批改 JSON（容忍前后杂文本与 markdown 围栏；单题/批量自适应）。
 * 返回与输入等长的结果数组；整体不可解析返回 null（调用方回退规则）。
 */
export function parseAiGradingResults(
  raw: string,
  expectedCount: number
): Result<Array<Omit<LearningAssessOutput, 'source' | 'accuracyRate'> & { itemId?: string | undefined }>, BusinessError> {
  if (!raw) {
    return err(new BusinessError('E_ASSESS_PARSE', 'AI 批改结果为空，已回退规则批改。', 'AGENT_RUNTIME', true));
  }
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let candidate = cleaned;
  if (!candidate.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) candidate = cleaned.slice(start, end + 1);
    else {
      return err(new BusinessError('E_ASSESS_PARSE', 'AI 批改结果格式无法解析，已回退规则批改。', 'AGENT_RUNTIME', true));
    }
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return err(new BusinessError('E_ASSESS_PARSE', 'AI 批改结果格式无法解析，已回退规则批改。', 'AGENT_RUNTIME', true));
  }
  const rawResults: unknown[] = Array.isArray(obj.results) ? obj.results : [obj];
  if (rawResults.length === 0) {
    return err(new BusinessError('E_ASSESS_PARSE', 'AI 批改结果为空，已回退规则批改。', 'AGENT_RUNTIME', true));
  }
  const out: Array<Omit<LearningAssessOutput, 'source' | 'accuracyRate'> & { itemId?: string | undefined }> = [];
  const count = Math.min(rawResults.length, Math.max(1, expectedCount));
  for (let i = 0; i < count; i++) {
    const parsed = AiGradingJsonSchema.safeParse(rawResults[i]);
    if (!parsed.success) continue;
    const g = parsed.data;
    const score = Math.max(0, Math.min(100, Math.round(g.score)));
    out.push({
      ...(g.itemId ? { itemId: g.itemId } : {}),
      isCorrect: g.isCorrect,
      score,
      grammarFeedback: g.grammarFeedback,
      nativeNuanceAdvice: g.nativeNuanceAdvice,
      refinementSuggestion: g.refinementSuggestion,
      mistakeDetected: g.mistakeDetected ?? !g.isCorrect,
      ...(g.negativeTransferTag ? { negativeTransferTag: g.negativeTransferTag } : {}),
    });
  }
  if (out.length === 0) {
    return err(new BusinessError('E_ASSESS_PARSE', 'AI 批改结果字段缺失，已回退规则批改。', 'AGENT_RUNTIME', true));
  }
  return ok(out);
}
