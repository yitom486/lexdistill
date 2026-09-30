import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { createDefaultAgentAdapterFactory } from '../composition/agent-deps.js';
import { ensureCanonicalContentSources } from '@study-studio/storage-sqlite';
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
  // 教材只通过显式导入创建；启动不得恢复用户已经清空的示例教材。
  await ensureContentSourcesAtBoot(repo);
  return { repo, server };
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
