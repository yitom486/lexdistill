import { createGateway } from './bootstrap/create-gateway.js';
import { createApp } from './transport/http/create-app.js';
import { startGateway } from './bootstrap/start-gateway.js';
import { PORT } from './bootstrap/config.js';
import {
  attachShutdownSignals,
  createShutdownController,
} from './bootstrap/shutdown-control.js';

export * from './runtime/gateway-runtime.js';
export * from './runtime/session/session-manager.js';
export * from './runtime/context/context-builder.js';
export * from './runtime/router/tool-router.js';
export * from './runtime/router/agent-router.js';
export * from '@study-studio/storage-sqlite';
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
export const app = createApp({ repo: drizzleRepo, server: gatewayServer, port: PORT, generation: gateway.generation });

export type GatewayAppType = typeof app;

export function startGatewayServer(port = PORT) {
  return startGateway(app, gatewayServer, port);
}

// 如果作为主入口直接运行，则启动服务器
if (import.meta.main) {
  let listener: ReturnType<typeof startGatewayServer>;
  try {
    listener = startGatewayServer();
  } catch (e) {
    // §7.1：端口冲突等启动失败大声退出（非零码 + 可读文案），禁止静默漂移。
    // CLI 启停日志走 console（§2.3 运维日志保留项），不经 BusinessError 信封。
    console.error(`[gateway] 启动失败：${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  // §7.2 红线：信号必须处理。Ctrl+C / taskkill（不带 /F）进这里：
  // 关监听 → 掐长连接（含 WS/流式）→ 退出。存量 Turn 走已有 signal 检查点停扫。
  // 限制：Windows 直接关终端窗口不投递任何信号，仍会留孤儿——必须配合
  // `bun run dev:clean` 定期核对，禁止要求用户逐个杀进程。
  const shutdown = createShutdownController({
    stop: async (closeActiveConnections) => {
      await listener.stop(closeActiveConnections);
      await gatewayServer.pipelineJobs.shutdown();
    },
    exit: (code) => process.exit(code),
    reportError: (error) => {
      console.error(`[gateway] 关闭监听失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });
  attachShutdownSignals(process, (signal) => {
    console.log(`[gateway] 收到 ${signal}，正在关闭监听并退出…`);
    shutdown.request(signal);
  });
}
