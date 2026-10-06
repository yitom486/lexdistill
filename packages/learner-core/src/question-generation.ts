import type { GenerationBinding, GenerationConfig, BankQuestionRecord, BankSubmitReceipt, BankMaterial,
  SubmitBankQuestions, QueryBank, ReadGenerationTextbook, AssembleBankPaper, BankPaperReceipt, BankAudioReceipt } from '@study-studio/protocol';

export interface QuestionGenerationRepository {
  createTask(binding: GenerationBinding, config: GenerationConfig, expiresAt: string): void;
  config(binding: GenerationBinding): { config: GenerationConfig; usedQuestions: number; usedAudio: number; usedAudioAttempts: number; usedPapers: number };
  finishTask(binding: GenerationBinding, status: 'COMPLETED' | 'CANCELLED'): void;
  readTextbook(binding: GenerationBinding, input: ReadGenerationTextbook): { items: unknown[]; nextOffset: number | null };
  query(binding: GenerationBinding, input: QueryBank): { items: BankQuestionRecord[]; nextOffset: number | null };
  submit(binding: GenerationBinding, input: SubmitBankQuestions): BankSubmitReceipt;
  assemble(binding: GenerationBinding, input: AssembleBankPaper): BankPaperReceipt;
  claimAudio(binding: GenerationBinding, materialId: string):
    { ready: BankAudioReceipt } | { claimId: string; material: Extract<BankMaterial, { type: 'LISTENING' }>; config: GenerationConfig };
  completeAudio(binding: GenerationBinding, materialId: string, claimId: string, bytes: Uint8Array, mimeType: string): BankAudioReceipt;
  releaseAudio(binding: GenerationBinding, materialId: string, claimId: string): void;
}
