import { hc } from 'hono/client';
import type { GatewayAppType } from '@lexdistill/gateway';

export const DEFAULT_GATEWAY_BASE_URL = 'http://localhost:8080';

/**
 * 桌面端 Gateway 端口由 Tauri 在启动时选择；导出 live binding，
 * 让所有 Query 在 React 首次渲染前切换到实际地址。
 */
export let GATEWAY_BASE_URL = DEFAULT_GATEWAY_BASE_URL;

/**
 * Hono RPC 类型安全客户端实例
 * 具备从 Gateway Hono 路由全自动类型推导能力 (路径、参数、返回值 100% 编译期类型检查)
 */
export let apiClient = hc<GatewayAppType>(GATEWAY_BASE_URL);

export function configureGatewayBaseUrl(baseUrl: string): void {
  const normalized = baseUrl.replace(/\/$/, '');
  if (!/^https?:\/\/localhost:\d+$/.test(normalized)) return;
  GATEWAY_BASE_URL = normalized;
  apiClient = hc<GatewayAppType>(normalized);
}
