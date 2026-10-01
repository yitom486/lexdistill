import { LessonProposalSchema, type LessonProposal, type LessonContent, type LessonSubmission, type ChapterSourceBlock, type ContentSourceReference } from '@study-studio/document-model';
import { BusinessError, generateId, err, ok, type Result } from '@study-studio/shared';
import type { LessonValidationIssue } from './validate-lesson-content.js';

export function normalizeLessonProposal(raw: unknown, identity: Pick<LessonSubmission, 'documentId' | 'lessonId' | 'assignmentId'> & { sourceBlocks?: readonly ChapterSourceBlock[] }): Result<{ submission: LessonSubmission; issues: LessonValidationIssue[] }, BusinessError> {
  const parsed = LessonProposalSchema.safeParse(raw);
  if (!parsed.success) return err(new BusinessError('E_LLM_SCHEMA_INVALID', `章节字段格式不符合要求（${parsed.error.issues.length} 项）；请修正 ${parsed.error.issues[0]?.path.join('.') || '提交结构'}`, 'VALIDATION', true, parsed.error.issues));
  const draft = parsed.data.content;
  const issues: Array<{ path: string; message: string; index: number; length: number }> = [];
  const check = (values: number[], length: number, path: string) => {
    values.forEach((value, position) => { if (value >= length) issues.push({ path: `${path}.${position}`, message: '引用下标超出本次内容数组', index: value, length }); });
  };
  draft.exercises.forEach((item, position) => {
    const path = `content.exercises.${position}`;
    check(item.knowledgePointIndexes, draft.knowledgePoints.length, `${path}.knowledgePointIndexes`);
    check(item.answer.optionIndexes ?? [], item.options?.length ?? 0, `${path}.answer.optionIndexes`);
    item.answer.pairs?.forEach((pair, pairIndex) => {
      check([pair.leftIndex], item.left?.length ?? 0, `${path}.answer.pairs.${pairIndex}.leftIndex`);
      check([pair.rightIndex], item.right?.length ?? 0, `${path}.answer.pairs.${pairIndex}.rightIndex`);
    });
  });
  if (issues.length) return err(new BusinessError('E_LLM_SCHEMA_INVALID', `内容关联下标不正确；请修正 ${issues[0]?.path}`, 'VALIDATION', true, issues));
  const sourceIssues: LessonValidationIssue[] = [];
  const blocks = new Map(identity.sourceBlocks?.map(block => [block.id, block]));
  const identify = <T extends { sourceRefs?: LessonProposal['content']['blocks'][number]['sourceRefs'] }>(item: T, path: string) => {
    const { sourceRefs, ...rest } = item;
    const resolved: ContentSourceReference[] = [];
    sourceRefs?.forEach((ref, index) => {
      const block = blocks.get(ref.blockId);
      if (!block || (ref.row !== undefined && (block.kind !== 'TABLE' || !block.rows || ref.row >= block.rows.length))) {
        sourceIssues.push({ code: 'E_SOURCE_REFERENCE_INVALID', path: `${path}.sourceRefs.${index}`, message: '来源引用不属于当前章节材料或表格行无效', received: ref,
          expected: block ? { blockId: block.id, rowCount: block.rows?.length ?? 0 } : [...blocks.keys()] });
      } else resolved.push({ ...ref, page: block.page });
    });
    return { ...rest, id: generateId('content'), ...(sourceRefs ? { sourceRefs: resolved } : {}) };
  };
  const points = draft.knowledgePoints.map((item, index) => ({ ...identify(item, `content.knowledgePoints.${index}`), examples: item.examples.map((example, position) => identify(example, `content.knowledgePoints.${index}.examples.${position}`)) }));
  const content: LessonContent = {
    ...draft, blocks: draft.blocks.map((item, index) => identify(item, `content.blocks.${index}`)),
    vocabularies: draft.vocabularies.map((item, index) => ({ ...identify(item, `content.vocabularies.${index}`), examples: item.examples.map((example, position) => identify(example, `content.vocabularies.${index}.examples.${position}`)) })),
    knowledgePoints: points,
    exercises: draft.exercises.map(({ knowledgePointIndexes, options, left, right, answer, ...item }, position) => {
      const option = (value: { text: string }) => ({ ...value, id: generateId('content') });
      const choices = options?.map(option), leftItems = left?.map(option), rightItems = right?.map(option);
      return { ...identify(item, `content.exercises.${position}`), knowledgePointIds: knowledgePointIndexes.map(index => points[index]!.id),
        ...(choices ? { options: choices } : {}), ...(leftItems ? { left: leftItems } : {}), ...(rightItems ? { right: rightItems } : {}),
        answer: { ...(answer.text ? { text: answer.text } : {}),
          ...(answer.optionIndexes ? { optionIds: answer.optionIndexes.map(index => choices![index]!.id) } : {}),
          ...(answer.pairs ? { pairs: answer.pairs.map(pair => ({ leftId: leftItems![pair.leftIndex]!.id, rightId: rightItems![pair.rightIndex]!.id })) } : {}),
        },
      };
    }),
  };
  return ok({ submission: { documentId: identity.documentId, lessonId: identity.lessonId, assignmentId: identity.assignmentId, content }, issues: sourceIssues });
}
