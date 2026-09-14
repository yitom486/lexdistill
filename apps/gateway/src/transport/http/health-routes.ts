import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { GatewayDeps } from '../../composition/gateway-deps.js';

/**
 * 进程身份（AGENTS §7.3 服务端身份握手）：模块级常量，随进程启动一次生成。
 * 重启即换 bootId；前端长请求失败后凭此判定"网关是否在请求中途重启"，
 * 不再把中断误诊为普通网络失败（见 web `mapTransportInterruption`）。
 */
const BOOT_ID = randomUUID();
const STARTED_AT = new Date().toISOString();
/** 版本号：经 `bun run` 启动时由运行时注入；直调/单测回退 dev。 */
const GATEWAY_VERSION = process.env.npm_package_version ?? 'dev';

function healthBody(deps: GatewayDeps): Record<string, string | number> {
  return {
    status: 'ok',
    service: 'Lingua Studio Agent Gateway',
    port: deps.port,
    timestamp: Date.now(),
    bootId: BOOT_ID,
    startedAt: STARTED_AT,
    version: GATEWAY_VERSION,
  };
}

/** 健康检查（G2：由 index.ts 链式注册迁移而来，行为不变）。 */
export function createHealthRoutes(deps: GatewayDeps) {
  return new Hono()
  .get('/health', (c) =>
    c.json(healthBody(deps))
  )
  .get('/api/health', (c) =>
    c.json(healthBody(deps))
  )
;
}
