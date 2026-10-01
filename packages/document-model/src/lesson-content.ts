import { z } from 'zod';
import { ContentSourceReferenceSchema } from './chapter-source.js';

export const ContentSourceSchema = z.enum(['TEXTBOOK', 'AI']).describe('TEXTBOOK 为原书整理，AI 为新增内容；不得把新增内容标为原书');
export const ExerciseTypeSchema = z.enum(['CHOICE', 'MULTI_CHOICE', 'FILL_BLANK', 'TRANSLATION', 'ORDERING', 'MATCHING', 'SHORT_ANSWER']);
const id = z.string().trim().min(1).max(128);
const text = z.string().trim().min(1);
const provenance = {
  source: ContentSourceSchema,
  tocId: id.optional().describe('所有内容必须关联本任务目录 ID；AI 新增内容至少关联当前任务根节点'),
  sourceRefs: z.array(ContentSourceReferenceSchema).optional().describe('当前输入有解析块时，原书内容必须引用实际 blockId 与物理 page；表格可加从 0 开始的 row。不得引用别章、上一轮或虚构材料'),
};
export const FieldSourcesSchema = z.object({
  translation: ContentSourceSchema.optional(),
  answer: ContentSourceSchema.optional(),
  explanation: ContentSourceSchema.optional(),
  reading: ContentSourceSchema.optional(),
  gloss: ContentSourceSchema.optional(),
  connection: ContentSourceSchema.optional(),
}).strict().describe('补充或改写字段的来源；原书题干可搭配 AI 答案和解析');
const example = z.object({ id, text, translation: text.optional(), ...provenance, fieldSources: FieldSourcesSchema.optional() }).strict();
export const LessonContentSchema = z.object({
  coverage: z.array(z.object({
    tocId: id,
    status: z.enum(['EXTRACTED', 'UNREADABLE']).describe('逐项报告当前章及所有子目录；无法辨认不能声称完成'),
  }).strict()).min(1),
  blocks: z.array(z.object({
    id, kind: z.enum(['PARAGRAPH', 'DIALOGUE']), text: text.describe('仅整理后的课文正文或对话，不混入讲解、词义或新增例句；知识点讲解和例句写入各自字段'),
    speaker: text.optional().describe('DIALOGUE 必填；PARAGRAPH 不需要角色'),
    translation: text.optional().describe('正文译文独立存放，并注明 fieldSources.translation'), ...provenance, fieldSources: FieldSourcesSchema.optional(),
  }).strict()),
  vocabularies: z.array(z.object({
    id, surface: text, reading: text.optional(), pos: text.optional(), gloss: text.optional(), pitch: text.optional().describe('只填写原书或原页能确认的音调；无法确认则省略，编号不能猜成声调'),
    aiExplanation: text.optional().describe('生词独立的 AI 补充讲解；不混进词义 gloss 或原书正文'),
    examples: z.array(example), ...provenance, fieldSources: FieldSourcesSchema.optional(),
  }).strict()),
  knowledgePoints: z.array(z.object({
    id, title: text, connection: text.optional(),
    textbookExplanation: text.optional().describe('只填写原书已有讲解'),
    aiExplanation: text.optional().describe('独立保存 AI 补充讲解，不冒充原书'),
    examples: z.array(example), ...provenance, fieldSources: FieldSourcesSchema.optional(),
  }).strict()),
  exercises: z.array(z.object({
    id, type: ExerciseTypeSchema, prompt: text, ...provenance,
    knowledgePointIds: z.array(id),
    options: z.array(z.object({ id, text }).strict()).optional().describe('选择、多选和排序的候选项'),
    left: z.array(z.object({ id, text }).strict()).optional().describe('匹配题左侧'),
    right: z.array(z.object({ id, text }).strict()).optional().describe('匹配题右侧'),
    answer: z.object({
      text: text.optional().describe('填空、翻译、简答的参考答案'),
      optionIds: z.array(id).optional().describe('单选一个、多选多个、排序为完整有序候选 ID'),
      pairs: z.array(z.object({ leftId: id, rightId: id }).strict()).optional().describe('匹配答案'),
    }).strict(),
    explanation: text.optional(), fieldSources: FieldSourcesSchema.optional(),
  }).strict()).describe('保留原书习题；可新增 AI 练习，无须目录存在练习项，须如实标注来源'),
  preview: z.object({ keyPoints: z.array(text), pitfalls: z.array(text), canDoGoal: text }).strict().optional().describe('AI 预习导学'),
  summary: z.object({ goldenSentences: z.array(text), selfCheckQuestions: z.array(text) }).strict().optional().describe('AI 总结'),
}).strict();
export type LessonContent = z.infer<typeof LessonContentSchema>;
export type StructuredExercise = LessonContent['exercises'][number];

