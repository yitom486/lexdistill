import {
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolRegistry,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { err, ok, type Result, type BusinessError } from '@study-studio/shared';
import {
  VocabularyLearningContextInputSchema,
  type VocabularyLearningContextInput,
  VocabularyLearningSubmitInputSchema,
  type VocabularyLearningSubmitInput,
  type VocabularyLearningSubmitOutput,
} from '../contracts.js';
import {
  getVocabularyLearningContext,
  submitVocabularyLearning,
  type VocabularyLearningContextOutput,
  type VocabularyLearningRepo,
} from '../application/vocabulary-learning-service.js';

/**
 * 词汇依据读取（READ）：返回词、教材信息、已有讲解，并建立本次任务绑定。
 * 先调这个拿 taskId，再生成内容，最后调 submit 保存；不经过它拿到的 taskId 一律拒收。
 */
export class VocabularyLearningContextTool
  implements ToolDefinition<VocabularyLearningContextInput, VocabularyLearningContextOutput>
{
  public readonly name = 'vocabulary.learning.context';
  public readonly description =
    '读取一个词的学习依据（释义、教材用法、例句、已有讲解）并建立保存任务，返回 taskId。生成讲解前必须先调；taskId 交给 vocabulary.learning.submit。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = VocabularyLearningContextInputSchema;

  constructor(private readonly repo: VocabularyLearningRepo) {}

  public async execute(
    input: VocabularyLearningContextInput,
    context: ToolExecutionContext
  ): Promise<Result<VocabularyLearningContextOutput, BusinessError>> {
    return getVocabularyLearningContext(this.repo, context.userId, input);
  }
}

/**
 * 词汇讲解提交（WRITE）：按词覆盖保存，版本+1；FSRS 卡片与调度绝不触碰。
 * taskId 必须来自本用户本次 context 任务：过期、跨用户、跨词目标一律拒绝。
 */
export class VocabularyLearningSubmitTool
  implements ToolDefinition<VocabularyLearningSubmitInput, VocabularyLearningSubmitOutput>
{
  public readonly name = 'vocabulary.learning.submit';
  public readonly description =
    '提交词汇 AI 讲解并保存（同一词重复提交只覆盖）。必须携带 vocabulary.learning.context 返回的 taskId；无任务、过期或跨词提交会被拒绝。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = VocabularyLearningSubmitInputSchema;

  constructor(private readonly repo: VocabularyLearningRepo) {}

  public async execute(
    input: VocabularyLearningSubmitInput,
    context: ToolExecutionContext
  ): Promise<Result<VocabularyLearningSubmitOutput, BusinessError>> {
    const result = await submitVocabularyLearning(this.repo, context.userId, context.sessionId, input);
    if (!result.ok) return err(result.error);
    return ok(result.value);
  }
}

/** 词汇学习域工具注册（纯组装）。 */
export function registerVocabularyLearningTools(registry: ToolRegistry, repo: VocabularyLearningRepo): void {
  registry.register(new VocabularyLearningContextTool(repo));
  registry.register(new VocabularyLearningSubmitTool(repo));
}
