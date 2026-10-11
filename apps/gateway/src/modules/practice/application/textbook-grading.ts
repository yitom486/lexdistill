import { resolveAgentFirstMessage, type AgentAdapter, type AgentEvent, type AgentSession } from '@study-studio/agent-runtime';
import type { LearnerRepository, TextbookPracticeRepository, TextbookGradeAudit } from '@study-studio/learner-core';
import { TextbookExerciseAttemptSchema, type ExerciseAnswer, type ExerciseSnapshot, type SubmitTextbookExercise, type TextbookExerciseAttempt } from '@study-studio/protocol';
import { DEFAULT_TEXTBOOK_PIPELINE_SETTINGS } from '@study-studio/document-model';
import { BusinessError, err, ok, generateId, nowIso, translateToBusinessError, type Result } from '@study-studio/shared';
import type { ToolDefinition } from '@study-studio/tool-core';
import { SubmitExerciseGradeTool, submitGradeAttempt, type GradeBinding } from '../tools/submit-exercise-grade.js';

export const isSubjectiveExercise = (type: string) => ['TRANSLATION','SHORT_ANSWER','WRITING'].includes(type);
export function gradeTextbookObjective(snapshot: ExerciseSnapshot, answer: ExerciseAnswer) {
  const item = snapshot.exercise, reference = item.answer;
  if (!reference) throw new BusinessError('E_REFERENCE_MISSING', '这道客观题尚无有效标准答案', 'VALIDATION');
  const strings = (value: ExerciseAnswer) => typeof value === 'string' ? [value] : value.every(word => typeof word === 'string') ? value : undefined;
  const actual = strings(answer), expected = strings(reference);
  let correct = false;
  if (item.type === 'MATCHING') {
    if (!Array.isArray(answer) || answer.some(pair => typeof pair !== 'object' || !item.left?.includes(pair.left) || !item.right?.includes(pair.right)) || answer.length !== item.left?.length || new Set(answer.map(pair => typeof pair === 'object' ? pair.left : '')).size !== item.left?.length) throw new BusinessError('E_ANSWER_FORMAT_INVALID', '请为每个左项选择一个有效对应项', 'VALIDATION');
    correct = Array.isArray(reference) && reference.every(pair => typeof pair === 'object' && answer.some(value => typeof value === 'object' && pair.left === value.left && pair.right === value.right));
  } else {
    if (!actual || !expected) throw new BusinessError('E_ANSWER_FORMAT_INVALID', '作答与题型不对应', 'VALIDATION');
    if (['CHOICE','MULTI_CHOICE','ORDERING'].includes(item.type) && actual.some(value => !item.options?.includes(value))) throw new BusinessError('E_ANSWER_FORMAT_INVALID', '请选择题目中的实际选项', 'VALIDATION');
    if ((item.type === 'CHOICE' && actual.length !== 1) || (item.type === 'FILL_BLANK' && actual.length !== expected.length)) throw new BusinessError('E_ANSWER_FORMAT_INVALID', '请填写本题要求的全部答案', 'VALIDATION');
    const a = item.type === 'MULTI_CHOICE' ? [...actual].sort() : actual;
    const b = item.type === 'MULTI_CHOICE' ? [...expected].sort() : expected;
    correct = a.length === b.length && a.every((word, index) => word.trim() === b[index]?.trim());
  }
  return { score: correct ? 100 : 0, maxScore: 100 as const, feedback: correct ? '回答正确。' : '请对照本题答案和解析，再试一次。', suggestions: item.explanation ? [item.explanation] : [] };
}

interface Dependencies {
  repo: TextbookPracticeRepository & Pick<LearnerRepository, 'getLearnerProfile'>;
  adapter: AgentAdapter; tool: SubmitExerciseGradeTool;
  /** 按次工具注册表（MCP 桥按名执行用；必填，缺席大声失败，不静默回落）。 */
  toolRegistry: { register(tool: ToolDefinition): void; unregister(name: string): boolean };
  firstResponseTimeoutMs?: number; stallTimeoutMs?: number;
}

const GRADING_SYSTEM_PROMPT = '你是外语练习批改员。仅批改本次提供的作答，遵守本题评分要求，不调用其他工具。通过 learning_submit_grade 保存批改内容。';

/**
 * 按次批改工具门面：MCP 桥按名走注册表执行，无视传入实例，
 * 故每轮克隆唯一名工具并注册，用完注销；闭包独占本轮 binding，
 * 并发轮次互不串扰。共享实例永不直接接调用（其 execute 大声拒绝）。
 */
