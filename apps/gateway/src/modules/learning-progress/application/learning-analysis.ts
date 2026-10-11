import { resolveAgentFirstMessage, type AgentAdapter } from '@study-studio/agent-runtime';
import { buildAnalysisSnapshot as buildAnalysisSnapshotUseCase } from '@study-studio/learning';
import { type LearnerRepository } from '@study-studio/learner-core';
import type {
  LearningAnalysisReport,
} from '@study-studio/protocol';
import { ok, err, isOk, type Result, BusinessError, translateToBusinessError, generateId } from '@study-studio/shared';
import {
  buildLocalRuleReport,
  generateLearningAnalysisReport,
  type AnalysisSnapshot,
} from '@study-studio/ai-content';

/** 快照类型兼容出口：定义已迁入 ai-content，此处重出以保持 public.ts 链路不动。 */
export type { AnalysisSnapshot } from '@study-studio/ai-content';

/**
 * P4-C：AI 学习分析能力产品化。
 *
 * 不变量：
 * - AI 结论不能直接覆盖分数/FSRS/掌握度——分析会话不注入任何写工具（tools 为空），
 *   模型只能返回结构化建议文本；任何状态变更仍由领域命令执行。
 * - 模型不可用时回退「上次可信分析（缓存）」或「本地规则建议」。
 * - 缓存带过期；过期后下次请求触发重算。换 Adapter 不改 Web/learner-core（本服务只依赖 AgentAdapter 接口）。
 */

const DEFAULT_TTL_MS = 1000 * 60 * 30; // 30 分钟

interface CacheEntry {
  report: LearningAnalysisReport;
  expiresAt: number;
}
const analysisCache = new Map<string, CacheEntry>();

export interface RunLearningAnalysisOptions {
  adapter: AgentAdapter;
  repo: LearnerRepository;
  userId: string;
  ttlMs?: number | undefined;
  forceRefresh?: boolean | undefined;
  model?: string | undefined;
}

/**
 * M7-10 组装不可变学习快照（兼容签名：供分析与本地规则回退共用）。
 * 映射逻辑已迁入 `@study-studio/learning`；此处只做 port 配接（Repository 调用）、
 * 时间注入与底层异常翻译。容错语义不变：profile 失败原样返回，
 * 到期卡/错题失败计数为 0。
 */
export async function buildAnalysisSnapshot(
  repo: LearnerRepository,
  userId: string
): Promise<Result<AnalysisSnapshot, BusinessError>> {
  try {
    return await buildAnalysisSnapshotUseCase(
      {
        getProfileSnapshot: () => repo.getProfileSnapshot(userId),
        getDueCardsCount: async (language) => {
          const res = await repo.getDueCards(userId, 200, { dueOnly: true, language });
          return isOk(res) ? ok(res.value.length) : res;
        },
        getUnresolvedMistakesCount: async (language) => {
          const res = await repo.getMistakes(userId, { resolved: false, language });
          return isOk(res) ? ok(res.value.length) : res;
        },
      },
      { userId, assembledAt: new Date().toISOString() }
    );
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'buildAnalysisSnapshot' })
    );
  }
}

/** 运行学习分析：缓存 → AI → 回退（缓存/本地规则）。 */
export async function runLearningAnalysis(
  opts: RunLearningAnalysisOptions
): Promise<Result<LearningAnalysisReport, BusinessError>> {
  const { adapter, repo, userId, ttlMs = DEFAULT_TTL_MS, forceRefresh, model } = opts;

  // 1. 未过期缓存命中
  if (!forceRefresh) {
    const entry = analysisCache.get(userId);
    if (entry && entry.expiresAt > Date.now()) {
      return ok({ ...entry.report, source: 'cached' });
    }
  }

  // 2. 组装快照
  const snapshotRes = await buildAnalysisSnapshot(repo, userId);
  if (!isOk(snapshotRes)) return snapshotRes;
  const snapshot = snapshotRes.value;

  // 3. 请求模型
  const aiRes = await runAiAnalysis(adapter, snapshot, model);
  if (isOk(aiRes)) {
    const report = aiRes.value;
    analysisCache.set(userId, { report, expiresAt: Date.now() + ttlMs });
    return ok(report);
  }

  // 4. 回退：上次可信分析（即便过期）→ 本地规则
  const stale = analysisCache.get(userId);
  if (stale) {
    return ok({ ...stale.report, source: 'cached' });
  }
  // 本地规则时间戳由 Gateway 提供（ai-content 不读时钟）。
  return ok(buildLocalRuleReport(snapshot, new Date().toISOString()));
}

async function runAiAnalysis(
  adapter: AgentAdapter,
  snapshot: AnalysisSnapshot,
  model?: string
): Promise<Result<LearningAnalysisReport, BusinessError>> {
  // 文本生成 port 的 Gateway 实现：ai-content 传入的 systemPrompt/message/tools
  // 在此原样落到 AgentAdapter（session 创建 → 流式收集 → 关闭全在 port 内）。
  const generateText = async (input: {
    systemPrompt: string;
    message: string;
    tools: [];
  }): Promise<Result<string, BusinessError>> => {
    const sessionId = generateId('analysis');
    const sessionRes = await adapter.createSession({
      sessionId,
      userId: snapshot.userId,
      systemPrompt: input.systemPrompt,
      // 不注入任何工具：AI 只能返回建议文本，无法直接改学习状态
      tools: input.tools,
      ...(model ? { model } : {}),
    });
    if (!isOk(sessionRes)) {
      return sessionRes;
    }
    const session = sessionRes.value;
    try {
      let text = '';
      // ACP 无 systemPrompt 通道：身份随首消息前置；其他通路走原生通道，不加料。
      const sendMessage = resolveAgentFirstMessage(session, input.systemPrompt, input.message);
      for await (const ev of session.send({ message: sendMessage })) {
        if (ev.type === 'TEXT_DELTA') {
          text += ev.delta;
        } else if (ev.type === 'ERROR') {
          return err(ev.error);
        } else if (ev.type === 'COMPLETED') {
          if (ev.finalOutput) text = ev.finalOutput;
          break;
        }
      }
      return ok(text);
    } catch (error) {
      return err(
        translateToBusinessError(error, { category: 'AGENT_RUNTIME', action: 'runAiAnalysis' })
      );
    } finally {
      void session.close().catch(() => {});
    }
  };
  // 内容用例（解析/报告装配）走 ai-content；时间戳与模型名由 Gateway 提供。
  return generateLearningAnalysisReport(
    { generateText },
    {
      snapshot,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
      ...(model ? { model } : {}),
    }
  );
}

/** 仅供测试重置缓存。 */
export function __resetAnalysisCacheForTest(): void {
  analysisCache.clear();
}
