import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
} from '@study-studio/shared';
import type { LearningAnalysisReport } from '@study-studio/protocol';
import {
  parseAnalysisJson,
  type AnalysisSnapshot,
} from './analysis-rules.js';

/**
 * M7-9 自 Gateway `learning-progress/application/learning-analysis.ts` 迁入
 * （逻辑字节一致，仅时间戳与模型名改为调用方传入——本包不读时钟）。
 *
 * 学习分析内容用例：快照 → 请求模型文本 → JSON 解析 → LearningAnalysisReport。
 * 只经 provider-neutral 文本生成 port 取文本；不引用 AgentAdapter、Gateway、
 * 具体模型 SDK、SQLite 或 Web。
 *
 * 不变量（逐项保留）：
 * - 工具列表恒为空：用例声明 `tools: []`，模型只能返回建议文本，
 *   无法直接改学习状态（任何状态变更仍由领域命令执行）；
 * - 解析失败走可重试 E_ANALYSIS_PARSE；
 * - 建议最多 5 条，模型字段透传，返回形状不变。
 */

export const ANALYSIS_SYSTEM_PROMPT = `你是 Lingua Studio 的学习分析助手。
基于提供的学习快照，给出可解释、可执行的学习建议。
严格只返回一个 JSON 对象，不要任何额外文字、不要 markdown 代码块：
{
  "summary": "一句话总览",
  "suggestions": [
    { "kind": "WEAKNESS|PLAN|TIP|ENCOURAGEMENT", "title": "简短标题", "detail": "具体建议", "skillId": "可选，关联技能 id" }
  ]
}
约束：
- 不得修改任何学习状态（分数、FSRS、掌握度）；只给建议。
- suggestions 最多 5 条，按重要性排序。
- 用与学习者母语一致的中文撰写。`;

/** provider-neutral 文本生成 port（Gateway 用 AgentAdapter 会话实现）。 */
export interface AnalysisTextPorts {
  /**
   * 按系统提示 + 消息生成建议文本。
   * - `tools` 恒为 `[]`（无工具声明，防模型写状态；实现方须如实透传）；
   * - 失败返回业务错误（由调用方决定回退），不得抛原始异常。
   */
  generateText(input: {
    systemPrompt: string;
    message: string;
    tools: [];
  }): Promise<Result<string, BusinessError>>;
}

export interface GenerateAnalysisInput {
  snapshot: AnalysisSnapshot;
  /** 报告生成时间（调用方时钟）。 */
  generatedAt: string;
  /** 报告过期时间（调用方按 TTL 计算）。 */
  expiresAt: string;
  /** 模型名（透传；不给则省略）。 */
  model?: string | undefined;
}

export async function generateLearningAnalysisReport(
  ports: AnalysisTextPorts,
  input: GenerateAnalysisInput
): Promise<Result<LearningAnalysisReport, BusinessError>> {
  const { snapshot } = input;
  const textRes = await ports.generateText({
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    message: `学习快照：\n${JSON.stringify(snapshot, null, 2)}`,
    tools: [],
  });
  if (!isOk(textRes)) return textRes;
  const parsed = parseAnalysisJson(textRes.value);
  if (!parsed) {
    return err(
      new BusinessError(
        'E_ANALYSIS_PARSE',
        'AI 分析结果格式无法解析，已改用本地规则建议。',
        'AGENT_RUNTIME',
        true
      )
    );
  }
  return ok({
    userId: snapshot.userId,
    language: snapshot.targetLanguage,
    source: 'ai',
    suggestions: parsed.suggestions.slice(0, 5),
    summary: parsed.summary,
    generatedAt: input.generatedAt,
    ...(input.model ? { model: input.model } : {}),
    expiresAt: input.expiresAt,
  });
}
