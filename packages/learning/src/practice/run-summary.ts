import type { PracticeItemAttempt, PracticePlanRun } from '@lexdistill/protocol';

/**
 * M7-14 自 Gateway `practice/application/practice-summary.ts` 迁入
 * （统计与文案逐行一致；`generatedAt` 改为调用方传入）。
 *
 * 练习运行本地汇总：从 attempts 确定性统计（只读，不写任何学习状态）。
 * 纯逻辑：不读时钟、不碰存储/网络；gradingResult 经 unknown 安全收窄。
 */

export interface RunSummaryReport {
  runId: string;
  userId: string;
  language: 'en' | 'ja' | 'ko';
  source: 'ai' | 'local';
  summary: string;
  totalItems: number;
  submittedCount: number;
  gradedCount: number;
  correctCount: number;
  averageScore: number;
  commonIssues: string[];
  nextPlanSuggestions: string[];
  generatedAt: string;
  failureReason?: string | undefined;
}

/** 本地规则汇总：从 attempts 确定性统计。 */
export function buildLocalRunSummary(
  run: PracticePlanRun,
  attempts: PracticeItemAttempt[],
  generatedAt: string
): RunSummaryReport {
  const totalItems = run.blocks.reduce((s, b) => s + b.count, 0);
  const submitted = attempts.filter((a) => a.status === 'SUBMITTED' || a.status === 'GRADED');
  const graded = attempts.filter((a) => a.status === 'GRADED');
  let correct = 0;
  let scoreSum = 0;
  const issueBag = new Map<string, number>();

  for (const a of graded) {
    const g = (a.gradingResult ?? {}) as Record<string, unknown>;
    if (g.isCorrect === true) correct++;
    const score = typeof g.score === 'number' ? g.score : undefined;
    if (typeof score === 'number') scoreSum += score;
    const issues = Array.isArray(g.issues) ? (g.issues as unknown[]) : undefined;
    if (issues) {
      for (const iss of issues) {
        if (typeof iss === 'string') {
          issueBag.set(iss, (issueBag.get(iss) ?? 0) + 1);
        }
      }
    }
  }

  const averageScore = graded.length > 0 ? Math.round((scoreSum / graded.length) * 10) / 10 : 0;
  const commonIssues = [...issueBag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);

  const suggestions: string[] = [];
  if (totalItems > 0 && submitted.length < totalItems) {
    suggestions.push(`尚有 ${totalItems - submitted.length} 题未提交，建议继续完成后复盘。`);
  }
  if (graded.length > 0 && correct / graded.length < 0.6) {
    suggestions.push('正确率偏低，建议针对错题再做一轮靶向练习。');
  }
  if (commonIssues.length > 0) {
    suggestions.push(`高频问题：${commonIssues.join('、')}；下次计划可加相关靶向块。`);
  }
  if (suggestions.length === 0) {
    suggestions.push('本次完成质量良好，可按原计划继续推进。');
  }

  const accuracy = graded.length > 0 ? Math.round((correct / graded.length) * 100) : 0;
  const summary = `共 ${totalItems} 题，已提交 ${submitted.length}，已批改 ${graded.length}，正确 ${correct}（${accuracy}%）。`;

  return {
    runId: run.id,
    userId: run.userId,
    language: run.language,
    source: 'local',
    summary,
    totalItems,
    submittedCount: submitted.length,
    gradedCount: graded.length,
    correctCount: correct,
    averageScore,
    commonIssues,
    nextPlanSuggestions: suggestions,
    generatedAt,
  };
}
