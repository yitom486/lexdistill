import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  AcpClient,
  buildCustomProviderConfigToml,
  buildCustomProviderSpawnEnv,
  findModelConfigOption,
  getAcpProviderCodexHome,
  parseAcpConfigOptions,
  readStoredAcpProvider,
} from '@yitom/acp-client';
import { discoverThinking, resolveThinkingModelId } from '../../runtime/router/model-thinking.js';
import { BusinessError } from '@study-studio/shared';
import { AcpAdapter } from '@study-studio/agent-runtime';
import type { AcpAdapterOptions } from '@study-studio/agent-runtime';
import type { SessionToolBridge } from '../../runtime/mcp/session-tool-bridge.js';
import { getAgentRuntimeOptions, type AgentRuntimeOptions } from '../../runtime/router/runtime-options.js';

/**
 * ACP 适配器池（网关基础设施层；温进程复用，同 runtime 单客户端）。
 *
 * - 同 runtime 的会话共用一个 AcpClient，不再每轮现拉；
 * - codex-acp 直调本地 pin 死的发行版（lumina 同款本地优先）；缺失回落 builtin 模板（bunx）；
 * - custom 走隔离 CODEX_HOME＋Key 环境（需 acp-client ≥ 0.1.1 生效 env 合并；
 *   未配置报 E_PROVIDER_NOT_CONFIGURED，前端引导去设置页）；
 * - MCP 桥 token 由网关 SessionToolBridge 配发，会话 close 即 revoke（另有 30 分钟 sweep 兜底）。
 */
export interface AcpAdapterPoolDeps {
  bridge: SessionToolBridge;
  workspaceRoot?: string;
}

type ClientCallbacks = Parameters<AcpAdapterOptions['createClient']>[0];

function resolveLocalCodexAcpEntry(): string | null {
  try {
    const pkg = createRequire(import.meta.url).resolve('@agentclientprotocol/codex-acp/package.json');
    return join(dirname(pkg), 'dist', 'index.js');
  } catch {
    return null;
  }
}

function localCodexRuntime(): {
  id: string; name: string; description: string; command: string; args: string[]; requiredEnvKeys: string[];
} | null {
  const localEntry = resolveLocalCodexAcpEntry();
  if (!localEntry) return null;
  return {
    id: 'codex-acp-local',
    name: 'codex-acp（本地 pin 版）',
    description: '直调本地发行版，不走 bunx @latest',
    command: process.execPath,
    args: [localEntry],
    requiredEnvKeys: [],
  };
}

function acpCallbacks(callbacks: ClientCallbacks) {
  return {
    onSessionUpdate: callbacks.onSessionUpdate,
    onPermissionRequest: callbacks.onPermissionRequest,
    onLog: callbacks.onLog,
    onStderrLine: callbacks.onStderrLine,
  };
}