function gradeToolForRun(base: SubmitExerciseGradeTool, binding: GradeBinding, runToolName: string): ToolDefinition {
  return {
    name: runToolName,
    description: base.description,
    location: base.location,
    permission: base.permission,
    schema: base.schema,
    execute: (raw: unknown) => submitGradeAttempt(base, binding, raw),
  };
}
/** One frozen submission per native session; same request/retry never creates new evidence. */
export class TextbookGrading {
  private readonly running = new Map<string, Promise<Result<TextbookExerciseAttempt, BusinessError>>>();
  constructor(private readonly deps: Dependencies) {}
  submit(userId: string, input: SubmitTextbookExercise) {
    const key = `${userId}:${input.retryAttemptId ?? input.requestId}`;
    const active = this.running.get(key); if (active) return active;
    const promise = this.run(userId, input).finally(() => this.running.delete(key));
    this.running.set(key, promise); return promise;
  }
  private async run(userId: string, input: SubmitTextbookExercise): Promise<Result<TextbookExerciseAttempt, BusinessError>> {
    let attempt: TextbookExerciseAttempt | undefined;
    let audit: TextbookGradeAudit | undefined;
    let session: AgentSession | undefined;
    let binding: GradeBinding | undefined;
    let runTool: ToolDefinition | undefined;
    let sessionId = '';
    try {
      if (input.preview) {
        if (input.documentId || input.chapterId || input.exerciseId || input.previousAttemptId || input.retryAttemptId) return err(new BusinessError('E_PREVIEW_SCOPE_INVALID', '临时案例不能关联正式学习记录', 'VALIDATION'));
        attempt = TextbookExerciseAttemptSchema.parse({ id: generateId('preview'), itemId: input.preview.exercise.id, attemptNo: 1, previousAttemptId: null, submissionKind: 'INDEPENDENT',
          status: 'SUBMITTED', answer: input.answer, snapshot: { ...input.preview, rubricVersion: 'textbook-grade-v1' }, grading: null, gradingErrorCode: null, model: null, adapter: null,
          rubricVersion: 'textbook-grade-v1', submittedAt: nowIso(), gradedAt: null, timeSpentMs: input.timeSpentMs ?? null, temporary: true });
      } else {
        const prepared = await this.deps.repo.prepareTextbookAttempt(userId, input); if (!prepared.ok) return prepared;
        attempt = prepared.value;
        if (attempt.status === 'GRADED') return ok(attempt);
      }
      if (!isSubjectiveExercise(attempt.snapshot.exercise.type)) {
        const grade = gradeTextbookObjective(attempt.snapshot, attempt.answer);
        return attempt.temporary ? ok({ ...attempt, status: 'GRADED', grading: grade, gradedAt: nowIso() }) : this.deps.repo.settleTextbookGrade(userId, attempt.id, undefined, grade);
      }
      if (!input.model) throw new BusinessError('E_GRADING_MODEL_REQUIRED', '请先选择批改模型，答案已经保留', 'VALIDATION', true);
      const profile = await this.deps.repo.getLearnerProfile(userId);
      if (!profile.ok) throw profile.error;
      const { exercise, chapterTitle, language, knowledge } = attempt.snapshot;
      // Immutable known facts are injected directly; no scans, raw blocks, storage IDs or read tools.
      const context = { chapterTitle, language, learnerLevel: profile.value.overallLevel, question: {
        type: exercise.type, prompt: exercise.prompt, reference: exercise.answer ?? null, gradingNotes: exercise.gradingNotes ?? null,
        difficultyTier: exercise.difficultyTier, difficultyReason: exercise.difficultyReason }, knowledge, answer: attempt.answer };
      sessionId = generateId('grading');
      // 按次克隆唯一名工具并注册（桥按名执行），用完注销；
      // 门面闭包独占本轮 binding，归属由实例隔离保证。
      const submitToolName = `${this.deps.tool.name}.${sessionId}`;
      const message = `请按本题要求批改这次作答，接受合理等价表达，参考表达不是唯一答案。给出具体反馈和可操作的改进建议。通过 ${submitToolName} 提交结果。\n${JSON.stringify(context)}`;
      audit = { id: generateId('grade'), adapter: this.deps.adapter.id, model: input.model, inputSnapshot: message };
      if (!attempt.temporary) {
        const claim = await this.deps.repo.claimTextbookGrade(userId, attempt.id, audit.id); if (!claim.ok) return claim;
        if (!claim.value) return this.deps.repo.getTextbookAttempt(userId, attempt.id);
      }
      const frozen = attempt, runAudit = audit;
      binding = { userId, active: true, repairs: 0, repairLimit: DEFAULT_TEXTBOOK_PIPELINE_SETTINGS.toolRepairRetries,
        save: async grade => {
          if (frozen.temporary) return ok({ ...frozen, status: 'GRADED', grading: grade, model: input.model ?? null, adapter: this.deps.adapter.id, gradedAt: nowIso() });
          // Retry persistence of the same accepted content; never ask the model to regenerate for a DB lock.
          let saved = await this.deps.repo.settleTextbookGrade(userId, frozen.id, runAudit, grade);
          for (let retry = 0; !saved.ok && saved.error.category === 'DATABASE' && saved.error.retryable && retry < DEFAULT_TEXTBOOK_PIPELINE_SETTINGS.storageRetries; retry++) saved = await this.deps.repo.settleTextbookGrade(userId, frozen.id, runAudit, grade);
          return saved;
        } };
      if (!this.deps.toolRegistry) throw new BusinessError('E_GRADING_TOOL_REGISTRY', '批改工具注册表未就绪', 'TOOL_EXECUTION');
      runTool = gradeToolForRun(this.deps.tool, binding, submitToolName);
      this.deps.toolRegistry.register(runTool);
      const created = await this.deps.adapter.createSession({ sessionId, userId, model: input.model,
        ...(input.effort ? { effort: input.effort } : {}),
        ephemeral: true, approvalPolicy: 'never', tools: [runTool],
        systemPrompt: GRADING_SYSTEM_PROMPT });
      if (!created.ok) {
        if (runTool) this.deps.toolRegistry.unregister(runTool.name);
        throw created.error;
      }
      session = created.value;
      // ACP 无 systemPrompt 通道：身份随首消息前置（非 ACP 会话原样返回，不加料）。
      const iterator = session.send({
        message: resolveAgentFirstMessage(session, GRADING_SYSTEM_PROMPT, message),
        contextSnapshot: { targetLanguage: language, learnerLevel: profile.value.overallLevel, userIntentHint: 'GRADE', metadata: context },
      })[Symbol.asyncIterator]();
      await this.consumeGradingTurn(iterator, binding);
      // consumeGradingTurn 只在 binding.result 落定后返回；防御性复核。
      if (binding?.result) return ok(binding.result);
      throw new BusinessError('E_GRADING_RESULT_MISSING', '模型没有提交有效批改结果，答案已保留', 'AGENT_RUNTIME', true);
    } catch (cause) {
      const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: 'AI 批改暂时失败，答案已保留，请重试' });
      if (binding?.result) return ok(binding.result);
      if (attempt && !attempt.temporary) {
        const failed = await this.deps.repo.settleTextbookGrade(userId, attempt.id, audit, undefined, error.code);
        if (!failed.ok) return failed;
        return ok(failed.value);
      }
      return err(error);
    } finally {
      if (binding) binding.active = false;
      if (runTool) this.deps.toolRegistry.unregister(runTool.name);
      if (session) { await session.interrupt(); await session.close(); }
    }
  }

  /** 批改轮次消费（成功以 binding.result 为准，不以模型结论为准）。 */
  private async consumeGradingTurn(
    iterator: AsyncIterator<AgentEvent>,
    binding: GradeBinding,
  ): Promise<void> {
    let received = false;
    while (true) {
      const delay = received ? (this.deps.stallTimeoutMs ?? DEFAULT_TEXTBOOK_PIPELINE_SETTINGS.stallTimeoutMs) : (this.deps.firstResponseTimeoutMs ?? DEFAULT_TEXTBOOK_PIPELINE_SETTINGS.firstResponseTimeoutMs);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const event = await Promise.race([iterator.next(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BusinessError(received ? 'E_GRADING_STALL_TIMEOUT' : 'E_GRADING_FIRST_RESPONSE_TIMEOUT', '模型批改等待超时，答案已保留，可以重试批改', 'AGENT_RUNTIME', true)), delay); })]).finally(() => { if (timer) clearTimeout(timer); });
      if (binding.result) return;
      if (event.done) break;
      received = true;
      if (binding.repairs > binding.repairLimit) throw new BusinessError('E_GRADING_REPAIR_LIMIT', '本次模型修正次数已用尽，答案已保留', 'VALIDATION', true);
      if (event.value.type === 'ERROR') throw event.value.error;
      if (event.value.type === 'COMPLETED') break;
    }
    if (binding.result) return;
    throw new BusinessError('E_GRADING_RESULT_MISSING', '模型没有提交有效批改结果，答案已保留', 'AGENT_RUNTIME', true);
  }
}
