import type {
  LearningAnalysisReport,
  LearningSuggestion,
  LearningSuggestionKind,
} from '@study-studio/protocol';
import type { AnalysisSnapshot } from '@study-studio/learning';

/**
 * M7-8 自 Gateway `learning-progress/application/learning-analysis.ts` 迁入
 * （逻辑字节一致，仅 `buildLocalRuleReport` 的时间戳改为调用方传入——
 * 本包不读当前时间，单测完全确定性）。
 *
 * 学习分析中的确定性内容规则：模型 JSON 宽容解析、本地规则回退。
 * 快照类型正典自 M7-10 起归 `@study-studio/learning`（此处重出不断链）；
 * 快照组装、缓存、Agent 会话、模型调用、错误翻译仍归 Gateway。
 */

/** 快照类型正典（learning）；重出以保持既有消费链路不动。 */
export type { AnalysisSnapshot } from '@study-studio/learning';

export interface ParsedAnalysis {
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

/**
 * 本地规则回退：从快照确定性生成建议（模型不可用时）。
 * `generatedAt` 由调用方（Gateway）传入当前时间，本包不读时钟。
 * 优先级：薄弱项（≤2）→ 到期闪卡 → 错题 → 每日进度 → 连击鼓励；最多 5 条。
 */
export function buildLocalRuleReport(
  snapshot: AnalysisSnapshot,
  generatedAt: string
): LearningAnalysisReport {
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
    generatedAt,
  };
}
