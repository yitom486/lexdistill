import { z } from 'zod';
import { ArticleItemSchema, GrammarItemSchema, LearningExerciseItemSchema, SentenceItemSchema, VocabularyItemSchema } from './textbook-learning-content.js';
import { validateExercise } from './exercise-validation.js';

export const RequiredLessonContent = ['grammar', 'vocabulary', 'exercises'] as const;
const ref = z.string().trim().min(1).describe('仅使用当前任务工具回执中的短引用，不是数据库 ID');
const action = z.enum(['add', 'read', 'update', 'delete']).default('add');
function operation<T extends z.ZodType>(item: T, sourced: boolean) {
  return z.object({ action, items: z.array(item).min(1).optional(), refs: z.array(ref).min(1).optional(),
    ...(sourced ? { source: z.enum(['TEXTBOOK', 'AI']).optional() } : {}),
  }).strict().superRefine((value, ctx) => {
    if ((value.action === 'add' || value.action === 'update') && !value.items) ctx.addIssue({ code: 'custom', path: ['items'], message: '新增或修改需要内容 items' });
    if (value.action === 'delete' && !value.refs) ctx.addIssue({ code: 'custom', path: ['refs'], message: '删除需要当前任务的 refs' });
    if ((value.action === 'read' || value.action === 'delete') && value.items) ctx.addIssue({ code: 'custom', path: ['items'], message: '查询和删除不接收内容 items' });
    if (value.action !== 'delete' && value.refs) ctx.addIssue({ code: 'custom', path: ['refs'], message: 'refs 只用于删除；修改在条目中填写 ref' });
    for (const [i, item] of (value.items ?? []).entries()) {
      const hasRef = typeof item === 'object' && item !== null && 'ref' in item && item.ref !== undefined;
      if (value.action === 'update' && !hasRef) ctx.addIssue({ code: 'custom', path: ['items', i, 'ref'], message: '修改需要当前任务的 ref' });
      if (value.action === 'add' && hasRef) ctx.addIssue({ code: 'custom', path: ['items', i, 'ref'], message: '新增不填写 ref，系统生成' });
    }
  });
}
export const TextbookContentOperationSchemas = {
  grammar: operation(GrammarItemSchema.extend({ ref: ref.optional() }), true),
  vocabulary: operation(VocabularyItemSchema.extend({ ref: ref.optional() }), false),
  articles: operation(ArticleItemSchema.extend({ ref: ref.optional() }), true),
  sentences: operation(SentenceItemSchema.extend({ ref: ref.optional() }), true),
  exercises: operation(LearningExerciseItemSchema.extend({ ref: ref.optional() }).superRefine(validateExercise), true),
  material: operation(z.object({ text: z.string().trim().min(1), ref: ref.optional() }).strict(), false),
} as const;

/** System-only transaction commands; none of these identities appear in model schemas. */
export interface TextbookContentChange {
  kind: keyof typeof TextbookContentOperationSchemas;
  action: 'add' | 'update' | 'delete';
  id: string;
  input?: unknown;
}
