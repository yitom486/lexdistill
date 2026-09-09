import { createGateway } from './bootstrap/create-gateway.js';
import { createApp } from './transport/http/create-app.js';
import { startGateway } from './bootstrap/start-gateway.js';
import { PORT } from './bootstrap/config.js';

export * from './runtime/gateway-runtime.js';
export * from './session/session-manager.js';
export * from './context/context-builder.js';
export * from './router/tool-router.js';
export * from './router/agent-router.js';
export * from './infrastructure/db/index.js';
export * from './infrastructure/drizzle-learner-repository.js';
export * from './errors/http-error-handler.js';

// 生产单例：进程内只装配一次。测试如需隔离请用 createGateway() 显式注入，
// 不要依赖本模块单例；路由装配见 transport/http/create-app.ts。
// 注：createGateway 为 async（含种子 shred 回填），顶层 await 装配完成再 export。
const gateway = await createGateway();
export const drizzleRepo = gateway.repo;
export const gatewayServer = gateway.server;

/**
 * Hono 应用（全栈 RPC 类型安全契约 GatewayAppType 与统一错误拦截闭环）。
 * 路由按领域拆分在 transport/http 与各 modules 子目录，行为与拆分前一致。
 */
export const app = createApp({ repo: drizzleRepo, server: gatewayServer, port: PORT });

export type GatewayAppType = typeof app;

export function startGatewayServer(port = PORT) {
  return startGateway(app, gatewayServer, port);
}

// 如果作为主入口直接运行，则启动服务器
if (import.meta.main) {
  startGatewayServer();
}
