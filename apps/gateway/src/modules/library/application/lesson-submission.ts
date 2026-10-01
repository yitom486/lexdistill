import { LessonSubmissionSchema, type LessonSubmission as SubmissionInput, type TocEntry, type ChapterSourceBlock } from '@study-studio/document-model';
import { BusinessError, err, translateToBusinessError, type Result } from '@study-studio/shared';
import type { ContentRepository, CommitLessonKnowledgeOutput } from '../ports.js';
import type { ImportMonitor } from './import-monitor.js';
import { normalizeLessonProposal } from './normalize-lesson-proposal.js';
import { validateLessonContent, type LessonValidationIssue } from './validate-lesson-content.js';

export interface LessonAssignment {
  userId: string;
  documentId: string;
  lessonId: string;
  assignmentId: string;
  tocEntries: readonly TocEntry[];
  sourceBlocks?: readonly ChapterSourceBlock[];
  signal: AbortSignal;
  turnSignal?: AbortSignal;
  allowAiExercises: boolean;
  monitor?: ImportMonitor;
  sessionId?: string;
  toolRepairRetries?: number;
  onRepairLimit?: (error: BusinessError) => void;
  onStage?: (stage: 'validating' | 'correcting' | 'saving' | 'saved') => void;
}
export class LessonSubmission {
  nativeTurnId: string | undefined;
  candidate: SubmissionInput | undefined;
  receipt: CommitLessonKnowledgeOutput | undefined;
  error: BusinessError | undefined;
  private inFlight: Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> | undefined;
  private candidateCallId: string | undefined;
  private rejectedCount = 0;
  constructor(readonly assignment: LessonAssignment, private readonly repo: ContentRepository) {}

