import { TextbookContentOperationSchemas, JlptLevelSchema, type TextbookContentKind } from '@lexdistill/document-model';
import { BusinessError, err, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import { ToolLocations, ToolPermissions, type ToolDefinition, type ToolExecutionContext } from '@lexdistill/tool-core';
import type { ContentRepository, CommitLessonKnowledgeOutput } from '../ports.js';
import type { ImportMonitor } from '../application/import-monitor.js';
import { LessonContentBuffer, type BufferedContentReceipt } from './lesson-content-buffer.js';

export interface ChapterContentAssignment {
  userId: string; documentId: string; lessonId: string; assignmentId: string;
  signal: AbortSignal; turnSignal?: AbortSignal; allowAiExercises: boolean;
  replaceContent?: boolean;
  monitor?: ImportMonitor; sessionId?: string; toolRepairRetries?: number;
  onRepairLimit?: (error: BusinessError) => void;
  onStage?: (stage: 'validating' | 'correcting' | 'saving' | 'saved' | 'extracting') => void;
}
const descriptions: Record<TextbookContentKind, string> = {
  grammar: '管理本课知识点、用法或发音知识。explanation 为规则说明，aiExplanation 为独立的 AI 补充，UI 按 Markdown 渲染这两个字段，可用段落、列表、加粗和表格；卡片已展示 title，说明不必重复大标题。title、connection 和 examples 的 text/translation 按普通文本展示，例句单独填写，不混进说明。',
  vocabulary: '管理本课词汇。填写词面、读音、释义及估计等级 ' + JlptLevelSchema.options.join('|') + '，可提供词性、讲解和例句。explanation 按 Markdown 渲染；word、reading、meaning、partOfSpeech、pitch 和例句 text/translation 按普通文本展示，讲解不要混入释义。最终事务新增全局缺失词，已有词复用、不覆盖。等级不是掌握度。',
  exercises: '管理本课练习。填写题型、题干、difficultyTier（复杂度 1–5）及 difficultyReason。选择题和排序题均需 options（至少两项），待排序词块不能只写在题干里。单选 answer 用一个选项文字，多选用选项文字数组；排序 answer 用全部词块的有序数组，重复词块的次数与 options 一致。配对用左右文字配对，可复用右项；多空答案按空位顺序。翻译、简答和写作提供 gradingNotes，参考表达可省略。新增练习标注 source=AI。',
  articles: '管理本课完整文章或会话。title、text、translation 按普通文本展示，不添加 Markdown 标记；正文和译文分开填写，换行分段。若为会话对白，正文与译文各行均按「说话人：台词/译文」格式规范记录，以便角色扮演与分角色发音。保留完整语境，不逐行拆成文章。没有文章无需调用。',
  sentences: '管理本课可独立学习的句子或单句对白。explanation 按 Markdown 渲染，可用段落、列表和加粗；text、translation、speaker 按普通文本展示，若为对话可填写 speaker（说话人）。句子和译文分开填写。没有句子无需调用。',
  material: '管理本课的一份整理材料，items 中填写 text。UI 按保留换行的普通文本展示，不解析 Markdown；保留有意义的结构，使用文本标题和分行。没有材料无需调用。',
};
const names: Record<TextbookContentKind, string> = { grammar: 'knowledge', vocabulary: 'vocabulary', exercises: 'exercises', articles: 'articles', sentences: 'sentences', material: 'material' };

export class ChapterContentSubmission {
  nativeTurnId: string | undefined;
  candidate = false;
  receipt: CommitLessonKnowledgeOutput | undefined;
  error: BusinessError | undefined;
  private buffer: LessonContentBuffer | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly calls = new Map<string, { key: string; result: Result<BufferedContentReceipt, BusinessError> }>();
  private readonly rejected = new Set<string>();
  private rejectedCount = 0;
  private sealed = false;
  constructor(readonly assignment: ChapterContentAssignment, private readonly repo: ContentRepository) {}
  private get scope() { return { userId: this.assignment.userId, documentId: this.assignment.documentId, chapterId: this.assignment.lessonId }; }
  private guard(context?: ToolExecutionContext): BusinessError | undefined {
    if (context && (context.userId !== this.assignment.userId || !context.turnId || context.turnId !== this.nativeTurnId)) return new BusinessError('E_SUBMISSION_SCOPE_INVALID', '该调用不属于当前课程的模型轮次', 'VALIDATION');
    if (this.assignment.signal.aborted || this.assignment.turnSignal?.aborted) return new BusinessError('E_CANCELLED', '本次课程处理已经结束，迟到调用已拒绝', 'VALIDATION');
    return undefined;
  }
  execute(kind: TextbookContentKind, input: unknown, context: ToolExecutionContext): Promise<Result<BufferedContentReceipt, BusinessError>> {
    const guard = this.guard(context);
    if (guard) return Promise.resolve(err(guard));
    if (this.sealed) return Promise.resolve(err(new BusinessError('E_SUBMISSION_CLOSED', '本课内容已结束接收，迟到调用已拒绝', 'VALIDATION')));
    const run = this.queue.then(() => this.apply(kind, input, context));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
  private async apply(kind: TextbookContentKind, input: unknown, context: ToolExecutionContext): Promise<Result<BufferedContentReceipt, BusinessError>> {
    const guard = this.guard(context); if (guard) return err(guard);
    const key = JSON.stringify([kind, input]);
    const prior = context.callId ? this.calls.get(context.callId) : undefined;
    if (prior) return prior.key === key ? prior.result : err(new BusinessError('E_CONTENT_CALL_CONFLICT', '同一工具调用的内容发生冲突，请重新提交', 'VALIDATION'));
    const action = typeof input === 'object' && input !== null && 'action' in input ? String(input.action) : 'add';
    const category = kind + ':' + action;
    const binding = { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId, ...(context.callId ? { callId: context.callId } : {}), ...(this.assignment.sessionId ? { sessionId: this.assignment.sessionId } : {}) };
    let result: Result<BufferedContentReceipt, BusinessError>;
    try {
      if (!this.buffer) {
        const existing = await this.repo.readTextbookChapter(this.scope);
        if (!existing.ok) { this.error = existing.error; return existing; }
        this.buffer = new LessonContentBuffer(existing.value, this.assignment.replaceContent);
      }
      const cancelled = this.guard(context); if (cancelled) return err(cancelled);
      this.assignment.onStage?.('validating');
      const value = this.buffer.apply(kind, input, this.assignment.allowAiExercises);
      result = ok(value); this.rejected.delete(category);
      if (value.status === 'staged') this.candidate = true;
      if (!this.rejected.size) this.error = undefined;
      this.assignment.monitor?.record('storage', value.status === 'staged' ? 'content_staged' : 'content_view', value, binding);
      this.assignment.onStage?.('extracting');
    } catch (cause) {
      const error = translateToBusinessError(cause, 'stageLessonContent');
      this.error = error; result = err(error); this.rejected.add(category);
      this.assignment.onStage?.('correcting');
      this.assignment.monitor?.record('validation', 'rejected', { code: error.code, message: error.userMessage, details: error.internalDetails }, binding);
      if (error.retryable && this.assignment.toolRepairRetries !== undefined && ++this.rejectedCount > this.assignment.toolRepairRetries) {
        this.error = new BusinessError('E_TOOL_REPAIR_LIMIT', '本轮内容修正次数已用尽', 'VALIDATION', true);
        this.assignment.onRepairLimit?.(this.error); result = err(this.error);
      }
    }
    if (context.callId) this.calls.set(context.callId, { key, result });
    return result;
  }
  async persist(): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    this.sealed = true; await this.queue;
    if (this.receipt) return ok(this.receipt);
    const guard = this.guard(); if (guard) return err(guard);
    if (!this.buffer?.hasSubmittedContent()) {
      this.error = new BusinessError('E_LESSON_CONTENT_MISSING', '本章尚未提交有效学习内容，请按实际内容调用对应工具', 'VALIDATION', true);
      this.assignment.monitor?.record('validation', 'rejected', { code: this.error.code, message: this.error.userMessage, details: this.error.internalDetails },
        { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId, ...(this.assignment.sessionId ? { sessionId: this.assignment.sessionId } : {}) });
      return err(this.error);
    }
    if (this.rejected.size) return err(this.error ?? new BusinessError('E_CONTENT_FORMAT_INVALID', '仍有未修正的内容操作', 'VALIDATION', true));
    this.assignment.onStage?.('saving');
    const result = await this.repo.commitTextbookLesson(this.scope, this.buffer.changes);
    if (result.ok) {
      this.receipt = result.value; this.error = undefined;
      this.assignment.monitor?.record('storage', 'committed', result.value, { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId, ...(this.assignment.sessionId ? { sessionId: this.assignment.sessionId } : {}) });
      this.assignment.onStage?.('saved');
    } else {
      this.error = result.error;
      this.assignment.monitor?.record('storage', 'commit_failed', { code: result.error.code, message: result.error.userMessage }, { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId });
    }
    return result;
  }
}
export class TextbookContentTool implements ToolDefinition<unknown, unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema;
  readonly location = ToolLocations.SERVER;
  readonly permission = ToolPermissions.WRITE;
  constructor(readonly owner: TextbookContentTools, readonly kind: TextbookContentKind) {
    this.name = 'library.' + names[kind];
    this.description = descriptions[kind] + (kind === 'exercises' ? ' 本工具的题干、选项、答案、explanation 和 gradingNotes 使用普通文本，不加 Markdown 标记；题型由交互组件渲染。' : '') + ' Markdown 仅写在声明支持的字段中，不输出 HTML，不把整个字段包在 Markdown 代码围栏中。可选字段没有值就省略，不填空字符串。action 默认 add；read 查询当前课视图；update 在 items 中填回执 ref 和完整内容；delete 填 refs。新增不填 ref；已有相同内容先 read 后 update，不重复新增。ref 仅当前章当前尝试有效，重试后先 read 获取新 ref，不沿用上一轮引用。调用只暂存，模型正常结束后系统统一事务保存；不填写数据库身份或页码。';
    this.schema = TextbookContentOperationSchemas[kind];
  }
  async execute(input: unknown, context: ToolExecutionContext): Promise<Result<unknown, BusinessError>> {
    const binding = this.owner.get(context.sessionId);
    if (!binding) return err(new BusinessError('E_SUBMISSION_SCOPE_INVALID', '该会话没有课程内容工具权限', 'VALIDATION'));
    return binding.execute(this.kind, input, context);
  }
}
export class TextbookContentTools {
  readonly tools: TextbookContentTool[];
  private readonly bindings = new Map<string, ChapterContentSubmission>();
  constructor(private readonly repo: ContentRepository) {
    this.tools = (Object.keys(TextbookContentOperationSchemas) as TextbookContentKind[]).map(kind => new TextbookContentTool(this, kind));
  }
  get(sessionId: string) { return this.bindings.get(sessionId); }
  bind(sessionId: string, assignment: ChapterContentAssignment) {
    if (this.bindings.has(sessionId)) throw new BusinessError('E_SUBMISSION_SCOPE_INVALID', '课程会话仍在处理上一项任务', 'AGENT_RUNTIME');
    const binding = new ChapterContentSubmission(assignment, this.repo); this.bindings.set(sessionId, binding); return binding;
  }
  startTurn(sessionId: string, assignmentId: string, turnId: string) {
    const binding = this.bindings.get(sessionId);
    if (binding?.assignment.assignmentId === assignmentId && !binding.assignment.turnSignal?.aborted) binding.nativeTurnId = turnId;
  }
  end(sessionId: string) { this.bindings.delete(sessionId); }
}