/** 原生工具注册使用普通 Zod object；交叉字段规则由提交服务执行。 */
export const LessonSubmissionSchema = z.object({
  documentId: id.describe('原样使用当前输入的 documentId'), lessonId: id.describe('原样使用当前输入的 lessonId；独立 section 也用自己的目录身份'),
  assignmentId: id.describe('必须原样使用本次输入中的 assignmentId；上一章/上一尝试的 ID 不可复用'),
  content: LessonContentSchema,
}).strict();
export type LessonSubmission = z.infer<typeof LessonSubmissionSchema>;

export function lessonContentIssues(content: LessonContent): string[] {
  const issues: string[] = [];
  const unique = (values: string[], name: string) => {
    if (new Set(values).size !== values.length) issues.push(`${name} ID 重复`);
  };
  unique(content.coverage.map(item => item.tocId), '目录');
  unique([...content.blocks, ...content.vocabularies, ...content.knowledgePoints, ...content.exercises].map(item => item.id), '内容');
  if (!content.blocks.length && !content.vocabularies.length && !content.knowledgePoints.length && !content.exercises.length) issues.push('没有实际章节内容');
  for (const block of content.blocks) {
    if (block.kind === 'DIALOGUE' && !block.speaker) issues.push(`${block.id} 对话缺少 speaker`);
    if (block.translation && !block.fieldSources?.translation) issues.push(`${block.id} 翻译缺少来源`);
  }
  for (const word of content.vocabularies) {
    if ((word.reading && !word.fieldSources?.reading) || (word.gloss && !word.fieldSources?.gloss)) issues.push(`${word.id} 注音/释义缺少来源`);
  }
  for (const point of content.knowledgePoints) {
    if (point.source === 'AI' && point.textbookExplanation) issues.push(`${point.id} AI 知识点不能填写原书讲解`);
    if (point.connection && !point.fieldSources?.connection) issues.push(`${point.id} 接续说明缺少来源`);
  }
  for (const item of [...content.vocabularies, ...content.knowledgePoints]) {
    unique(item.examples.map(example => example.id), `${item.id} 例句`);
    if (item.examples.some(example => example.translation && !example.fieldSources?.translation)) issues.push(`${item.id} 例句译文缺少来源`);
  }
  const knowledgeIds = new Set(content.knowledgePoints.map(item => item.id));
  for (const exercise of content.exercises) {
    const { type, answer } = exercise;
    const options = exercise.options ?? [];
    unique(options.map(item => item.id), `${exercise.id} 选项`);
    if (exercise.knowledgePointIds.some(key => !knowledgeIds.has(key))) issues.push(`${exercise.id} 关联了未知知识点`);
    if (!exercise.fieldSources?.answer || (exercise.explanation && !exercise.fieldSources.explanation)) issues.push(`${exercise.id} 答案/解析缺少来源`);
    if (['CHOICE', 'MULTI_CHOICE', 'ORDERING'].includes(type)) {
      const selected = answer.optionIds ?? [];
      const ids = new Set(options.map(item => item.id));
      if (options.length < 2 || !selected.length || new Set(selected).size !== selected.length || selected.some(key => !ids.has(key)) || answer.text || answer.pairs) issues.push(`${exercise.id} 选项答案格式不正确`);
      if (type === 'CHOICE' && selected.length !== 1) issues.push(`${exercise.id} 单选只能有一个答案`);
      if (type === 'ORDERING' && selected.length !== options.length) issues.push(`${exercise.id} 排序答案必须覆盖全部选项`);
    } else if (type === 'MATCHING') {
      const left = exercise.left ?? [], right = exercise.right ?? [], pairs = answer.pairs ?? [];
      unique(left.map(item => item.id), `${exercise.id} 左侧`); unique(right.map(item => item.id), `${exercise.id} 右侧`);
      if (!left.length || !right.length || pairs.length !== left.length || new Set(pairs.map(item => item.leftId)).size !== left.length || pairs.some(pair => !left.some(item => item.id === pair.leftId) || !right.some(item => item.id === pair.rightId)) || answer.text || answer.optionIds) issues.push(`${exercise.id} 匹配答案格式不正确`);
    } else if (!answer.text || answer.optionIds || answer.pairs) issues.push(`${exercise.id} 需要文本参考答案`);
  }
  return issues;
}
