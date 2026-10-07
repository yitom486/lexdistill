import { BusinessError, generateId } from '@study-studio/shared';
import { CreateGenerationTaskSchema, GenerationRunLimitsSchema,
  type CreateGenerationTask, type GenerationBinding, type GenerationTaskSnapshot, type GenerationTaskSummary } from '@study-studio/protocol';
import { assertBlueprintFitsConfig } from './blueprint.js';
import type { GenerationAudioRenderer, QuestionGenerationRepository } from './ports.js';
import { toStudentPaper, toReviewPaper } from './student-view.js';

export interface GenerationServiceDeps {
  repository: QuestionGenerationRepository;
  audio?: GenerationAudioRenderer | undefined;
}

/**
 * P1 宿主任务入口：创建、查询、取消与资产读取。
 * 权限来自可信用户上下文（桌面本地调用方传入的 userId），不接受模型填写的身份。
 * 同一任务同时只允许一个运行所有者（内存守卫 + DB ACTIVE 状态双重检查）。
 */
export class GenerationTaskService {
  private readonly runningOwners = new Set<string>();
  private readonly abortByTask = new Map<string, AbortController>();

  constructor(private readonly deps: GenerationServiceDeps) {}

  createTask(input: CreateGenerationTask): GenerationBinding {
    const parsed = CreateGenerationTaskSchema.parse(input);
    if (!parsed.userId.trim() || !parsed.sessionId.trim() || !parsed.turnId.trim()) {
      throw new BusinessError('E_GENERATION_CONFIG', '任务身份不正确', 'VALIDATION');
    }
    if (parsed.blueprint) assertBlueprintFitsConfig(parsed.config, parsed.blueprint);
    // 运行预算一律归一化存储（含默认），避免 runner 幂等复用时 NULL 与默认值冲突。
    const runLimits = GenerationRunLimitsSchema.parse(parsed.runLimits ?? {});
    const binding: GenerationBinding = {
      taskId: parsed.taskId?.trim() || generateId('gen'),
      userId: parsed.userId, sessionId: parsed.sessionId, turnId: parsed.turnId,
    };
    const expiresAt = parsed.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString();
    this.deps.repository.createTask(binding, parsed.config, expiresAt, {
      ...(parsed.blueprint ? { blueprint: parsed.blueprint } : {}),
      runLimits,
      ...(parsed.objective ? { objective: parsed.objective } : {}),
    });
    return binding;
  }

  queryTask(userId: string, taskId: string): GenerationTaskSnapshot {
    if (!userId.trim() || !taskId.trim()) throw new BusinessError('E_GENERATION_SCOPE', '任务归属不正确', 'SECURITY');
    return this.deps.repository.describeTask(userId, taskId);
  }

  listUserTasks(userId: string): GenerationTaskSummary[] {
    if (!userId.trim()) throw new BusinessError('E_GENERATION_SCOPE', '任务归属不正确', 'SECURITY');
    return this.deps.repository.listUserTasks(userId);
  }

  /** 取消：运行中则中断模型与 TTS 并等待收尾；未运行且 ACTIVE 则直接标记 CANCELLED。 */
  async cancelTask(userId: string, taskId: string): Promise<GenerationTaskSnapshot> {
    const snapshot = this.queryTask(userId, taskId);
    if (snapshot.status !== 'ACTIVE') return snapshot;
    const abort = this.abortByTask.get(taskId);
    if (abort) {
      abort.abort();
      // 运行器负责 dispose(CANCELLED)；这里等待其释放所有者标记。
      for (let i = 0; i < 100 && this.runningOwners.has(taskId); i++) {
        await new Promise(r => setTimeout(r, 50));
      }
      return this.queryTask(userId, taskId);
    }
    this.deps.repository.recoverOrphanedTasks(userId, [taskId]);
    return this.queryTask(userId, taskId);
  }

  readPaper(userId: string, taskId: string, paperId: string) {
    return this.deps.repository.readTaskPaper(userId, taskId, paperId);
  }

  readStudentPaper(userId: string, taskId: string, paperId: string, input?: { releaseTranscript?: boolean }) {
    return toStudentPaper(this.readPaper(userId, taskId, paperId), input);
  }

  /** P3 重开恢复：试卷下用户自己的作答保留（归属已校验，不含参考答案）。 */
  listBankSubmissions(userId: string, taskId: string, paperId: string) {
    if (!userId.trim() || !taskId.trim() || !paperId.trim()) throw new BusinessError('E_GENERATION_SCOPE', '任务归属不正确', 'SECURITY');
    // 学生读口：批改回执（分数/反馈/修订建议）仅在合法判分后释放；
    // 待批改与失败态保留行但清空回执，后端仍私自保留原文供重试。
    return this.deps.repository.listBankSubmissions(userId, taskId, paperId)
      .map(row => (row.status === 'GRADED' ? row : { ...row, grading: null }));
  }

  /**
   * P2 复盘视图：已作答题目释放完整快照，未作答保持隐藏。
   * 释放资格由同一 quiz_attempts 事实表在后端判定，客户端无权指定。
   */
  readReviewPaper(userId: string, taskId: string, paperId: string) {
    const paper = this.readPaper(userId, taskId, paperId);
    const states = this.deps.repository.bankAnswerStates(userId, paper.items.map(item => item.id));
    return toReviewPaper(paper, new Set(states.filter(state => state.hasGraded).map(state => state.questionId)));
  }

  readAudio(userId: string, taskId: string, materialId: string): { bytes: Uint8Array; mimeType: string } {
    const repo = this.deps.repository as QuestionGenerationRepository & {
      readAudio(userId: string, taskId: string, materialId: string): { bytes: Uint8Array; mimeType: string };
    };
    if (typeof repo.readAudio !== 'function') throw new BusinessError('E_NOT_FOUND', '音频不存在', 'SECURITY');
    const result = repo.readAudio(userId, taskId, materialId);
    if (!result.bytes.byteLength || result.bytes.byteLength > 25 * 1024 * 1024) {
      throw new BusinessError('E_AUDIO_INVALID', '音频大小异常', 'VALIDATION');
    }
    return result;
  }

  recoverOrphanedTasks(userId: string, taskIds: string[]): string[] {
    const active = taskIds.filter(id => !this.runningOwners.has(id));
    if (active.length === 0) return [];
    return this.deps.repository.recoverOrphanedTasks(userId, active);
  }

  defaultRunLimits(): { maxModelRounds: number; maxRepairAttempts: number; maxDurationMs: number } {
    return GenerationRunLimitsSchema.parse({});
  }

  /** @internal 运行器占用/释放 single-owner 守卫。 */
  tryAcquireOwner(taskId: string, abort: AbortController): boolean {
    if (this.runningOwners.has(taskId)) return false;
    this.runningOwners.add(taskId);
    this.abortByTask.set(taskId, abort);
    return true;
  }

  /** @internal */
  releaseOwner(taskId: string): void {
    this.runningOwners.delete(taskId);
    this.abortByTask.delete(taskId);
  }

  /** @internal */
  hasOwner(taskId: string): boolean {
    return this.runningOwners.has(taskId);
  }
}
