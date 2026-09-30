import { LessonSubmissionSchema, lessonContentIssues, type LessonSubmission as SubmissionInput, type TocEntry } from '@study-studio/document-model';
import { BusinessError, err, translateToBusinessError, type Result } from '@study-studio/shared';
import type { ContentRepository, CommitLessonKnowledgeOutput } from '../ports.js';

export interface LessonAssignment {
  userId: string;
  documentId: string;
  lessonId: string;
  assignmentId: string;
  tocEntries: readonly TocEntry[];
  signal: AbortSignal;
  allowAiExercises: boolean;
  onStage?: (stage: 'validating' | 'saving' | 'saved') => void;
}
export class LessonSubmission {
  candidate: SubmissionInput | undefined;
  receipt: CommitLessonKnowledgeOutput | undefined;
  error: BusinessError | undefined;
  private inFlight: Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> | undefined;
  constructor(readonly assignment: LessonAssignment, private readonly repo: ContentRepository) {}

  accept(raw: unknown): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    if (this.assignment.signal.aborted) return Promise.resolve(err(new BusinessError('E_CANCELLED', '本次教材任务已结束，不能继续提交', 'VALIDATION')));
    const parsed = LessonSubmissionSchema.safeParse(raw);
    if (!parsed.success) return this.reject('E_LLM_SCHEMA_INVALID', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), true);
    const value = parsed.data;
    const task = this.assignment;
    if (value.documentId !== task.documentId || value.lessonId !== task.lessonId || value.assignmentId !== task.assignmentId) return this.reject('E_SUBMISSION_SCOPE_INVALID', '提交身份不属于当前会话绑定的章节和尝试', false);
    if (this.receipt) return Promise.resolve({ ok: true, value: this.receipt });
    if (this.inFlight) return this.inFlight;
    if (this.candidate && this.error) return Promise.resolve(err(this.error));
    this.assignment.onStage?.('validating');
    const ids = new Set(task.tocEntries.map(entry => entry.id));
    const content = value.content;
    const items = [...content.blocks, ...content.vocabularies, ...content.knowledgePoints, ...content.exercises, ...content.vocabularies.flatMap(item => item.examples), ...content.knowledgePoints.flatMap(item => item.examples)];
    if (content.coverage.some(item => !ids.has(item.tocId)) || items.some(item => item.tocId && !ids.has(item.tocId))) return this.reject('E_TOC_SLOT_NOT_FOUND', '内容关联了当前章节目录之外的 ID', false);
    if (items.some(item => item.source === 'TEXTBOOK' && !item.tocId)) return this.reject('E_LLM_SCHEMA_INVALID', '原书内容必须关联目录 ID', true);
    const reported = new Map(content.coverage.map(item => [item.tocId, item.status]));
    if (task.tocEntries.some(entry => reported.get(entry.id) !== 'EXTRACTED')) return this.reject('E_TOC_COVERAGE_INCOMPLETE', '当前章或子目录未逐项提取；无法辨认的内容不能标记已完成', true);
    if (!items.some(item => item.source === 'TEXTBOOK')) return this.reject('E_TOC_COVERAGE_INCOMPLETE', '章节只有 AI 新增内容，不能据此声明原书已提取', true);
    if (!items.some(item => item.source === 'TEXTBOOK')) return this.reject('E_TOC_COVERAGE_INCOMPLETE', '章节只有 AI 新增内容，不能据此声明原书已提取', true);
    if (task.tocEntries.some(entry => (entry.level === 'lesson' || entry.level === 'section') && !items.some(item => item.source === 'TEXTBOOK' && item.tocId === entry.id))) return this.reject('E_TOC_COVERAGE_INCOMPLETE', '内容目录虽报告已提取，但没有关联的原书内容', true);
    if (!task.allowAiExercises && content.exercises.some(item => item.source === 'AI')) return this.reject('E_LLM_SCHEMA_INVALID', '当前配置不允许新增 AI 习题', true);
    const issues = lessonContentIssues(content);
    if (issues.length) return this.reject('E_LLM_SCHEMA_INVALID', issues.join('; '), true);
    this.candidate ??= value;
    return this.persist();
  }
  private reject(code: string, message: string, retryable: boolean): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    this.error = new BusinessError(code, message, 'VALIDATION', retryable);
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
    this.inFlight = this.repo.commitLessonKnowledge({ documentId: value.documentId, lessonId: value.lessonId, submissionId: value.assignmentId, content: value.content }).then(result => {
      if (result.ok) {
        this.receipt = result.value;
        this.error = undefined;
        this.assignment.onStage?.('saved');
      } else this.error = result.error;
      return result;
    }).catch(cause => {
      this.error = translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '章节保存失败，已校验内容保留，可重试保存' });
      return err(this.error);
    }).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
}
