import { useMemo, useRef } from 'react';
import type { BankSubmissionRecord } from '@study-studio/protocol';

export interface SubmissionIdentity { submissionId: string; timeSpentMs: number }

/**
 * 提交身份簿：身份是创建时一次分配的独立随机编号，不从答案内容派生（32 位内容
 * 哈希在真实答案空间存在可复现碰撞）。同一卷、同一题、同一答案在会话重试与
 * 重开恢复中保持同一身份与作答时长；换卷、换题、换答案自动独立身份。
 * 重开恢复以后端保留（listBankSubmissions）为种子，不依赖组件本地状态。
 */
export class SubmissionLedger {
  private readonly entries = new Map<string, SubmissionIdentity>();
  private readonly mountedAt: number;

  constructor(
    private readonly paperId: string,
    private readonly questionId: string,
    private readonly nowMs: () => number = () => performance.now(),
    private readonly freshId: () => string = () => `ui-${crypto.randomUUID()}`,
  ) {
    this.mountedAt = this.nowMs();
  }

  get size(): number {
    return this.entries.size;
  }

  seed(seeds: BankSubmissionRecord[]): void {
    for (const seed of seeds) {
      if (seed.questionId !== this.questionId || seed.paperId !== this.paperId) continue;
      const key = this.keyOf(seed.userAnswer);
      if (!this.entries.has(key)) {
        this.entries.set(key, { submissionId: seed.submissionId, timeSpentMs: seed.timeSpentMs });
      }
    }
  }

  identify(userAnswer: string): SubmissionIdentity {
    const key = this.keyOf(userAnswer);
    const hit = this.entries.get(key);
    if (hit) return hit;
    const identity = {
      submissionId: this.freshId(),
      timeSpentMs: Math.max(0, Math.round(this.nowMs() - this.mountedAt)),
    };
    this.entries.set(key, identity);
    return identity;
  }

  private keyOf(userAnswer: string): string {
    return `${this.paperId}\n${this.questionId}\n${userAnswer}`;
  }
}

export function useSubmissionIdentity(paperId: string, questionId: string, seeds: BankSubmissionRecord[]): {
  identify: (userAnswer: string) => SubmissionIdentity;
} {
  const ledger = useMemo(() => new SubmissionLedger(paperId, questionId), [paperId, questionId]);
  const seedsRef = useRef(seeds);
  seedsRef.current = seeds;
  return {
    identify: (userAnswer: string): SubmissionIdentity => {
      ledger.seed(seedsRef.current);
      return ledger.identify(userAnswer);
    },
  };
}
