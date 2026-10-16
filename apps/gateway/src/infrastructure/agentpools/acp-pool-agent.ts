import { mkdirSync, writeFileSync } from 'node:fs';
import {
  buildCustomProviderConfigToml,
  buildCustomProviderSpawnEnv,
  findBuiltinAcpRuntime,
  getAcpProviderCodexHome,
  getAcpRuntimeAdapter,
  readAcpProxySettings,
  buildAcpProxySpawnEnv,
  getDefaultAgentDataDir,
  readStoredAcpProvider,
} from '@yitom/acp-client';
import { join } from 'node:path';
import { BusinessError, err, ok, type Result } from '@lexdistill/shared';
import { localCodexRuntime } from '../acp/acp-adapter-pool.js';

export interface AcpPoolAgentSpec {
  program: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  model?: string | undefined;
}

/**
 * agentpools ACP agent 接线（网关唯一口径）：运行时启动信息全部取自 acp-client，
 * 业务侧不分支厂商。新增 Agent 只需在 acp-client 注册模板＋adapter，
 * 网关零改动（符合“改 acp-client 就同步”的目标）。
 *
 * - 模板 command/args 取 findBuiltinAcpRuntime；adapter.resolveSpawnCommand 覆写优先
 *   （绝对路径透传，null＝CLI 未安装直接判停）；
 * - resolveSpawnBlocker 非空（缺 Key 等）直接判停，不触达 spawn；
 * - env＝进程环境＋代理/运行时 spawn 环境（envRemove 剔除）；
 * - codex-acp 沿用本地 pin（与聊天池同一发行版，不赌 bunx @latest）；
 * - custom 走隔离 CODEX_HOME＋Key（与聊天池同链路）。
 */
export async function resolveAcpPoolAgent(
  runtimeId: string,
  opts: { cwd: string; model?: string | undefined },
): Promise<Result<AcpPoolAgentSpec, BusinessError>> {
  if (runtimeId === 'custom') return resolveCustomPoolAgent(opts);
  const info = findBuiltinAcpRuntime(runtimeId);
  if (!info) {
    return err(new BusinessError('E_ACP_RUNTIME_UNKNOWN', `未知或未注册的 ACP 运行时模板: ${runtimeId}`, 'VALIDATION'));
  }
  let adapter: ReturnType<typeof getAcpRuntimeAdapter>;
  try {
    adapter = getAcpRuntimeAdapter(runtimeId);
  } catch (cause) {
    return err(new BusinessError('E_ACP_RUNTIME_UNKNOWN', `未知或未注册的 ACP 运行时模板: ${runtimeId}（${cause instanceof Error ? cause.message : String(cause)}）`, 'VALIDATION'));
  }
  const blocker = safeBlocker(adapter);
  if (blocker) return err(new BusinessError('ACP_SPAWN_ERROR', blocker, 'AGENT_RUNTIME'));
  await safeBeforeSpawn(adapter);
  if (runtimeId === 'codex-acp') {
    const local = localCodexRuntime();
    if (local) {
      return ok({
        program: local.command,
        args: [...local.args],
        env: await spawnEnvFor(adapter),
        cwd: opts.cwd,
        ...(opts.model ? { model: opts.model } : {}),
      });
    }
  }
  let override: { command: string; args: string[] } | null | undefined;
  try {
    override = adapter.resolveSpawnCommand?.();
  } catch {
    override = undefined;
  }
  if (override === null) {
    return err(new BusinessError('ACP_SPAWN_ERROR', `运行时 CLI 未安装: ${runtimeId}`, 'AGENT_RUNTIME'));
  }
  return ok({
    program: override?.command ?? info.command,
    args: [...(override?.args ?? info.args)],
    env: await spawnEnvFor(adapter),
    cwd: opts.cwd,
    ...(opts.model ? { model: opts.model } : {}),
  });
}

function safeBlocker(adapter: ReturnType<typeof getAcpRuntimeAdapter>): string | null {
  try {
    return adapter.resolveSpawnBlocker?.() ?? null;
  } catch {
    return null;
  }
}

async function safeBeforeSpawn(adapter: ReturnType<typeof getAcpRuntimeAdapter>): Promise<void> {
  try {
    await adapter.beforeSpawn?.();
  } catch {
    // 预检副作用失败不拦（连接期同款防御性回落）。
  }
}

async function spawnEnvFor(adapter: ReturnType<typeof getAcpRuntimeAdapter>): Promise<Record<string, string>> {
  let proxyEnv: Record<string, string> = {};
  let envRemove: string[] = [];
  try {
    const storedProxy = await readAcpProxySettings(getDefaultAgentDataDir());
    const proxy = buildAcpProxySpawnEnv(storedProxy);
    const base = adapter.getSpawnEnv?.(storedProxy) ?? proxy;
    proxyEnv = {};
    for (const [key, value] of Object.entries(base.env ?? {})) {
      if (typeof value === 'string') proxyEnv[key] = value;
    }
    envRemove = [...(base.envRemove ?? [])];
  } catch {
    // 代理配置读取失败：沿用进程环境，不拦。
  }
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') merged[key] = value;
  }
  for (const [key, value] of Object.entries(proxyEnv)) {
    if (typeof value === 'string') merged[key] = value;
  }
  for (const key of envRemove) delete merged[key];
  return merged;
}

async function resolveCustomPoolAgent(opts: { cwd: string; model?: string | undefined }): Promise<Result<AcpPoolAgentSpec, BusinessError>> {
  let stored = null;
  try {
    stored = await readStoredAcpProvider();
  } catch (error) {
    return err(new BusinessError('E_PROVIDER_NOT_CONFIGURED', error instanceof Error ? error.message : String(error), 'VALIDATION'));
  }
  if (!stored) {
    return err(new BusinessError('E_PROVIDER_NOT_CONFIGURED', '未配置自定义供应商，请先在设置 → Agent 运行时 → 自定义 API 中填写', 'VALIDATION'));
  }
  const codexHome = getAcpProviderCodexHome();
  try {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), buildCustomProviderConfigToml(stored), 'utf8');
  } catch (error) {
    return err(new BusinessError('E_PROVIDER_HOME', `自定义供应商目录初始化失败：${error instanceof Error ? error.message : String(error)}`, 'TOOL_EXECUTION'));
  }
  const local = localCodexRuntime();
  const template = findBuiltinAcpRuntime('codex-acp');
  const program = local?.command ?? template?.command ?? process.execPath;
  const args = local ? [...local.args] : [...(template?.args ?? [])];
  const customEnv = buildCustomProviderSpawnEnv(stored, stored.apiKey, codexHome);
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') merged[key] = value;
  }
  for (const [key, value] of Object.entries(customEnv ?? {})) {
    if (typeof value === 'string') merged[key] = value;
  }
  return ok({
    program,
    args,
    env: merged,
    cwd: opts.cwd,
    ...(opts.model ?? stored.model ? { model: opts.model ?? stored.model } : {}),
  });
}
