import { z } from 'zod';
import { ContentSourceReferenceSchema } from './chapter-source.js';

export const ContentSourceSchema = z.enum(['TEXTBOOK', 'AI']).describe('TEXTBOOK 为原书整理，AI 为新增内容；不得把新增内容标为原书');
export const ExerciseTypeSchema = z.enum(['CHOICE', 'MULTI_CHOICE', 'FILL_BLANK', 'TRANSLATION', 'ORDERING', 'MATCHING', 'SHORT_ANSWER', 'WRITING']);
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

export interface ContentFieldIssue { path: string; message: string }
/** 路径对应提交数组；反馈不使用系统随后分配的内容 ID。 */
export function lessonContentFieldIssues(content: LessonContent): ContentFieldIssue[] {
  const issues: ContentFieldIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const unique = (values: string[], path: string) => {
    if (new Set(values).size !== values.length) add(path, 'ID 重复');
  };
  unique(content.coverage.map(item => item.tocId), 'content.coverage');
  unique([...content.blocks, ...content.vocabularies, ...content.knowledgePoints, ...content.exercises].map(item => item.id), 'content');
  if (!content.blocks.length && !content.vocabularies.length && !content.knowledgePoints.length && !content.exercises.length) add('content', '没有实际章节内容');
  for (const [index, block] of content.blocks.entries()) {
    const path = `content.blocks.${index}`;
    if (block.kind === 'DIALOGUE' && !block.speaker) add(`${path}.speaker`, 'DIALOGUE 对话必须提供 speaker');
    if (block.translation && !block.fieldSources?.translation) add(`${path}.fieldSources.translation`, '翻译缺少来源');
  }
  for (const [index, word] of content.vocabularies.entries()) {
    if (word.reading && !word.fieldSources?.reading) add(`content.vocabularies.${index}.fieldSources.reading`, '注音缺少来源');
    if (word.gloss && !word.fieldSources?.gloss) add(`content.vocabularies.${index}.fieldSources.gloss`, '释义缺少来源');
  }
  for (const [index, point] of content.knowledgePoints.entries()) {
    if (point.source === 'AI' && point.textbookExplanation) add(`content.knowledgePoints.${index}.textbookExplanation`, 'AI 知识点不能填写原书讲解');
    if (point.connection && !point.fieldSources?.connection) add(`content.knowledgePoints.${index}.fieldSources.connection`, '接续说明缺少来源');
  }
  for (const collection of ['vocabularies', 'knowledgePoints'] as const) {
    for (const [index, item] of content[collection].entries()) {
      const path = `content.${collection}.${index}.examples`;
      unique(item.examples.map(example => example.id), path);
      item.examples.forEach((example, position) => {
        if (example.translation && !example.fieldSources?.translation) add(`${path}.${position}.fieldSources.translation`, '例句译文缺少来源');
      });
    }
  }
  const knowledgeIds = new Set(content.knowledgePoints.map(item => item.id));
  for (const [index, exercise] of content.exercises.entries()) {
    const path = `content.exercises.${index}`;
    const { type, answer } = exercise;
    const options = exercise.options ?? [];
    unique(options.map(item => item.id), `${path}.options`);
    if (exercise.knowledgePointIds.some(key => !knowledgeIds.has(key))) add(`${path}.knowledgePointIds`, '关联了未知知识点');
    if (!exercise.fieldSources?.answer) add(`${path}.fieldSources.answer`, '答案缺少来源');
    if (exercise.explanation && !exercise.fieldSources?.explanation) add(`${path}.fieldSources.explanation`, '解析缺少来源');
    if (['CHOICE', 'MULTI_CHOICE', 'ORDERING'].includes(type)) {
      const selected = answer.optionIds ?? [];
      const ids = new Set(options.map(item => item.id));
      if (options.length < 2 || !selected.length || new Set(selected).size !== selected.length || selected.some(key => !ids.has(key)) || answer.text || answer.pairs) add(`${path}.answer`, '选项答案格式不正确：至少两个 options，answer 只含不重复的 optionIndexes');
      if (type === 'CHOICE' && selected.length !== 1) add(`${path}.answer.optionIndexes`, '单选只能有一个答案');
      if (type === 'ORDERING' && selected.length !== options.length) add(`${path}.answer.optionIndexes`, '排序答案必须覆盖全部选项');
    } else if (type === 'MATCHING') {
      const left = exercise.left ?? [], right = exercise.right ?? [], pairs = answer.pairs ?? [];
      unique(left.map(item => item.id), `${path}.left`); unique(right.map(item => item.id), `${path}.right`);
      if (!left.length || !right.length || pairs.length !== left.length || new Set(pairs.map(item => item.leftId)).size !== left.length || pairs.some(pair => !left.some(item => item.id === pair.leftId) || !right.some(item => item.id === pair.rightId)) || answer.text || answer.optionIds) add(`${path}.answer`, '匹配答案只含 pairs，需覆盖全部左项并引用有效左右下标');
    } else if (!answer.text || answer.optionIds || answer.pairs) add(`${path}.answer`, '需要文本参考答案，只填写 answer.text');
  }
  return issues;
}

export function lessonContentIssues(content: LessonContent): string[] {
  return lessonContentFieldIssues(content).map(issue => `${issue.path}：${issue.message}`);
}
