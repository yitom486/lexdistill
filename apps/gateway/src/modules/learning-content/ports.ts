import type { BusinessError, Result } from '@study-studio/shared';

/** Content-template row consumed by learning.content. */
export type TemplateRow = {
  id: string;
  language: string;
  action: string;
  format: string | null;
  skillId: string | null;
  difficulty: number;
  topic: string | null;
  genre: string | null;
  sortOrder: number;
  payload: Record<string, unknown>;
};

/** Narrow read port: the tool only needs the shared content-template query. */
export interface LearningContentRepository {
  listContentTemplates(options: {
    action: string;
    language: string;
    skillId?: string | undefined;
    format?: string | undefined;
    genre?: string | undefined;
    limit?: number | undefined;
  }): Promise<Result<TemplateRow[], BusinessError>>;
}
