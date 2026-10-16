import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ToolDefinition } from '@lexdistill/tool-core';

/**
 * Phase 0 spike 专用 MCP 桥（不进生产装配、不导出）。
 * 把网关 ToolDefinition 装成 HTTP MCP 服务器，供 ACP 会话挂载：
 * Agent 直调 MCP → handler 内走 registry 同款 execute（含 zod 校验）→ 调用记录可断言。
 */
export interface SpikeBridgeCall {
  tool: string;
  args: unknown;
}

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

export async function startSpikeToolBridge(
  tools: ToolDefinition[],
  onCall: (call: SpikeBridgeCall) => void,
): Promise<{ mcpServer: { name: string; type: 'http'; url: string; headers: Array<{ name: string; value: string }> }; close: () => Promise<void> }> {
  const server = new McpServer({ name: 'lingua-spike-tools', version: '0.0.0' });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: zodShapeOf(tool) },
      async (args: Record<string, unknown>) => {
        onCall({ tool: tool.name, args });
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
          return { content: [{ type: 'text' as const, text: `参数不合法：${parsed.error.message}` }], isError: true };
        }
        const res = await tool.execute(parsed.data, { userId: 'spike', sessionId: 'spike' });
        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: res.error.userMessage }] , isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.value) }] };
      },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);
  // StreamableHTTP 的 GET 事件流是长连接：Bun 默认 10s 空闲杀掉会掐断 Agent 订阅，spike 给足。
  const http = Bun.serve({ port: 0, idleTimeout: 120, fetch: async (req) => {
    const body = req.method === 'POST' ? await req.clone().text().catch(() => '') : '';
    const method = body ? (JSON.parse(body) as { method?: unknown }).method ?? '?' : req.method;
    const res = await transport.handleRequest(req);
    console.log(`[spike-bridge] ${req.method} ${method} -> ${res.status}`);
    return res;
  } });
  return {
    // codex-acp 的 new/load/resume 全接受 mcpServers；HTTP 形态必填 headers（缺失会被静默跳过，无错）。
    mcpServer: { name: 'lingua-spike', type: 'http', url: `http://127.0.0.1:${http.port}/mcp`, headers: [] as Array<{ name: string; value: string }> },
    close: async () => {
      http.stop(true);
      await transport.close();
    },
  };
}
