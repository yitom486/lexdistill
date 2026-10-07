import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { AcpClient } from '@yitom/acp-client';
import { AcpAdapter } from '@study-studio/agent-runtime';
import type { SessionToolBridge } from '../../runtime/mcp/session-tool-bridge.js';

/**
 * ACP 适配器池（网关基础设施层；温进程复用，同 runtime 单客户端）。
 *
 * - 同 runtime 的会话共用一个 AcpClient（inkdown 同款温进程），不再每轮现拉；
 * - codex-acp 直调本地 pin 死的发行版（lumina 同款本地优先）；缺失回落 builtin 模板（bunx）；
 * - MCP 桥 token 由网关 SessionToolBridge 配发，会话 close 即 revoke（另有 30 分钟 sweep 兜底）。
 */
export interface AcpAdapterPoolDeps {
  bridge: SessionToolBridge;
  workspaceRoot?: string;
}

function resolveLocalCodexAcpEntry(): string | null {
  try {
    const pkg = createRequire(import.meta.url).resolve('@agentclientprotocol/codex-acp/package.json');
    return join(dirname(pkg), 'dist', 'index.js');
  } catch {
    return null;
  }
}

export class AcpAdapterPool {
  private readonly adapters = new Map<string, AcpAdapter>();
  private readonly specTokens = new Map<unknown, string>();

  constructor(private readonly deps: AcpAdapterPoolDeps) {}

  public get(runtimeId: string): AcpAdapter {
    const existing = this.adapters.get(runtimeId);
    if (existing) return existing;
    const localEntry = runtimeId === 'codex-acp' ? resolveLocalCodexAcpEntry() : null;
    const adapter = new AcpAdapter({
      createClient: (callbacks) => new AcpClient({
        runtime: localEntry
          ? {
              id: `${runtimeId}-local`,
              name: `${runtimeId}（本地 pin 版）`,
              description: '直调本地发行版，不走 bunx @latest',
              command: process.execPath,
              args: [localEntry],
              requiredEnvKeys: [],
            }
          : runtimeId,
        workspaceRoot: this.deps.workspaceRoot ?? process.cwd(),
        clientInfo: { name: 'lingua-studio-gateway', version: '1.0.0' },
        callbacks: {
          onSessionUpdate: callbacks.onSessionUpdate,
          onPermissionRequest: callbacks.onPermissionRequest,
          onLog: callbacks.onLog,
          onStderrLine: callbacks.onStderrLine,
        },
      }),
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
      revokeMcpServer: (token) => { this.specTokens.forEach((value, key) => { if (value === token) this.specTokens.delete(key); }); this.deps.bridge.revoke(token); },
    });
    this.adapters.set(runtimeId, adapter);
    return adapter;
  }

  public async closeAll(reason = 'pool closed'): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown(reason);
    }
    this.adapters.clear();
    this.specTokens.clear();
  }
}
