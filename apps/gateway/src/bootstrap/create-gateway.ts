import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { createDefaultAgentAdapterFactory } from '../composition/agent-deps.js';
import { ensureCanonicalContentSources, SqliteQuestionGenerationRepository } from '@study-studio/storage-sqlite';
import { CodexAdapter } from '@study-studio/agent-runtime';
import { GenerationTaskService } from '../modules/question-generation/service.js';
import { GenerationRunManager } from '../modules/question-generation/run-manager.js';
import { resolveGenerationAudio } from '../modules/question-generation/public.js';
import { isOk, logger } from '@study-studio/shared';
import { dbPath } from './config.js';

/**
 * 网关装配根（G2）：生产只创建一套依赖。
 * 测试可直接调用并传入自有实例（显式注入），不得依赖本模块单例。
 */
export async function createGateway(db: string = dbPath) {
  const repo = new DrizzleLearnerRepository(db);
  // DI 装配：Agent 创建权收归装配根，Server 只收工厂；各领域模块经 ToolRegistry 按名订阅。
  const server = new GatewayServer(repo, undefined, createDefaultAgentAdapterFactory());
  // P1 专用出题宿主：任务服务 + 后台运行调度（每任务独立 CodexAdapter，仅六个专用工具）。
  // P5 生产语音：只读宿主环境密钥（GEMINI/GOOGLE/AZURE），未配置如实失败，不静默降级、不记录密钥。
  const generationRepository = new SqliteQuestionGenerationRepository(repo.getRawDb());
  const generationService = new GenerationTaskService({ repository: generationRepository });
  const generation = {
    service: generationService,
    runs: new GenerationRunManager({ service: generationService, repository: generationRepository,
      createAdapter: exec => new CodexAdapter({ executeTool: exec }),
      resolveAudio: config => resolveGenerationAudio(config) }),
  };
  // 教材只通过显式导入创建；启动不得恢复用户已经清空的示例教材。
  await ensureContentSourcesAtBoot(repo);
  return { repo, server, generation };
}

/**
 * 启动期来源登记（P2-2b；单测友好小函数）。
 * 6 行规范来源幂等写入；失败只结构化 warn，不阻断启动（沿种子语义）。
 */
export async function ensureContentSourcesAtBoot(
  repo: DrizzleLearnerRepository
): Promise<{ ensured: number }> {
  const res = await ensureCanonicalContentSources({ sqlite: repo.getRawDb() });
  if (!isOk(res)) {
    logger.warn('[boot] content sources ensure 失败（已记录，启动继续）', {
      code: res.error.code,
    });
    return { ensured: 0 };
  }
  return { ensured: res.value.ensured };
}

export type CreatedGateway = ReturnType<typeof createGateway>;
