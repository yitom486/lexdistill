import { ok, err, type Result, BusinessError, generateId } from '@study-studio/shared';
import type { PracticeBlockSpec } from '@study-studio/protocol';
import type { AnalysisSnapshot } from '../../learning-progress/public.js';

/**
 * P5-PhaseD：AI 计划建议（propose）+ 用户确认式 apply。
 *
 * 不变量（draft §9.5）：
 * - AI 只建议：`propose` 从学习者快照确定性生成 `PracticeBlockSpec[]` 草案，不保存、不写库。
 * - 用户确认才写：`apply` 必须携带 Gateway 签发的 `proposalId`；HTTP 路由校验令牌（一次性、TTL）后才保存模板。
 * - AI 不得通过自由文本直接写模板/启用计划/改 FSRS。
 *
 * 注：propose 为规则驱动（从 SSOT 快照生成），不调用模型——可离线测试、可审计；
 *    真正的 AI 增强建议可后续在 Adapter 通路叠加，但 apply 仍必须经 UI 令牌确认。
 */

const PROPOSAL_TTL_MS = 1000 * 60 * 10; // 10 分钟

export interface PracticeProposal {
  proposalId: string;
  userId: string;
  language: 'en' | 'ja' | 'ko';
  suggestedName: string;
  blocks: PracticeBlockSpec[];
  createdAt: string;
  expiresAt: string;
}

interface StoredProposal extends PracticeProposal {
  expiresAtMs: number;
  consumed: boolean;
}

const proposalStore = new Map<string, StoredProposal>();

/** 从学习者快照确定性生成练习计划建议草案。 */
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

/** 创建建议草案并签发一次性令牌。 */
export function createProposal(
  userId: string,
  language: 'en' | 'ja' | 'ko',
  snapshot: AnalysisSnapshot
): PracticeProposal {
  const { suggestedName, blocks } = proposeTemplateFromSnapshot(snapshot, language);
  const proposalId = generateId('prop');
  const now = Date.now();
  const proposal: StoredProposal = {
    proposalId,
    userId,
    language,
    suggestedName,
    blocks,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PROPOSAL_TTL_MS).toISOString(),
    expiresAtMs: now + PROPOSAL_TTL_MS,
    consumed: false,
  };
  proposalStore.set(proposalId, proposal);
  return proposal;
}

/** 校验并消费令牌（一次性）。返回草案块供 UI 可能改写后保存。 */
export function consumeProposal(
  userId: string,
  proposalId: string
): Result<PracticeProposal, BusinessError> {
  const p = proposalStore.get(proposalId);
  if (!p) {
    return err(new BusinessError('E_PROPOSAL_NOT_FOUND', '建议草案不存在或已失效', 'VALIDATION'));
  }
  if (p.userId !== userId) {
    return err(new BusinessError('E_PROPOSAL_FORBIDDEN', '建议草案不属于该用户', 'VALIDATION'));
  }
  if (p.consumed || p.expiresAtMs < Date.now()) {
    proposalStore.delete(proposalId);
    return err(new BusinessError('E_PROPOSAL_EXPIRED', '建议草案已过期或已使用', 'VALIDATION'));
  }
  p.consumed = true;
  proposalStore.delete(proposalId);
  return ok({
    proposalId: p.proposalId,
    userId: p.userId,
    language: p.language,
    suggestedName: p.suggestedName,
    blocks: p.blocks,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
  });
}

/** 仅供测试：清空令牌存储。 */
export function _clearProposalsForTest(): void {
  proposalStore.clear();
}
