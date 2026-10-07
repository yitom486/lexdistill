import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ToolDefinition } from '@study-studio/tool-core';
import { BusinessError, type Result } from '@study-studio/shared';

/**
 * 会话级工具 MCP 桥（ACP 多运行时底座；教材 textbook-mcp-server 的会话版）。
 *
 * - 每个网关会话一个 token 端点，只挂载本轮解析出的工具子集（最小暴露）；
 * - ACP `session/new|resume|load` 全程携带同一 spec（resume 带工具，旧线程冻结问题不存在）；
 * - 执行走调用方注入的 registry.execute（含 zod 校验与异常翻译），与 in-process 同口径；
 * - token 30 分钟无复用即 sweep，会话 detach/close 即 revoke；未知 token 404。
 */
export interface SessionToolCallContext {
  userId: string;
  sessionId: string;
}

export interface SessionToolBridgeDeps {
  execute: (
    toolName: string,
    args: unknown,
    context: SessionToolCallContext,
  ) => Promise<Result<unknown, BusinessError>>;
  /** 网关对外基址（如 http://127.0.0.1:60619），由启动层在 listen 后绑定。 */
  resolveBaseUrl: () => string;
}

export interface SessionMcpServerSpec {
  name: string;
  type: 'http';
  url: string;
  headers: Array<{ name: string; value: string }>;
}

interface BridgeEntry {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  createdAt: number;
  toolNames: string[];
}

const BRIDGE_TTL_MS = 30 * 60 * 1000;

/** zod shape 提取（与 textbook-mcp-server 同规则：ZodEffects 取内层，跨包 instanceof 不可靠）。 */
function zodShapeOf(tool: ToolDefinition): Record<string, z.ZodTypeAny> {
  const schema = tool.schema as unknown as {
    _def?: { typeName?: string };
    innerType?: () => { shape?: Record<string, z.ZodTypeAny> };
    shape?: Record<string, z.ZodTypeAny>;
  };
  const inner =
    schema._def?.typeName === 'ZodEffects' && typeof schema.innerType === 'function'
      ? schema.innerType()
      : schema;
  return inner.shape ?? {};
}

export class SessionToolBridge {
  private readonly entries = new Map<string, BridgeEntry & SessionToolCallContext>();

  constructor(private readonly deps: SessionToolBridgeDeps) {}

  public create(userId: string, sessionId: string, tools: ToolDefinition[]): { token: string; spec: SessionMcpServerSpec } {
    const token = `st-${randomUUID()}`;
    const server = new McpServer({ name: 'lingua-session-tools', version: '1.0.0' });
    const context: SessionToolCallContext = { userId, sessionId };
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: zodShapeOf(tool) },
        async (args: Record<string, unknown>) => {
          const res = await this.deps.execute(tool.name, args, context);
          if (!res.ok) {
            const message = res.error instanceof BusinessError ? res.error.userMessage : String(res.error);
            return { content: [{ type: 'text' as const, text: message }], isError: true };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(res.value) }] };
        },
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    void server.connect(transport);
    this.entries.set(token, { server, transport, createdAt: Date.now(), toolNames: tools.map(tool => tool.name), ...context });
    return {
      token,
      spec: {
        name: 'lingua-session',
        type: 'http',
        url: `${this.deps.resolveBaseUrl().replace(/\/$/, '')}/mcp/session/${token}`,
        headers: [],
      },
    };
  }

  public async handleRequest(token: string, req: Request): Promise<Response> {
    const entry = this.entries.get(token);
    if (!entry) {
      return Response.json({ error: 'unknown session tool bridge' }, { status: 404 });
    }
    return entry.transport.handleRequest(req);
  }

  public revoke(token: string): boolean {
    return this.entries.delete(token);
  }

  public sweep(now = Date.now(), maxAgeMs = BRIDGE_TTL_MS): number {
    let removed = 0;
    for (const [token, entry] of this.entries) {
      if (now - entry.createdAt > maxAgeMs) {
        this.entries.delete(token);
        removed += 1;
      }
    }
    return removed;
  }
}
