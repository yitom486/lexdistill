import type { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import type { GatewayServer } from '../runtime/gateway-runtime.js';

/**
 * 网关依赖束（G2）：路由只经 deps 访问仓储与运行时，
 * 不得 import index.ts 单例或自行创建 DB/Adapter。
 *
 * E4a 起家在本目录（前身 transport/http/gateway-deps.ts；仅改相对路径）。
 * 本类型是 Gateway 内部组合契约，不提升为跨包契约（commander 裁决）：
 * 含 GatewayServer/Repository/端口，不得进入 protocol 或包 public surface。
 */
export interface GatewayDeps {
  repo: DrizzleLearnerRepository;
  server: GatewayServer;
  /** 健康检查回显用端口；仅展示，不决定监听 */
  port: number;
}
