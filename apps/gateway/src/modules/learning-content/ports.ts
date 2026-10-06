import type { BusinessError, Result } from '@study-studio/shared';
import type { StudyGateSource } from '@study-studio/learner-core';
import type { ContentRepository } from '../library/ports.js';
import type { LexiconRepository } from '../dictionary/ports.js';
import type { LearningRepository } from '../practice/ports.js';

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

/** Optional write capability: content generation can run without collection persistence. */
export type LearningContentCollectionRepository = Partial<
  Pick<LearningRepository, 'collectPracticeQuestions' | 'saveQuestions'>
>;

export type LearningContentTemplateRepository = LearningContentRepository &
  LearningContentCollectionRepository &
  StudyGateSource;

export type LearningContentCurriculumRepository =
  Pick<ContentRepository, 'getCurriculumKana' | 'getCurriculumHangul'> &
  LearningContentCollectionRepository;

export type LearningContentLexiconRepository =
  Pick<LexiconRepository, 'sampleLocalDictionaryEntries'>;

/** Complete content command port, independent of the database implementation. */
export type LearningContentCommandRepository =
  LearningContentTemplateRepository &
  LearningContentCurriculumRepository &
  LearningContentLexiconRepository;
