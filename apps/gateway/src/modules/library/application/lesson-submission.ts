import { LessonSubmissionSchema, lessonContentIssues, type LessonSubmission as SubmissionInput, type TocEntry, type ChapterSourceBlock } from '@study-studio/document-model';
import { BusinessError, err, translateToBusinessError, type Result } from '@study-studio/shared';
import type { ContentRepository, CommitLessonKnowledgeOutput } from '../ports.js';
import type { ImportMonitor } from './import-monitor.js';
import { normalizeLessonProposal } from './normalize-lesson-proposal.js';

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
  onStage?: (stage: 'validating' | 'correcting' | 'saving' | 'saved') => void;
}
export class LessonSubmission {
  nativeTurnId: string | undefined;
  candidate: SubmissionInput | undefined;
  receipt: CommitLessonKnowledgeOutput | undefined;
  error: BusinessError | undefined;
  private inFlight: Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> | undefined;
  private candidateCallId: string | undefined;
  constructor(readonly assignment: LessonAssignment, private readonly repo: ContentRepository) {}

  acceptProposal(raw: unknown, turnId: string | undefined, callId?: string): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    if (!turnId || turnId !== this.nativeTurnId) return this.reject('E_SUBMISSION_SCOPE_INVALID', '该工具调用不属于当前章节的运行轮次，已拒绝迟到提交', false, undefined, callId);
    this.note('tool', 'proposal', raw, callId);
    const normalized = normalizeLessonProposal(raw, this.assignment);
    if (!normalized.ok) return this.reject(normalized.error.code, normalized.error.userMessage, true, normalized.error.internalDetails, callId);
    return this.accept(normalized.value, callId);
  }

  accept(raw: unknown, callId?: string): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
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
    const ids = new Set(task.tocEntries.map(entry => entry.id));
    const content = value.content;
    const items = [...content.blocks, ...content.vocabularies, ...content.knowledgePoints, ...content.exercises, ...content.vocabularies.flatMap(item => item.examples), ...content.knowledgePoints.flatMap(item => item.examples)];
    const outsideIds = [...new Set([...content.coverage, ...items].flatMap(item => item.tocId && !ids.has(item.tocId) ? [item.tocId] : []))];
    if (outsideIds.length) return reject('E_TOC_SLOT_NOT_FOUND', `内容关联了当前目录之外的 ID：${outsideIds.join('、')}`, { expected: [...ids], received: outsideIds });
    const missingLinks = items.filter(item => !item.tocId).map(item => item.id);
    if (missingLinks.length) return reject('E_LLM_SCHEMA_INVALID', '全部内容及例句必须关联当前目录 ID', { itemIds: missingLinks, expected: [...ids] });
    passed('directory_membership');
    if (task.sourceBlocks) {
      const blocks = new Map(task.sourceBlocks.map(block => [block.id, block]));
      const invalid: Array<{ itemId: string; reason: string }> = [];
      for (const item of items) {
        if (item.source === 'TEXTBOOK' && !item.sourceRefs?.length) invalid.push({ itemId: item.id, reason: '原书内容缺少 sourceRefs' });
        for (const ref of item.sourceRefs ?? []) {
          const block = blocks.get(ref.blockId);
          if (!block || block.page !== ref.page || (ref.row !== undefined && (block.kind !== 'TABLE' || !block.rows || ref.row >= block.rows.length))) invalid.push({ itemId: item.id, reason: `无效引用 ${ref.blockId} / 第 ${ref.page} 页${ref.row !== undefined ? ' / 行 ' + ref.row : ''}` });
        }
      }
      if (invalid.length) return reject('E_SOURCE_REFERENCE_INVALID', `来源引用不属于当前章节材料：${invalid.slice(0, 3).map(issue => issue.itemId + '：' + issue.reason).join('；')}`, { invalid, availableBlocks: task.sourceBlocks.map(block => ({ id: block.id, page: block.page, rows: block.rows?.length ?? null })) });
      passed('source_references', { blockCount: blocks.size, semanticAccuracyVerified: false });
    }
    const reported = new Map(content.coverage.map(item => [item.tocId, item.status]));
    const missingCoverage = task.tocEntries.filter(entry => reported.get(entry.id) !== 'EXTRACTED');
    if (missingCoverage.length) return reject('E_TOC_COVERAGE_INCOMPLETE', '当前部分或子目录未逐项提取；无法辨认的内容不能标记已完成', missingCoverage.map(entry => ({ id: entry.id, title: entry.title, received: reported.get(entry.id) ?? null })));
    if (!items.some(item => item.source === 'TEXTBOOK')) return reject('E_TOC_COVERAGE_INCOMPLETE', '章节只有 AI 新增内容，不能据此声明原书已提取', { expected: 'TEXTBOOK' });
    const emptySlots = task.tocEntries.filter(entry => (entry.level === 'lesson' || entry.level === 'section') && !items.some(item => item.source === 'TEXTBOOK' && item.tocId === entry.id));
    if (emptySlots.length) return reject('E_TOC_COVERAGE_INCOMPLETE', '内容目录虽报告已提取，但没有关联的原书内容', emptySlots.map(entry => ({ id: entry.id, title: entry.title })));
    passed('directory_coverage');
    if (!task.allowAiExercises && content.exercises.some(item => item.source === 'AI')) return reject('E_LLM_SCHEMA_INVALID', '当前配置不允许新增 AI 习题', { expected: 'TEXTBOOK' });
    const issues = lessonContentIssues(content);
    if (issues.length) return reject('E_LLM_SCHEMA_INVALID', issues.join('; '), issues);
    passed('content_format');
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
