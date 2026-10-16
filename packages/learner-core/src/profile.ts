import type { SkillMetric, SkillStatus, LearnerProfileSnapshot, TargetLanguage } from './types.js';
import { nowIso } from '@lexdistill/shared';

/**
 * 根据最新一次练习表现更新技能指标
 */
export function recordSkillAttempt(
  current: SkillMetric,
  isCorrect: boolean
): SkillMetric {
  const totalAttempts = current.totalAttempts + 1;
  const correctAttempts = isCorrect ? current.correctAttempts + 1 : current.correctAttempts;
  const consecutiveErrors = isCorrect ? 0 : current.consecutiveErrors + 1;

  // 使用平滑权重更新熟练度 (指数移动平均或比率调整)
  const ratio = correctAttempts / totalAttempts;
  const penalty = consecutiveErrors >= 2 ? consecutiveErrors * 0.08 : 0;
  const proficiency = Math.max(0, Math.min(1, Number((ratio - penalty).toFixed(2))));

  // 评估状态
  let status: SkillStatus = 'NORMAL';
  if (consecutiveErrors >= 2 || proficiency < 0.6) {
    status = 'WEAKNESS';
  } else if (proficiency >= 0.85 && totalAttempts >= 5 && consecutiveErrors === 0) {
    status = 'STRENGTH';
  }

  return {
    ...current,
    totalAttempts,
    correctAttempts,
    consecutiveErrors,
    proficiency,
    status,
    lastPracticedAt: nowIso(),
  };
}

/**
 * 构建学习者画像快照，自动聚合并切分优势与薄弱项
 */
export function buildProfileSnapshot(
  userId: string,
  targetLanguage: TargetLanguage,
  overallLevel: string,
  metrics: SkillMetric[]
): LearnerProfileSnapshot {
  const strengths = metrics.filter((m) => m.status === 'STRENGTH');
  const weaknesses = metrics.filter((m) => m.status === 'WEAKNESS');

  return {
    userId,
    targetLanguage,
    overallLevel,
    strengths,
    weaknesses,
    allMetrics: metrics,
    updatedAt: nowIso(),
  };
}
