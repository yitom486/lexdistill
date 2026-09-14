import { z } from 'zod';

export const DocumentSourceKindSchema = z.enum([
  'user_import',
  'system',
  'ai_generated',
  'news',
  // 内置课程种子（教材课文）写入的来源标记；读侧按合法枚举透传。
  'curriculum_textbook',
]);
export type DocumentSourceKind = z.infer<typeof DocumentSourceKindSchema>;

export const DocumentItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  sourceKind: DocumentSourceKindSchema,
  language: z.string().default('ja'),
  content: z.string(),
  astJson: z.string().optional(),
  topic: z.string().optional(),
  difficulty: z.number().int().optional(),
  sourceUrl: z.string().optional(),
  sourcePublisher: z.string().optional(),
  examTag: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DocumentItem = z.infer<typeof DocumentItemSchema>;

export const AnnotationKindSchema = z.enum([
  'KEY_POINT',
  'VOCAB',
  'GRAMMAR',
  'EXAM_TRAP',
  'PARAPHRASE',
]);
export type AnnotationKind = z.infer<typeof AnnotationKindSchema>;

export const AnnotationItemSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  userId: z.string(),
  kind: AnnotationKindSchema,
  quote: z.string(),
  note: z.string().optional(),
  startOffset: z.number().int().default(0),
  endOffset: z.number().int().default(0),
  /** PDF 等分页文档的页码锚点（1-based）；纯文本可缺省 */
  pageNumber: z.number().int().positive().optional(),
  createdBy: z.enum(['USER', 'AGENT']).default('USER'),
  flashcardId: z.string().optional(),
  createdAt: z.string(),
});
export type AnnotationItem = z.infer<typeof AnnotationItemSchema>;

export const CreateAnnotationInputSchema = z.object({
  documentId: z.string(),
  kind: AnnotationKindSchema.default('KEY_POINT'),
  quote: z.string().min(1, '批注摘录不可为空'),
  note: z.string().optional(),
  startOffset: z.number().int().default(0),
  endOffset: z.number().int().default(0),
  pageNumber: z.number().int().positive().optional(),
  createdBy: z.enum(['USER', 'AGENT']).default('USER'),
});
export type CreateAnnotationInput = z.infer<typeof CreateAnnotationInputSchema>;

export const ConvertAnnotationToCardInputSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  tag: z.string().default('课文批注'),
  pos: z.string().default('重点词句'),
  phonetic: z.string().optional(),
});
export type ConvertAnnotationToCardInput = z.infer<typeof ConvertAnnotationToCardInputSchema>;

/** P1-3 内容段地址（派生投影；隔离经 documents 行继承）。 */
export const ContentSegmentSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  /** ''＝文档直属段（无外键）；否则 lesson 身份。 */
  lessonId: z.string(),
  ord: z.number().int().min(0),
  kind: z.enum(['paragraph', 'dialogue', 'heading', 'exercise', 'quote']),
  text: z.string(),
  startOffset: z.number().int().optional(),
  endOffset: z.number().int().optional(),
  hash: z.string(),
  createdAt: z.string(),
});
export type ContentSegment = z.infer<typeof ContentSegmentSchema>;

/** P1-3 统一来源登记（displayName 可变，不进身份）。 */
export const ContentSourceSchema = z.object({
  id: z.string(),
  format: z.string(),
  origin: z.string(),
  originRef: z.string().optional(),
  displayName: z.string(),
  license: z.string().optional(),
  attribution: z.string().optional(),
  capabilitiesJson: z.string(),
  createdAt: z.string(),
});
export type ContentSource = z.infer<typeof ContentSourceSchema>;

/** P1-3 选区上下文（SI-1/SI-2/SI-3 见 Repository 层）。 */
export const SelectionContextSchema = z.object({
  id: z.string(),
  userId: z.string(),
  language: z.enum(['ja', 'en', 'ko']),
  documentId: z.string().optional(),
  segmentId: z.string().optional(),
  surface: z.string(),
  normalizedText: z.string(),
  startOffset: z.number().int().optional(),
  endOffset: z.number().int().optional(),
  surroundingText: z.string().optional(),
  createdAt: z.string(),
});
export type SelectionContext = z.infer<typeof SelectionContextSchema>;

/** P1-3 相遇词（聚合；CI-1–CI-5 见 storage-sqlite adapter）。 */
export const EncounteredTermSchema = z.object({
  userId: z.string(),
  language: z.enum(['ja', 'en', 'ko']),
  termKey: z.string(),
  headword: z.string(),
  reading: z.string().optional(),
  status: z.enum(['new', 'collected', 'reviewing', 'mastered']),
  exposureCount: z.number().int().min(0),
  lookupCount: z.number().int().min(0),
  readCount: z.number().int().min(0),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  flashcardId: z.string().optional(),
});
export type EncounteredTerm = z.infer<typeof EncounteredTermSchema>;

/** P1-3 词出现审计（只插不改；segmentId 历史行可空）。 */
export const TermOccurrenceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  language: z.enum(['ja', 'en', 'ko']),
  termKey: z.string(),
  source: z.enum(['lookup', 'collect', 'reading', 'import']),
  documentId: z.string().optional(),
  segmentId: z.string().optional(),
  lessonId: z.string().optional(),
  quote: z.string().optional(),
  createdAt: z.string(),
});
export type TermOccurrence = z.infer<typeof TermOccurrenceSchema>;