  async acceptProposal(raw: unknown, turnId: string | undefined, callId?: string): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    if (!turnId || turnId !== this.nativeTurnId) return this.reject('E_SUBMISSION_SCOPE_INVALID', '该工具调用不属于当前章节的运行轮次，已拒绝迟到提交', false, undefined, callId);
    if (this.assignment.signal.aborted || this.assignment.turnSignal?.aborted) return this.reject('E_CANCELLED', '本次章节尝试已结束，不能继续提交', false, undefined, callId);
    this.note('tool', 'proposal', raw, callId);
    const normalized = normalizeLessonProposal(raw, this.assignment);
    const result = await (normalized.ok ? this.accept(normalized.value.submission, callId, normalized.value.issues) : this.reject(normalized.error.code, normalized.error.userMessage, true, normalized.error.internalDetails, callId));
    if (!result.ok && result.error.category === 'VALIDATION' && result.error.retryable && this.assignment.toolRepairRetries !== undefined && ++this.rejectedCount > this.assignment.toolRepairRetries) {
      this.error = new BusinessError('E_TOOL_REPAIR_LIMIT', `本轮工具修正次数已用尽（${this.assignment.toolRepairRetries} 次）；最后问题：${result.error.userMessage}`, 'VALIDATION', true,
        { rejectedCount: this.rejectedCount, repairRetries: this.assignment.toolRepairRetries, lastFailure: { code: result.error.code, message: result.error.userMessage, details: result.error.internalDetails } });
      this.note('validation', 'repair_limit', { code: this.error.code, message: this.error.userMessage, retryable: true, details: this.error.internalDetails }, callId);
      this.assignment.onRepairLimit?.(this.error);
      return err(this.error);
    }
    return result;
  }

  accept(raw: unknown, callId?: string, sourceIssues: LessonValidationIssue[] = []): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    const startedAt = Date.now();
    const reject = (code: string, message: string, details: unknown, retryable = true) => this.reject(code, message, retryable, { details, elapsedMs: Date.now() - startedAt }, callId);
    const passed = (check: string, details?: unknown) => this.note('validation', 'check_passed', { check, details, elapsedMs: Date.now() - startedAt }, callId);
    this.note('tool', 'candidate', raw, callId);
    if (this.assignment.signal.aborted || this.assignment.turnSignal?.aborted) return reject('E_CANCELLED', '本次章节尝试已结束，不能继续提交', undefined, false);
    this.assignment.onStage?.('validating');
    const parsed = LessonSubmissionSchema.safeParse(raw);
    if (!parsed.success) return reject('E_LLM_SCHEMA_INVALID', `章节字段格式不符合要求（${parsed.error.issues.length} 项）；请修正 ${parsed.error.issues[0]?.path.join('.') || '提交结构'}`, parsed.error.issues);
    passed('field_format');
    const value = parsed.data;
    const task = this.assignment;
    const mismatches = (['documentId', 'lessonId', 'assignmentId'] as const).filter(key => value[key] !== task[key]).map(path => ({ path, expected: task[path], received: value[path] }));
    if (mismatches.length) return reject('E_SUBMISSION_SCOPE_INVALID', `当前任务身份不一致：${mismatches.map(item => `${item.path} 应为 ${item.expected}，收到 ${item.received}`).join('；')}`, mismatches);
    passed('task_identity');
    if (this.receipt) return Promise.resolve({ ok: true, value: this.receipt });
    if (this.inFlight) return this.inFlight;
    if (this.candidate && this.error) return Promise.resolve(err(this.error));
    const content = value.content;
    const issues = validateLessonContent(content, task, sourceIssues);
    if (issues.length) return reject(issues[0]!.code, `章节校验未通过（${issues.length} 项）：${issues.slice(0, 3).map(issue => `${issue.path}：${issue.message}`).join('；')}`, { issues });
    passed('directory_membership'); passed('directory_coverage'); passed('content_format');
    if (task.sourceBlocks) passed('source_references', { blockCount: task.sourceBlocks.length, semanticAccuracyVerified: false });
    this.candidate ??= value;
    this.candidateCallId = callId;
    this.note('validation', 'accepted', { coverage: content.coverage, elapsedMs: Date.now() - startedAt }, callId);
    return this.persist();
  }
  private reject(code: string, message: string, retryable: boolean, details?: unknown, callId?: string): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    this.note('validation', 'rejected', { code, message, retryable, details }, callId);
    this.error = new BusinessError(code, message, 'VALIDATION', retryable, details);
    if (retryable) this.assignment.onStage?.('correcting');
    return Promise.resolve(err(this.error));
  }
  /** 暂时性数据库错误由调度器重试这里；不重新调用模型。 */
  persist(): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    if (this.assignment.signal.aborted) return this.reject('E_CANCELLED', '本次教材任务已结束', false);
    if (this.receipt) return Promise.resolve({ ok: true, value: this.receipt });
    if (this.inFlight) return this.inFlight;
    if (!this.candidate) return this.reject('E_LESSON_SUBMISSION_MISSING', '模型未通过原生工具提交有效章节内容', true);
    this.assignment.onStage?.('saving');
    const value = this.candidate;
    this.note('storage', 'commit_requested', { documentId: value.documentId, nodeId: value.lessonId });
    this.inFlight = this.repo.commitLessonKnowledge({ documentId: value.documentId, lessonId: value.lessonId, submissionId: value.assignmentId, content: value.content,
      onTransaction: phase => this.note('storage', `transaction_${phase}`, { documentId: value.documentId, nodeId: value.lessonId }),
    }).then(result => {
      if (result.ok) {
        this.note('storage', 'committed', result.value);
        this.receipt = result.value;
        this.error = undefined;
        this.assignment.onStage?.('saved');
      } else { this.error = result.error; this.note('storage', 'commit_failed', { code: result.error.code, message: result.error.userMessage }); }
      return result;
    }).catch(cause => {
      this.error = translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '章节保存失败，已校验内容保留，可重试保存' });
      this.note('storage', 'commit_failed', { code: this.error.code, message: this.error.userMessage });
      return err(this.error);
    }).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  private note(category: 'tool' | 'validation' | 'storage', name: string, detail: unknown, callId = this.candidateCallId): void {
    this.assignment.monitor?.record(category, name, detail, { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId, ...(this.assignment.sessionId ? { sessionId: this.assignment.sessionId } : {}), ...(callId ? { callId } : {}) });
  }
}
