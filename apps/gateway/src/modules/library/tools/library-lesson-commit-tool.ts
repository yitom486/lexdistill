import { LessonProposalSchema, LessonContentSchema, ContentSourceSchema, ExerciseTypeSchema, FieldSourcesSchema, type LessonProposal as SubmissionInput } from '@study-studio/document-model';
import { ToolLocations, ToolPermissions, type ToolDefinition, type ToolExecutionContext } from '@study-studio/tool-core';
import { BusinessError, err, type Result } from '@study-studio/shared';
import type { ContentRepository, CommitLessonKnowledgeOutput } from '../ports.js';
import { LessonSubmission, type LessonAssignment } from '../application/lesson-submission.js';

export const LibraryLessonCommitInputSchema = LessonProposalSchema;
export type LibraryLessonCommitInput = SubmissionInput;
export type LibraryLessonCommitOutput = CommitLessonKnowledgeOutput;

/** 执行端第二道门：只有已绑定的专职会话可以写入当前章。 */
export class LibraryLessonCommitTool implements ToolDefinition<SubmissionInput, CommitLessonKnowledgeOutput> {
  readonly name = 'library.commit_lesson_knowledge';
  readonly description = `提交当前章，只提交 content，不提交任务或内容 id。全部内容和例句必填当前目录 tocId。coverage.status=${LessonContentSchema.shape.coverage.element.shape.status.options.join('|')}，逐项覆盖当前目录；无法辨认不能算完成。blocks.kind=${LessonContentSchema.shape.blocks.element.shape.kind.options.join('|')}；DIALOGUE 必填 speaker，text 仅正文/对话，讲解和例句独立存放。source=${ContentSourceSchema.options.join('|')}，原书 TEXTBOOK、新增 AI。当前有解析材料时，每条原书内容和原书例句必填 sourceRefs，只选实际 blockId、可选表格 row（从 0 起），不要 page，系统映射物理页；不得引用别章。vocabularies 用 surface、reading、pos、gloss、aiExplanation、examples；knowledgePoints 用 title、connection、textbookExplanation、aiExplanation、examples。原书讲解与 AI 补充分别存放；无法确认的音调省略，不把编号当音调，生词表不跨页串行合并。fieldSources 仅允许 ${Object.keys(FieldSourcesSchema.shape).join('|')}，有对应译文/读音/释义/接续/答案/解析必须标注来源，不填写空字符串或 null；可选字段无内容则省略。exercises.type=${ExerciseTypeSchema.options.join('|')}；options/left/right 每项只含 text；knowledgePointIndexes 引用本次知识点数组。CHOICE 单答案、MULTI_CHOICE 多答案、ORDERING 全部有序答案，用 answer.optionIndexes；MATCHING 用 answer.pairs 的 leftIndex/rightIndex；其他用 answer.text，均从 0 起。AI 练习无须原目录存在习题项。拒绝后按回执中全部字段路径修正，再提交；只有事务提交回执才算已保存，数据库暂错由系统仅重试保存。`;
  readonly location = ToolLocations.SERVER;
  readonly permission = ToolPermissions.WRITE;
  readonly schema = LessonProposalSchema;
  private readonly bindings = new Map<string, LessonSubmission>();
  constructor(private readonly repo: ContentRepository) {}
  bind(sessionId: string, assignment: LessonAssignment): LessonSubmission {
    if (this.bindings.has(sessionId)) throw new BusinessError('E_SUBMISSION_SCOPE_INVALID', '章节会话仍有未结束的绑定', 'AGENT_RUNTIME');
    const submission = new LessonSubmission(assignment, this.repo);
    this.bindings.set(sessionId, submission);
    return submission;
  }
  end(sessionId: string): void { this.bindings.delete(sessionId); }
  startTurn(sessionId: string, assignmentId: string, turnId: string): void {
    const submission = this.bindings.get(sessionId);
    if (submission?.assignment.assignmentId === assignmentId && !submission.assignment.turnSignal?.aborted) submission.nativeTurnId = turnId;
  }
  execute(input: unknown, context: ToolExecutionContext): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    const submission = this.bindings.get(context.sessionId);
    if (!submission || submission.assignment.userId !== context.userId) return Promise.resolve(err(new BusinessError('E_SUBMISSION_SCOPE_INVALID', '该会话没有当前用户的章节提交权限', 'VALIDATION')));
    return submission.acceptProposal(input, context.turnId, context.callId);
  }
}
