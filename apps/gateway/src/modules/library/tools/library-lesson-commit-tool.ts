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
  readonly description = '整理当前章文字，按目录 ID 逐项报告覆盖；通过本工具提交结构化段落、对话、生词、知识点及习题。不可编造课次或目录 ID。原书内容标 TEXTBOOK；新增讲解独立写 aiExplanation；AI 习题标 AI，可关联当前章，无须原目录存在练习项。翻译、答案和解析填写字段来源。答案按题型填写 text、optionIds 或 pairs。UNREADABLE 和缺项不算完成。只有回执确认保存才算成功；按失败详情修正，暂时性数据库失败由调度器重试保存。';
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
    return submission.accept(input);
  }
}
