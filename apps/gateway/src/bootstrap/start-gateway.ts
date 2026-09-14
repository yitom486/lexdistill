import { BusinessError } from '@study-studio/shared';
import type { CreatedApp } from '../transport/http/create-app.js';
import type { GatewayServer } from '../runtime/gateway-runtime.js';
import { createWebsocketHandlers } from '../transport/websocket/websocket-handler.js';
import { PORT } from './config.js';

/**
 * 启动网关：Bun.serve 同时承载 `/ws` 升级与 Hono HTTP。
 * 应用构建（createApp）与依赖装配（createGateway）已分离，
 * 本函数只负责监听生命周期。
 */
export function startGateway(app: CreatedApp, server: GatewayServer, port = PORT) {
  let started: ReturnType<typeof Bun.serve>;
  try {
    started = Bun.serve<{ sessionId?: string | undefined }>({
      hostname: '127.0.0.1',
      port,
      // §7.3：Bun 默认 idleTimeout 仅 10 秒——已实测会掐断合法慢请求
      //（大文件 OCR 批、80MB 运行时下载、分钟级 AI 审核轮次），客户端只看到
      // socket 被意外关闭。服务端永不掐健康但慢的工作；超时策略收归应用层
      //（客户端首字节/stall 超时转可读错误），此处直接关掉空闲掐断。
      idleTimeout: 0,
      // 大书上传：Bun 默认请求体上限接不住百 MB 级 PDF（实测 100MB+ 被秒断），显式放开。
      maxRequestBodySize: 512 * 1024 * 1024,
      async fetch(req, upgradeServer) {
        const url = new URL(req.url);
        // 1. WebSocket 升级路由 /ws
        if (url.pathname === '/ws') {
          const upgraded = upgradeServer.upgrade(req, {
            data: { sessionId: undefined },
          });
          if (upgraded) return undefined;
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        // 2. HTTP REST 交由 Hono 驱动
        return app.fetch(req);
      },
      websocket: createWebsocketHandlers(server) as never,
    });
  } catch (e) {
    // §7.1 红线：端口被占必须大声失败，禁止漂移到其他端口。
    // 漂移会掩盖未退出的旧实例（僵尸网关），让前端绑错服务器。
    if (isAddressInUse(e)) {
      throw new BusinessError(
        'E_GATEWAY_PORT_TAKEN',
        `网关端口 ${port} 已被占用（疑似旧实例未退出），已拒绝启动以防绑错服务。请先运行 bun run dev:clean 核对并清理旧进程，再重启`,
        'NETWORK',
        false
      );
    }
    throw e;
  }

  console.log(`🚀 Lingua Studio Agent Gateway (Hono + Bun WS) listening on http://localhost:${started.port}`);
  return started;
}

/**
 * Bun.serve 监听失败载荷收窄：errno 口径 + 文案口径双判（跨版本稳健）。
 * 导出仅供单测锁定双判语义；生产调用点仍是 startGateway 内 EADDRINUSE 分支。
 */
export function isAddressInUse(rawError: unknown): boolean {
  if (!rawError || typeof rawError !== 'object') return false;
  const rec = rawError as Record<string, unknown>;
  if (rec.code === 'EADDRINUSE') return true;
  const message = typeof rec.message === 'string' ? rec.message : '';
  return /address already in use|EADDRINUSE/i.test(message);
}
