import type { GenerationBinding, GenerationConfig, BankQuestionRecord, BankSubmitReceipt, BankMaterial, GenerationBlueprint, GenerationRunLimits,
  SubmitBankQuestions, QueryBank, ReadGenerationTextbook, AssembleBankPaper, BankPaperReceipt, BankAudioReceipt,
  GenerationTaskSnapshot, GenerationPaperDetail, GenerationPaperSummary, BankSubmissionRecord, GenerationTaskStatus,
  GenerationTaskSummary } from '@lexdistill/protocol';

export type { GenerationTaskSummary };

export interface QuestionGenerationRepository {
  createTask(binding: GenerationBinding, config: GenerationConfig, expiresAt: string,
    extra?: { blueprint?: GenerationBlueprint | null; runLimits?: GenerationRunLimits | null; objective?: string | null }): void;  config(binding: GenerationBinding): { config: GenerationConfig; usedQuestions: number; usedAudio: number; usedAudioAttempts: number; usedPapers: number };
  finishTask(binding: GenerationBinding, status: 'COMPLETED' | 'CANCELLED'): void;
  readTextbook(binding: GenerationBinding, input: ReadGenerationTextbook): { items: unknown[]; nextOffset: number | null };
  query(binding: GenerationBinding, input: QueryBank): { items: BankQuestionRecord[]; nextOffset: number | null };
  submit(binding: GenerationBinding, input: SubmitBankQuestions): BankSubmitReceipt;
  assemble(binding: GenerationBinding, input: AssembleBankPaper): BankPaperReceipt;
  claimAudio(binding: GenerationBinding, materialId: string):
    { ready: BankAudioReceipt } | { claimId: string; material: Extract<BankMaterial, { type: 'LISTENING' }>; config: GenerationConfig };
  completeAudio(binding: GenerationBinding, materialId: string, claimId: string, bytes: Uint8Array, mimeType: string): BankAudioReceipt;
  releaseAudio(binding: GenerationBinding, materialId: string, claimId: string): void;
  /** P1 宿主查询：归属校验后可读，任务关闭/过期后仍可读取已完成资产。 */
  describeTask(userId: string, taskId: string): GenerationTaskSnapshot;
  listTaskPapers(userId: string, taskId: string): GenerationPaperSummary[];
  readTaskPaper(userId: string, taskId: string, paperId: string): GenerationPaperDetail;
  /** 进程重启后的孤立任务：清理 RUNNING 音频占位并标记 CANCELLED，不重放付费调用。返回被终结的任务 ID。 */
  recoverOrphanedTasks(userId: string, taskIds: string[]): string[];
  /** P2 作答：同一用户+提交键的幂等保留（待批改/已判分/批改失败），换内容复用原键视为冲突。 */
  getBankSubmission(userId: string, submissionId: string): BankSubmissionRecord | null;
  insertBankSubmission(input: { userId: string; submissionId: string; taskId: string; paperId: string; questionId: string;
    answerType: string; userAnswer: string; timeSpentMs?: number }): BankSubmissionRecord;
  settleBankSubmission(userId: string, submissionId: string, patch: { status: 'GRADED' | 'GRADING_FAILED';
    isCorrect?: boolean | null; score?: number | null; gradingError?: string | null;
    grading?: unknown; model?: string; adapter?: string }): BankSubmissionRecord;
  /** v47 收据回填缺失的确定性元数据（attempt_id/time_spent_ms），仅当元数据缺席时生效。 */
  healBankSubmission(userId: string, submissionId: string, input: { timeSpentMs: number }): BankSubmissionRecord;
  /** P2 复盘门：同一事实表（quiz_attempts）中各题的作答次数与是否已有判分记录。 */
  bankAnswerStates(userId: string, questionIds: string[]): Array<{ questionId: string; attempts: number; hasGraded: boolean }>;
  /** P3 任务列表：归属用户的新题任务摘要（状态/用量/试卷数），供重开与断开恢复。 */
  listUserTasks(userId: string): GenerationTaskSummary[];
  /** P3 重开恢复：同一试卷下用户自己的作答保留（含待批改与失败态），不含参考答案。 */
  listBankSubmissions(userId: string, taskId: string, paperId: string): BankSubmissionRecord[];
}
