import { LessonSubmissionSchema, type LessonSubmission as SubmissionInput } from '@study-studio/document-model';
import { ToolLocations, ToolPermissions, type ToolDefinition, type ToolExecutionContext } from '@study-studio/tool-core';
import { BusinessError, err, type Result } from '@study-studio/shared';
import type { ContentRepository, CommitLessonKnowledgeOutput } from '../ports.js';
import { LessonSubmission, type LessonAssignment } from '../application/lesson-submission.js';

export const LibraryLessonCommitInputSchema = LessonSubmissionSchema;
export type LibraryLessonCommitInput = SubmissionInput;
export type LibraryLessonCommitOutput = CommitLessonKnowledgeOutput;

/** 执行端第二道门：只有已绑定的专职会话可以写入当前章。 */
export class LibraryLessonCommitTool implements ToolDefinition<SubmissionInput, CommitLessonKnowledgeOutput> {
  readonly name = 'library.commit_lesson_knowledge';
  readonly description = '提交当前任务的结构化教材内容。documentId、lessonId、assignmentId 原样使用当前输入，不能复用上一轮身份。coverage 逐项报告本任务目录；纯容器汇总子节点，lesson/section 必须有对应原书内容。blocks.text 仅课文或对话，translation 独立存译文；讲解和例句不能混进正文。当前输入有解析块时，原书内容及原书例句必须填 sourceRefs，引用实际 blockId、物理 page，表格可注明从 0 起的 row；引用合法仅证明定位。按页读取生词表，不跨页串行合并词条；核对原页上的读音和音调，无法确认的音调省略，不能把编号猜成声调类型。vocabularies.gloss 存词义，aiExplanation 单独存 AI 生词讲解，examples 存例句。knowledgePoints.textbookExplanation 只存原书讲解，aiExplanation 存 AI 补充，examples 单独存例句。全部内容含例句必须有当前目录内的 tocId；AI 新增内容至少关联任务根节点。原书内容 source=TEXTBOOK，新增内容 source=AI；翻译、注音、词义、接续、答案和解析的来源写 fieldSources。习题用已声明题型，答案对应 text、optionIds 或 pairs，可新增 AI 练习且无须原目录存在练习项。UNREADABLE 和缺项不能算完成。校验拒绝后按具体字段和当前身份修正，再调用本工具；回执确认事务提交才算保存成功。暂时性数据库失败由调度器仅重试保存。';
  readonly location = ToolLocations.SERVER;
  readonly permission = ToolPermissions.WRITE;
  readonly schema = LessonSubmissionSchema;
  private readonly bindings = new Map<string, LessonSubmission>();
  constructor(private readonly repo: ContentRepository) {}
  bind(sessionId: string, assignment: LessonAssignment): LessonSubmission {
    if (this.bindings.has(sessionId)) throw new BusinessError('E_SUBMISSION_SCOPE_INVALID', '章节会话仍有未结束的绑定', 'AGENT_RUNTIME');
    const submission = new LessonSubmission(assignment, this.repo);
    this.bindings.set(sessionId, submission);
    return submission;
  }
  end(sessionId: string): void { this.bindings.delete(sessionId); }
  execute(input: unknown, context: ToolExecutionContext): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    const submission = this.bindings.get(context.sessionId);
    if (!submission || submission.assignment.userId !== context.userId) return Promise.resolve(err(new BusinessError('E_SUBMISSION_SCOPE_INVALID', '该会话没有当前用户的章节提交权限', 'VALIDATION')));
    return submission.accept(input, context.callId);
  }
}
