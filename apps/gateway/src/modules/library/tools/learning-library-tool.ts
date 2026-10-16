import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, err, type Result, BusinessError, isOk } from '@lexdistill/shared';
import type { DocumentItem, AnnotationItem, NewsTopic } from '@lexdistill/protocol';
import { listNewsTopics } from '@lexdistill/protocol';
import type { ContentRepository } from '../ports.js';

export const LearningLibraryInputSchema = z.object({
  action: z.enum([
    'list_documents',
    'get_document_slice',
    'list_annotations',
    'list_news_topics',
  ]),
  documentId: z.string().optional(),
  sourceKind: z.string().optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});

export type LearningLibraryInput = z.infer<typeof LearningLibraryInputSchema>;

export class LearningLibraryTool
  implements
    ToolDefinition<
      LearningLibraryInput,
      {
        action: string;
        documents?: DocumentItem[];
        slice?: string;
        annotations?: AnnotationItem[];
        topics?: NewsTopic[];
      }
    >
{
  public readonly name = 'learning.library';
  public readonly description =
    '资料库只读编排：列出文档、切片取文、批注列表；新闻话题枚举。不直接暴露 SQL。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = LearningLibraryInputSchema;

  constructor(private readonly learnerRepo: ContentRepository) {}

  public async execute(
    input: LearningLibraryInput,
    context: ToolExecutionContext
  ): Promise<
    Result<
      {
        action: string;
        documents?: DocumentItem[];
        slice?: string;
        annotations?: AnnotationItem[];
        topics?: NewsTopic[];
      },
      BusinessError
    >
  > {
    switch (input.action) {
      case 'list_documents': {
        const res = await this.learnerRepo.listDocuments(
          context.userId,
          input.sourceKind as DocumentItem['sourceKind'] | undefined
        );
        if (!isOk(res)) return res;
        return ok({ action: input.action, documents: res.value });
      }
      case 'get_document_slice': {
        if (!input.documentId) {
          return err(new BusinessError('E_INVALID_INPUT', '需要 documentId', 'VALIDATION'));
        }
        const res = await this.learnerRepo.getDocumentById(input.documentId);
        if (!isOk(res)) return res;
        if (!res.value) {
          return err(new BusinessError('E_NOT_FOUND', '文档不存在', 'LEARNER_STATE'));
        }
        const text = res.value.content || '';
        const start = input.start ?? 0;
        const end = Math.min(input.end ?? start + 800, text.length);
        return ok({
          action: input.action,
          slice: text.slice(start, end),
        });
      }
      case 'list_annotations': {
        if (!input.documentId) {
          return err(new BusinessError('E_INVALID_INPUT', '需要 documentId', 'VALIDATION'));
        }
        const res = await this.learnerRepo.listAnnotations(input.documentId, context.userId);
        if (!isOk(res)) return res;
        return ok({ action: input.action, annotations: res.value });
      }
      case 'list_news_topics':
        return ok({
          action: input.action,
          topics: listNewsTopics(),
        });
      default:
        return err(new BusinessError('E_INVALID_INPUT', '未知 library action', 'VALIDATION'));
    }
  }
}
