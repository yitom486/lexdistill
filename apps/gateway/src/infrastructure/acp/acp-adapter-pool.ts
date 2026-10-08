import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  AcpClient,
  buildCustomProviderConfigToml,
  buildCustomProviderSpawnEnv,
  getAcpProviderCodexHome,
  readStoredAcpProvider,
} from '@yitom/acp-client';
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
   */
  public getRuntimeOptions(runtimeId: string): Promise<AgentRuntimeOptions> {
    return getAgentRuntimeOptions(runtimeId, {
      createClient: (id) => new AcpClient({
        runtime: id,
        workspaceRoot: this.deps.workspaceRoot ?? process.cwd(),
        clientInfo: { name: 'lingua-studio-gateway-probe', version: '1.0.0' },
        callbacks: {},
      }),
    });
  }

  private baseOptions(
    createClient: AcpAdapterOptions['createClient'],
  ): AcpAdapterOptions {
    return {
      createClient,
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
