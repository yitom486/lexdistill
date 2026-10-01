import { LessonProposalSchema, type LessonContent, type LessonSubmission } from '@study-studio/document-model';
import { BusinessError, generateId, err, ok, type Result } from '@study-studio/shared';

export function normalizeLessonProposal(raw: unknown, identity: Pick<LessonSubmission, 'documentId' | 'lessonId' | 'assignmentId'>): Result<LessonSubmission, BusinessError> {
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
  const identify = <T extends object>(item: T) => ({ ...item, id: generateId('content') });
  const points = draft.knowledgePoints.map(item => ({ ...identify(item), examples: item.examples.map(identify) }));
  const content: LessonContent = {
    ...draft, blocks: draft.blocks.map(identify),
    vocabularies: draft.vocabularies.map(item => ({ ...identify(item), examples: item.examples.map(identify) })),
    knowledgePoints: points,
    exercises: draft.exercises.map(({ knowledgePointIndexes, options, left, right, answer, ...item }) => {
      const choices = options?.map(identify), leftItems = left?.map(identify), rightItems = right?.map(identify);
      return { ...identify(item), knowledgePointIds: knowledgePointIndexes.map(index => points[index]!.id),
        ...(choices ? { options: choices } : {}), ...(leftItems ? { left: leftItems } : {}), ...(rightItems ? { right: rightItems } : {}),
        answer: { ...(answer.text ? { text: answer.text } : {}),
          ...(answer.optionIndexes ? { optionIds: answer.optionIndexes.map(index => choices![index]!.id) } : {}),
          ...(answer.pairs ? { pairs: answer.pairs.map(pair => ({ leftId: leftItems![pair.leftIndex]!.id, rightId: rightItems![pair.rightIndex]!.id })) } : {}),
        },
      };
    }),
  };
  return ok({ documentId: identity.documentId, lessonId: identity.lessonId, assignmentId: identity.assignmentId, content });
}
