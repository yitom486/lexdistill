import { z } from 'zod';
import { TextbookWriteSchemas, JlptLevelSchema, type TextbookContentKind } from '@study-studio/document-model';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { ToolLocations, ToolPermissions, type ToolDefinition, type ToolExecutionContext } from '@study-studio/tool-core';
import type { ContentRepository, CommitLessonKnowledgeOutput } from '../ports.js';
import type { ImportMonitor } from '../application/import-monitor.js';
import type { ContentWriteReceipt } from '@study-studio/storage-sqlite';

export interface ChapterContentAssignment {
  userId: string; documentId: string; lessonId: string; assignmentId: string;
  signal: AbortSignal; turnSignal?: AbortSignal; allowAiExercises: boolean;
  monitor?: ImportMonitor; sessionId?: string; toolRepairRetries?: number;
  onRepairLimit?: (error: BusinessError) => void;
  onStage?: (stage: 'validating' | 'correcting' | 'saving' | 'saved' | 'extracting') => void;
}
const descriptions: Record<TextbookContentKind, string> = {
  grammar: '保存本章语法、用法或发音知识列表。填写标题、说明和例句；AI 补充讲解放 aiExplanation。一次可保存多项。',
  vocabulary: `保存本章词汇列表。填写词面、读音、释义及估计等级 ${JlptLevelSchema.options.join('|')}，可提供词性、讲解和例句。系统自动新增尚不存在的全局词汇，已有词复用、不覆盖。等级不是掌握度。`,
  articles: '保存本章完整文章或会话。填写正文，可提供标题和译文；保留完整语境，不逐行拆成文章。',
  sentences: '保存本章可独立学习的句子列表。填写句子，可提供译文、讲解或说话人。没有句子则无需调用。',
  exercises: '保存本章练习列表。填写题型、题干、difficultyTier（目标语种下复杂度 1–5）及一句 difficultyReason；难度不是 JLPT 或掌握度。选择题答案用选项文字；排序用有序文字列表，可重复词块；配对用左右文字配对，可复用右项；多空答案按空位顺序。翻译、简答和写作须提供 gradingNotes，参考表达可省略。新增练习标注 source=AI。',
  material: '保存整理后的本章教材材料 text；保留有意义的标题、列表和表格。不要提交扫描图片。',
};
const names: Record<TextbookContentKind, string> = { grammar: 'write_grammar', vocabulary: 'write_vocabulary', articles: 'write_articles', sentences: 'write_sentences', exercises: 'write_exercises', material: 'write_material' };

