import type { AgentAdapter } from '@study-studio/agent-core';
import { summarizeLearningEvidence } from '@study-studio/learning';
import { type LearnerRepository, type LearnerProfileSnapshot } from '@study-studio/learner-core';
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

/** 组装不可变学习快照（供分析与本地规则回退共用）。 */
export async function buildAnalysisSnapshot(
  repo: LearnerRepository,
  userId: string
): Promise<Result<AnalysisSnapshot, BusinessError>> {
  try {
    const profileRes = await repo.getProfileSnapshot(userId);
    if (!isOk(profileRes)) return profileRes;
    const profile = profileRes.value;

    const [dueRes, mistakesRes] = await Promise.all([
      repo.getDueCards(userId, 200, { dueOnly: true, language: profile.targetLanguage }),
      repo.getMistakes(userId, { resolved: false, language: profile.targetLanguage }),
    ]);
    const dueCardsCount = isOk(dueRes) ? dueRes.value.length : 0;
    const unresolvedMistakesCount = isOk(mistakesRes) ? mistakesRes.value.length : 0;

    return ok({
      userId,
      targetLanguage: profile.targetLanguage,
      overallLevel: '未进行标准化能力评测',
      practiceEvidence: summarizeLearningEvidence(profile.allMetrics, profile.targetLanguage),
      learnerLevel: profile.profile?.learnerLevel,
      studyGoal: profile.profile?.studyGoal,
      streakDays: profile.profile?.streakDays,
      dailyGoalQuizzes: profile.profile?.dailyGoalQuizzes,
      dailyGoalCards: profile.profile?.dailyGoalCards,
      strengths: profile.strengths.map((m) => ({ skillId: m.id, name: m.name, proficiency: m.proficiency })),
      weaknesses: profile.weaknesses.map((m) => ({
        skillId: m.id,
        name: m.name,
        proficiency: m.proficiency,
        consecutiveErrors: m.consecutiveErrors,
      })),
      dailyTask: profile.dailyTask
        ? {
            quizzesCount: profile.dailyTask.quizzesCount,
            cardsReviewedCount: profile.dailyTask.cardsReviewedCount,
            readingCount: profile.dailyTask.readingCount,
            mistakesResolvedCount: profile.dailyTask.mistakesResolvedCount,
          }
        : undefined,
      dueCardsCount,
      unresolvedMistakesCount,
      assembledAt: new Date().toISOString(),
    });
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
      for await (const ev of session.send({ message: input.message })) {
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
