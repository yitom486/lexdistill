/**
 * Gateway sidecar / 独立二进制入口（P4-B）。
 * 由 `bun scripts/build-sidecar.ts` 编译为 Tauri sidecar；桌面壳经
 * STUDY_STUDIO_DB / GATEWAY_PORT 环境变量指定库路径与端口。
 * 不改动 index.ts（导入即建仓储/路由对象，但不监听；监听只在此入口显式启动，
 * 避免单测与 Hono RPC 导入时误起端口）。
 */
import { startGatewayServer } from './index.js';
import {
  attachShutdownSignals,
  attachShutdownStdin,
  createShutdownController,
} from './bootstrap/shutdown-control.js';

const listener = startGatewayServer();
const shutdown = createShutdownController({
  stop: (closeActiveConnections) => listener.stop(closeActiveConnections),
  exit: (code) => process.exit(code),
  reportError: (error) => {
    console.error(`[gateway] 关闭监听失败：${error instanceof Error ? error.message : String(error)}`);
  },
});

attachShutdownStdin(process.stdin, () => {
  console.log('[gateway] 收到 sidecar shutdown 命令，正在关闭监听并退出…');
  shutdown.request('stdin');
});
attachShutdownSignals(process, (signal) => {
  console.log(`[gateway] 收到 ${signal}，正在关闭监听并退出…`);
  shutdown.request(signal);
});
