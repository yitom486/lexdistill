import { logger } from '@lexdistill/shared';
import { configureGatewayBaseUrl } from '../lib/api-client.js';
import { gatewayClient } from '../lib/gateway-client.js';
import { detectTauri } from './capabilities.js';
import { getDesktopGatewayConnection } from './tauri-capabilities.js';

/**
 * 在 React 首次渲染前完成桌面端 Gateway 地址协商。
 * Web 开发环境继续使用 localhost:8080，桌面端使用 Rust 选出的空闲端口。
 */
export async function configureGatewayForRuntime(): Promise<void> {
  if (!detectTauri()) return;

  try {
    const connection = await getDesktopGatewayConnection();
    configureGatewayBaseUrl(connection.httpUrl);
    gatewayClient.configure({ url: connection.wsUrl });
  } catch (error: unknown) {
    // 保留默认地址作为旧版本/异常壳环境的兼容回退；UI 会显示 Gateway 离线状态。
    logger.warn('[gateway] 无法读取桌面端动态端口，回退到默认地址', error);
  }
}
