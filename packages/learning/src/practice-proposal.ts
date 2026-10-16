import type { PracticeBlockSpec } from '@lexdistill/protocol';
import type { AnalysisSnapshot } from './analysis-snapshot.js';

/**
 * M7-20 自 Gateway `practice/application/practice-proposal.ts` 迁入
 * （草案规则逐行一致；令牌/存储/时钟仍归 Gateway）。
 *
 * 从学习者快照确定性生成练习计划建议草案：不保存、不写库、不调模型。
 * 纯逻辑：不读时钟、不生成 ID、不保存状态、不访问网络；不依赖 Gateway、
 * learning-progress、SQLite、Drizzle、Agent、Web。
 */
export function proposeTemplateFromSnapshot(
  snapshot: AnalysisSnapshot,
  language: 'en' | 'ja' | 'ko'
): { suggestedName: string; blocks: PracticeBlockSpec[] } {
  const blocks: PracticeBlockSpec[] = [];
  let idx = 0;
  const blockId = () => `blk-${++idx}`;

  // 1. 薄弱项靶向：每个薄弱技能生成一道靶向练习
  for (const w of snapshot.weaknesses.slice(0, 2)) {
    blocks.push({
      id: blockId(),
      kind: 'QUIZ',
      count: 5,
      difficulty: 3,
      gradingMode: 'AUTO_IMMEDIATE',
      vocabularySource: 'TOPIC_WORDS',
      skillIds: [w.skillId],
    });
  }

  // 2. 到期闪卡复习
  if (snapshot.dueCardsCount > 0) {
    blocks.push({
      id: blockId(),
      kind: 'VOCAB_REVIEW',
      count: Math.min(10, Math.max(5, snapshot.dueCardsCount)),
      difficulty: 3,
      gradingMode: 'AUTO_IMMEDIATE',
      vocabularySource: 'DUE_CARDS',
    });
  }

  // 3. 错题回炉（翻译主观题，批量 AI）
  if (snapshot.unresolvedMistakesCount > 0) {
    blocks.push({
      id: blockId(),
      kind: 'TRANSLATION',
      count: Math.min(5, Math.max(3, Math.ceil(snapshot.unresolvedMistakesCount / 2))),
      difficulty: 3,
      gradingMode: 'AI_BATCH',
      translationDirection: { sourceLanguage: 'zh', targetLanguage: language },
    });
  }

  // 4. 新词学习（默认块，保证非空）
  blocks.push({
    id: blockId(),
    kind: 'VOCAB_NEW',
    count: 10,
    difficulty: 2,
    gradingMode: 'AUTO_IMMEDIATE',
    vocabularySource: 'TOPIC_WORDS',
  });

  // 上限 8 块
  const trimmed = blocks.slice(0, 8);
  const langLabel = language === 'en' ? '英语' : language === 'ja' ? '日语' : '韩语';
  return {
    suggestedName: `${langLabel}智能建议计划`,
    blocks: trimmed,
  };
}
