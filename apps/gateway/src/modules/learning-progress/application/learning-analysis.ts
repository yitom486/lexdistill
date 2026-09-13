import type { AgentAdapter } from '@study-studio/agent-core';
import { summarizeLearningEvidence } from '@study-studio/learning';
import { type LearnerRepository, type LearnerProfileSnapshot } from '@study-studio/learner-core';
import type {
  LearningAnalysisReport,
  LearningSuggestion,
  LearningSuggestionKind,
} from '@study-studio/protocol';
import { ok, err, isOk, type Result, BusinessError, translateToBusinessError, generateId } from '@study-studio/shared';

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

export interface AnalysisSnapshot {
  practiceEvidence?: ReturnType<typeof summarizeLearningEvidence>;
  userId: string;
  targetLanguage: string;
  overallLevel: string;
  learnerLevel?: string | undefined;
  studyGoal?: string | undefined;
  streakDays?: number | undefined;
  dailyGoalQuizzes?: number | undefined;
  dailyGoalCards?: number | undefined;
  strengths: { skillId: string; name: string; proficiency: number }[];
  weaknesses: {
    skillId: string;
    name: string;
    proficiency: number;
    consecutiveErrors: number;
  }[];
  dailyTask?:
    | {
        quizzesCount: number;
        cardsReviewedCount: number;
        readingCount: number;
        mistakesResolvedCount: number;
      }
    | undefined;
  dueCardsCount: number;
  unresolvedMistakesCount: number;
  assembledAt: string;
}

const ANALYSIS_SYSTEM_PROMPT = `你是 Lingua Studio 的学习分析助手。
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
  return ok(buildLocalRuleReport(snapshot));
}

async function runAiAnalysis(
  adapter: AgentAdapter,
  snapshot: AnalysisSnapshot,
  model?: string
): Promise<Result<LearningAnalysisReport, BusinessError>> {
  const sessionId = generateId('analysis');
  const sessionRes = await adapter.createSession({
    sessionId,
    userId: snapshot.userId,
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    // 不注入任何工具：AI 只能返回建议文本，无法直接改学习状态
    tools: [],
    ...(model ? { model } : {}),
  });
  if (!isOk(sessionRes)) {
    return sessionRes;
  }
  const session = sessionRes.value;

  try {
    let text = '';
    for await (const ev of session.send({ message: `学习快照：\n${JSON.stringify(snapshot, null, 2)}` })) {
      if (ev.type === 'TEXT_DELTA') {
        text += ev.delta;
      } else if (ev.type === 'ERROR') {
        return err(ev.error);
      } else if (ev.type === 'COMPLETED') {
        if (ev.finalOutput) text = ev.finalOutput;
        break;
      }
    }
    const parsed = parseAnalysisJson(text);
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
      generatedAt: new Date().toISOString(),
      ...(model ? { model } : {}),
      expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'AGENT_RUNTIME', action: 'runAiAnalysis' })
    );
  } finally {
    void session.close().catch(() => {});
  }
}

interface ParsedAnalysis {
  summary: string;
  suggestions: LearningSuggestion[];
}

/** 从模型文本中提取 JSON（容忍前后多余文字与 markdown 围栏）。 */
export function parseAnalysisJson(raw: string): ParsedAnalysis | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  // 尝试直接解析；失败则截取首个 { 到最后一个 }
  let candidate = cleaned;
  if (!candidate.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) candidate = cleaned.slice(start, end + 1);
    else return null;
  }
  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>;
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    if (!Array.isArray(obj.suggestions)) return null;
    const suggestions: LearningSuggestion[] = [];
    for (const item of obj.suggestions) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const kind = rec.kind as LearningSuggestionKind;
      if (
        kind !== 'WEAKNESS' &&
        kind !== 'PLAN' &&
        kind !== 'TIP' &&
        kind !== 'ENCOURAGEMENT'
      ) {
        continue;
      }
      if (typeof rec.title !== 'string' || typeof rec.detail !== 'string') continue;
      const s: LearningSuggestion = { kind, title: rec.title, detail: rec.detail };
      if (typeof rec.skillId === 'string') s.skillId = rec.skillId;
      suggestions.push(s);
    }
    if (!summary && suggestions.length === 0) return null;
    return { summary, suggestions };
  } catch {
    return null;
  }
}

/** 本地规则回退：从快照确定性生成建议（模型不可用时）。 */
export function buildLocalRuleReport(snapshot: AnalysisSnapshot): LearningAnalysisReport {
  const suggestions: LearningSuggestion[] = [];

  for (const w of snapshot.weaknesses.slice(0, 2)) {
    suggestions.push({
      kind: 'WEAKNESS',
      title: `攻克薄弱项 · ${w.name}`,
      detail: `该技能熟练度 ${Math.round(w.proficiency * 100)}%，连续出错 ${w.consecutiveErrors} 次。建议先看一句规则与例句，再做靶向练习，把结果写回学情雷达。`,
      skillId: w.skillId,
    });
  }

  if (snapshot.dueCardsCount > 0) {
    suggestions.push({
      kind: 'PLAN',
      title: '复习到期闪卡',
      detail: `今日有 ${snapshot.dueCardsCount} 张到期卡片待复习，按 FSRS 处理可巩固已学词汇。`,
    });
  }

  if (snapshot.unresolvedMistakesCount > 0) {
    suggestions.push({
      kind: 'PLAN',
      title: '错题回炉',
      detail: `待攻克 ${snapshot.unresolvedMistakesCount} 道错题；两连对即可出库，优先处理高频错因。`,
    });
  }

  if (snapshot.dailyTask) {
    const quizzesDone = snapshot.dailyTask.quizzesCount;
    const quizGoal = snapshot.dailyGoalQuizzes ?? 5;
    if (quizzesDone < quizGoal) {
      suggestions.push({
        kind: 'TIP',
        title: '今日练习进度',
        detail: `今日已完成 ${quizzesDone}/${quizGoal} 道练习，继续做题可写回技能雷达。`,
      });
    }
  }

  if (snapshot.streakDays && snapshot.streakDays > 0) {
    suggestions.push({
      kind: 'ENCOURAGEMENT',
      title: `连续学习 ${snapshot.streakDays} 天`,
      detail: '保持节奏，每日小步推进比突击更有效。',
    });
  }

  const summary =
    suggestions.length > 0
      ? suggestions[0]!.title
      : '暂无紧急任务，可探索新内容或查词学新词。';

  return {
    userId: snapshot.userId,
    language: snapshot.targetLanguage,
    source: 'local-rules',
    suggestions: suggestions.slice(0, 5),
    summary,
    generatedAt: new Date().toISOString(),
  };
}

/** 仅供测试重置缓存。 */
export function __resetAnalysisCacheForTest(): void {
  analysisCache.clear();
}