export class ChapterContentSubmission {
  nativeTurnId: string | undefined;
  candidate = false;
  receipt: CommitLessonKnowledgeOutput | undefined;
  error: BusinessError | undefined;
  private readonly rejected = new Set<TextbookContentKind>();
  private readonly pending = new Map<string, { kind: TextbookContentKind; input: unknown }>();
  private rejectedCount = 0;
  constructor(readonly assignment: ChapterContentAssignment, private readonly repo: ContentRepository) {}
  private get scope() { return { userId: this.assignment.userId, documentId: this.assignment.documentId, chapterId: this.assignment.lessonId }; }
  private guard(context: ToolExecutionContext): BusinessError | undefined {
    if (context.userId !== this.assignment.userId || !context.turnId || context.turnId !== this.nativeTurnId) return new BusinessError('E_SUBMISSION_SCOPE_INVALID', '该调用不属于当前章节的模型轮次', 'VALIDATION');
    if (this.assignment.signal.aborted || this.assignment.turnSignal?.aborted) return new BusinessError('E_CANCELLED', '本次章节处理已经结束，迟到调用已拒绝', 'VALIDATION');
    return undefined;
  }
  async write(kind: TextbookContentKind, input: unknown, context: ToolExecutionContext): Promise<Result<ContentWriteReceipt, BusinessError>> {
    const guard = this.guard(context); if (guard) return err(guard);
    const parsed = TextbookWriteSchemas[kind].safeParse(input);
    this.assignment.onStage?.('validating');
    let result: Result<ContentWriteReceipt, BusinessError>;
    if (!parsed.success) result = err(new BusinessError('E_CONTENT_FORMAT_INVALID', '内容字段不符合工具要求', 'VALIDATION', true,
      { issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }));
    else if (kind === 'exercises' && !this.assignment.allowAiExercises && 'source' in parsed.data && parsed.data.source === 'AI') result = err(new BusinessError('E_AI_EXERCISES_DISABLED', '本次未启用新增 AI 练习', 'VALIDATION'));
    else {
      this.candidate = true; this.assignment.onStage?.('saving');
      result = await this.repo.writeTextbookContent(this.scope, kind, parsed.data);
    }
    const binding = { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId, ...(context.callId ? { callId: context.callId } : {}), ...(this.assignment.sessionId ? { sessionId: this.assignment.sessionId } : {}) };
    if (result.ok) {
      this.rejected.delete(kind);
      if (!this.pending.size && !this.rejected.size) this.error = undefined;
      this.assignment.monitor?.record('storage', 'content_saved', result.value, binding);
      this.assignment.onStage?.('extracting');
    } else {
      this.error = result.error;
      if (result.error.category === 'DATABASE' && parsed.success) this.pending.set(context.callId ?? `${kind}:${this.pending.size}`, { kind, input: parsed.data });
      else if (result.error.category === 'VALIDATION') {
        this.rejected.add(kind); this.assignment.onStage?.('correcting');
        this.assignment.monitor?.record('validation', 'rejected', { code: result.error.code, message: result.error.userMessage, details: result.error.internalDetails }, binding);
        if (result.error.retryable && this.assignment.toolRepairRetries !== undefined && ++this.rejectedCount > this.assignment.toolRepairRetries) {
          this.error = new BusinessError('E_TOOL_REPAIR_LIMIT', '本轮内容修正次数已用尽', 'VALIDATION', true, { rejectedCount: this.rejectedCount, lastFailure: result.error.internalDetails });
          this.assignment.onRepairLimit?.(this.error); return err(this.error);
        }
      }
    }
    return result;
  }
  async read(input: unknown, context: ToolExecutionContext) {
    const guard = this.guard(context); if (guard) return err(guard);
    if (!z.object({}).strict().safeParse(input).success) return err(new BusinessError('E_CONTENT_FORMAT_INVALID', '当前章节查询不需要身份参数', 'VALIDATION'));
    return this.repo.readTextbookMaterial(this.scope);
  }
  async persist(): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    if (this.receipt) return ok(this.receipt);
    if (this.assignment.signal.aborted || this.assignment.turnSignal?.aborted) return err(new BusinessError('E_CANCELLED', '本章处理已取消', 'VALIDATION'));
    if (this.rejected.size) return err(this.error ?? new BusinessError('E_CONTENT_FORMAT_INVALID', '仍有未修正的内容提交', 'VALIDATION', true));
    for (const [callId, { kind, input }] of this.pending) {
      const saved = await this.repo.writeTextbookContent(this.scope, kind, input);
      if (!saved.ok) { this.error = saved.error; return saved; }
      this.pending.delete(callId);
    }
    if (!this.candidate) return err(new BusinessError('E_CONTENT_MISSING', '模型没有通过内容工具保存任何内容', 'VALIDATION', true));
    const result = await this.repo.completeTextbookChapter(this.scope);
    if (result.ok) { this.receipt = result.value; this.error = undefined; this.assignment.monitor?.record('storage', 'committed', result.value, { nodeId: this.assignment.lessonId, attemptId:this.assignment.assignmentId, ...(this.assignment.sessionId ? {sessionId:this.assignment.sessionId} : {}) }); this.assignment.onStage?.('saved'); }
    else this.error = result.error;
    return result;
  }
}

export class TextbookContentTool implements ToolDefinition<unknown, unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType;
  readonly location = ToolLocations.SERVER;
  readonly permission;
  constructor(readonly owner: TextbookContentTools, readonly kind: TextbookContentKind | 'read_material') {
    this.name = `library.${kind === 'read_material' ? kind : names[kind]}`;
    this.description = kind === 'read_material' ? '查询当前绑定章节已经保存的整理材料。不需要填写教材、章节或用户身份；当前输入已包含的材料无需重复查询。' : descriptions[kind];
    this.schema = kind === 'read_material' ? z.object({}).strict() : TextbookWriteSchemas[kind];
    this.permission = kind === 'read_material' ? ToolPermissions.READ : ToolPermissions.WRITE;
  }
  async execute(input: unknown, context: ToolExecutionContext): Promise<Result<unknown, BusinessError>> {
    const binding = this.owner.get(context.sessionId);
    if (!binding) return err(new BusinessError('E_SUBMISSION_SCOPE_INVALID', '该会话没有教材章节工具权限', 'VALIDATION'));
    return this.kind === 'read_material' ? binding.read(input, context) : binding.write(this.kind, input, context);
  }
}
export class TextbookContentTools {
  readonly tools: TextbookContentTool[];
  private readonly bindings = new Map<string, ChapterContentSubmission>();
  constructor(private readonly repo: ContentRepository) {
    this.tools = [...Object.keys(TextbookWriteSchemas).map(kind => new TextbookContentTool(this, kind as TextbookContentKind)), new TextbookContentTool(this, 'read_material')];
  }
  get(sessionId: string) { return this.bindings.get(sessionId); }
  bind(sessionId: string, assignment: ChapterContentAssignment) {
    if (this.bindings.has(sessionId)) throw new BusinessError('E_SUBMISSION_SCOPE_INVALID', '章节会话仍在处理上一项任务', 'AGENT_RUNTIME');
    const binding = new ChapterContentSubmission(assignment, this.repo); this.bindings.set(sessionId, binding); return binding;
  }
  startTurn(sessionId: string, assignmentId: string, turnId: string) {
    const binding = this.bindings.get(sessionId);
    if (binding?.assignment.assignmentId === assignmentId && !binding.assignment.turnSignal?.aborted) binding.nativeTurnId = turnId;
  }
  end(sessionId: string) { this.bindings.delete(sessionId); }
}
