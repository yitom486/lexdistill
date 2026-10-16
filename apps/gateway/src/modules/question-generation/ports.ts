import type { BankMaterial, GenerationConfig } from '@lexdistill/protocol';
export type { QuestionGenerationRepository } from '@lexdistill/learner-core';
export interface GenerationAudioRenderer {
  render(input: { material: Extract<BankMaterial, { type: 'LISTENING' }>; language: GenerationConfig['language'];
    settings: NonNullable<GenerationConfig['audio']>; signal: AbortSignal }): Promise<{ bytes: Uint8Array; mimeType: string }>;
}
