import { BusinessError } from '@study-studio/shared';
import type { AgentAdapter, ExternalToolExecutor } from '@study-studio/agent-runtime';
import type { GenerationAudioRenderer, QuestionGenerationRepository } from './ports.js';
import type { GenerationConfig } from '@study-studio/protocol';
import type { GenerationTaskService } from './service.js';
import { runGenerationTask } from './runner.js';

export interface GenerationRunManagerDeps {
  service: GenerationTaskService;
  repository: QuestionGenerationRepository;
  /** 每任务独立 Adapter；生产传入 CodexAdapter 构造器，测试传入替身。 */
  createAdapter: (executeTool: ExternalToolExecutor) => AgentAdapter;
  /** 按冻结配置解析语音渲染器；缺席表示未接入，听力音频将如实失败（P5 接真实 TTS）。 */
  resolveAudio?: ((config: GenerationConfig) => GenerationAudioRenderer | undefined) | undefined;
}

/**
 * P1 后台出题调度：宿主持有的唯一运行入口（非测试代码同样经此调用运行器）。
 * `start` 只做归属与状态检查后即返回，后台执行 `runGenerationTask` 全闭环；
 * 进度经 `runState` 查询，取消走 `GenerationTaskService.cancelTask`。
 */
export class GenerationRunManager {
  private readonly running = new Set<string>();
  private readonly last = new Map<string, { status: 'COMPLETED'; paperId: string } | { status: 'FAILED'; code: string }>();

  constructor(private readonly deps: GenerationRunManagerDeps) {}

  async start(userId: string, taskId: string): Promise<{ started: true } | { started: false; reason: 'RUNNING' | 'CLOSED' }> {
    // 归属先行：他人任务直接抛 E_GENERATION_SCOPE，不泄露存在性之外的任何状态。
    const snapshot = this.deps.service.queryTask(userId, taskId);
    if (snapshot.status !== 'ACTIVE' || snapshot.isExpired) return { started: false, reason: 'CLOSED' };
    if (this.running.has(taskId) || this.deps.service.hasOwner(taskId)) return { started: false, reason: 'RUNNING' };
    this.running.add(taskId);
    void this.execute(userId, taskId, snapshot.config).finally(() => this.running.delete(taskId));
    return { started: true };
  }

  runState(userId: string, taskId: string): { taskId: string; status: string; running: boolean; last: unknown } {
    const snapshot = this.deps.service.queryTask(userId, taskId);
    return { taskId, status: snapshot.status, running: this.running.has(taskId), last: this.last.get(taskId) ?? null };
  }

  private async execute(userId: string, taskId: string, config: GenerationConfig): Promise<void> {
    const audio = this.deps.resolveAudio?.(config);
    let adapter: AgentAdapter | undefined;
    try {
      const result = await runGenerationTask(this.deps.service, this.deps.repository, audio, {
        userId, taskId,
        createAdapter: exec => (adapter = this.deps.createAdapter(exec)),
      });
      this.last.set(taskId, { status: 'COMPLETED', paperId: result.paperId });
    } catch (error) {
      this.last.set(taskId, { status: 'FAILED', code: error instanceof BusinessError ? error.code : 'E_GENERATION_FAILED' });
    } finally {
      // 每任务独立 Adapter 用后即关，不遗留 App Server 连接。
      await (adapter as unknown as { shutdown?: () => Promise<unknown> } | undefined)?.shutdown?.()?.catch(() => undefined);
    }
  }
}