/** 已安装 @yitom/acp-client 的版本号（读不到返回 null，不拦）。 */
export function installedAcpClientVersion(): string | null {
  try {
    const pkgPath = createRequire(import.meta.url).resolve('@yitom/acp-client/package.json');
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * 自定义 env 是否生效：0.1.0 声明了 `env` 选项但 spawn 时忽略（静默丢 CODEX_HOME/Key），
 * 0.1.1 起合并进子进程环境。纯函数，便于单测。
 */
export function acpClientHonorsCustomEnv(version: string | null): boolean {
  if (!version) return true;
  const parts = version.split('.').map(part => Number.parseInt(part, 10));
  if (parts.some(part => !Number.isFinite(part))) return true;
  const [major = 0, minor = 0, patch = 0] = parts;
  return major > 0 || minor > 1 || (minor === 1 && patch >= 1);
}

export class AcpAdapterPool {
  private readonly adapters = new Map<string, AcpAdapter>();
  private readonly specTokens = new Map<unknown, string>();

  constructor(private readonly deps: AcpAdapterPoolDeps) {}

  public get(runtimeId: string): AcpAdapter {
    const existing = this.adapters.get(runtimeId);
    if (existing) return existing;
    const adapter = runtimeId === 'custom' ? this.createCustomAdapter() : this.createBuiltinAdapter(runtimeId);
    this.adapters.set(runtimeId, adapter);
    return adapter;
  }

  /**
   * 运行时真实选项（模型/思考深度列表，10 分钟缓存）。
   * 独立轻量探针客户端，用完即断，不占用池内温进程。
   * custom 没有独立模板：经 codex-acp＋自定义 env 探针（与会话同链路），未配置直接回 error 不 spawn。
   */
  public getRuntimeOptions(runtimeId: string): Promise<AgentRuntimeOptions> {
    if (runtimeId === 'custom') return this.getCustomRuntimeOptions();
    return getAgentRuntimeOptions(runtimeId, {
      createClient: (id) => new AcpClient({
        runtime: id,
        workspaceRoot: this.deps.workspaceRoot ?? process.cwd(),
        clientInfo: { name: 'lingua-studio-gateway-probe', version: '1.0.0' },
        callbacks: {},
      }),
    });
  }

  private async getCustomRuntimeOptions(): Promise<AgentRuntimeOptions> {
    if (!acpClientHonorsCustomEnv(installedAcpClientVersion())) {
      return {
        models: [],
        efforts: [],
        error: '网关依赖的 @yitom/acp-client 过旧（自定义 env 被忽略），请升级到 ≥0.1.1 后重启网关',
      };
    }
    let stored = null;
    try {
      stored = await readStoredAcpProvider();
    } catch (error) {
      return { models: [], efforts: [], error: error instanceof Error ? error.message : String(error) };
    }
    if (!stored) {
      return { models: [], efforts: [], error: '未配置自定义供应商，请先在设置 → Agent 运行时 → 自定义 API 中填写' };
    }
    const codexHome = getAcpProviderCodexHome();
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), buildCustomProviderConfigToml(stored), 'utf8');
    const local = localCodexRuntime();
    const workspaceRoot = this.deps.workspaceRoot ?? process.cwd();
    const env = buildCustomProviderSpawnEnv(stored, stored.apiKey, codexHome);
    return getAgentRuntimeOptions('custom', {
      createClient: () => new AcpClient({
        runtime: (local ?? 'codex-acp') as never,
        workspaceRoot,
        clientInfo: { name: 'lingua-studio-gateway-probe', version: '1.0.0' },
        env,
        callbacks: {},
      }),
    });
  }

  private baseOptions(
    createClient: AcpAdapterOptions['createClient'],
  ): AcpAdapterOptions {
    return {
      createClient,
      // 会话真实 configId 发现（与探针同一实现，不漂移），解析归 SDK＋网关规则，适配器只消费结果。
      describeConfigIds: (configOptions) => {
        const parsed = parseAcpConfigOptions(configOptions);
        const thinking = discoverThinking(parsed, findModelConfigOption(parsed));
        return {
          model: findModelConfigOption(parsed)?.configId ?? null,
          effort: thinking.effortConfigId,
        };
      },
      // 变体思考档应用解析（方括号变体路；横杠不发明，返回 null 即警告跳过）。
      resolveThinkingModelId: (configOptions, effort, modelHint) => {
        const parsed = parseAcpConfigOptions(configOptions);
        const model = findModelConfigOption(parsed);
        if (!model) return null;
        return resolveThinkingModelId(model, effort, modelHint);
      },
      buildMcpServers: (tools, context) => {
        if (tools.length === 0) return [];
        const created = this.deps.bridge.create(
          context?.userId ?? 'unknown',
          context?.sessionId ?? 'unknown',
          tools,
        );
        this.specTokens.set(created.spec, created.token);
        return [created.spec];
      },
      resolveMcpToken: (spec) => this.specTokens.get(spec),
      revokeMcpServer: (token) => {
        this.specTokens.forEach((value, key) => { if (value === token) this.specTokens.delete(key); });
        this.deps.bridge.revoke(token);
      },
    };
  }

  private createBuiltinAdapter(runtimeId: string): AcpAdapter {
    const local = runtimeId === 'codex-acp' ? localCodexRuntime() : null;
    return new AcpAdapter(this.baseOptions((callbacks) => new AcpClient({
      runtime: (local ?? runtimeId) as never,
      workspaceRoot: this.deps.workspaceRoot ?? process.cwd(),
      clientInfo: { name: 'lingua-studio-gateway', version: '1.0.0' },
      callbacks: acpCallbacks(callbacks),
    })));
  }

  private createCustomAdapter(): AcpAdapter {
    return new AcpAdapter(this.baseOptions(async (callbacks) => {
      const stored = await readStoredAcpProvider();
      if (!stored) {
        throw new BusinessError('E_PROVIDER_NOT_CONFIGURED', '未配置自定义供应商，请先在设置 → Agent 运行时 → 自定义 API 中填写', 'VALIDATION');
      }
      if (!acpClientHonorsCustomEnv(installedAcpClientVersion())) {
        throw new BusinessError('E_ACP_CLIENT_OUTDATED', '网关依赖的 @yitom/acp-client 过旧（自定义 env 被忽略），请升级到 ≥0.1.1 后重启网关', 'VALIDATION');
      }
      const codexHome = getAcpProviderCodexHome();
      mkdirSync(codexHome, { recursive: true });
      writeFileSync(join(codexHome, 'config.toml'), buildCustomProviderConfigToml(stored), 'utf8');
      const local = localCodexRuntime();
      return new AcpClient({
        runtime: (local ?? 'codex-acp') as never,
        workspaceRoot: this.deps.workspaceRoot ?? process.cwd(),
        clientInfo: { name: 'lingua-studio-gateway', version: '1.0.0' },
        env: buildCustomProviderSpawnEnv(stored, stored.apiKey, codexHome),
        callbacks: acpCallbacks(callbacks),
      });
    }));
  }

  public async closeAll(reason = 'pool closed'): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown(reason);
    }
    this.adapters.clear();
    this.specTokens.clear();
  }
}
