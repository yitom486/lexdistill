/**
 * 教材 MCP 服务器中央目录（领域内唯一 owner）。
 *
 * G5-R2 禁止领域反向依赖 Runtime，故不住 `runtime/router/tool-catalog.ts`；
 * Gateway 工具选型目录在那边，两者文件头互指。调用方（教材导入管线、
 * 未来复用按 Worker 隔离端点的管线）只经本文件拿服务器形状与命名，
 * 不得各自手写 `{ name, type, url, tools }` 字面量。
 *
 * 工具名与 `textbook-mcp-server.ts` 的 TOOL_NAMES 同源（服务端按名入表）；
 * 改名时两处同改，门禁 `textbook-mcp-catalog.test.ts` 锁六工具全量。
 */

export type TextbookMcpWriteToolName =
  | 'write_grammar'
  | 'write_vocabulary'
  | 'write_exercises'
  | 'write_articles'
  | 'write_sentences'
  | 'write_material';

/** 教材写入六工具：MCP 侧与服务端 scope 同名，后端按名入表。 */
export const TEXTBOOK_MCP_WRITE_TOOLS: readonly TextbookMcpWriteToolName[] = [
  'write_grammar',
  'write_vocabulary',
  'write_exercises',
  'write_articles',
  'write_sentences',
  'write_material',
] as const;

export interface TextbookWorkerMcpServerSpec {
  name: string;
  type: 'http';
  url: string;
  default_tools_approval_mode: 'approve';
  tools: Record<TextbookMcpWriteToolName, { approval_mode: 'approve' }>;
}

/**
 * 按 Worker 生成独立 MCP 端点声明：名称按 Worker 唯一（`lingua-textbook-w${i}`），
 * 六个写入工具全部预授权 approve；approvalPolicy 仍由调用方保持默认 never。
 */
export function buildTextbookWorkerMcpServer(
  workerIndex: number,
  gatewayBaseUrl: string,
  taskPath: string,
): TextbookWorkerMcpServerSpec {
  const tools = {} as Record<TextbookMcpWriteToolName, { approval_mode: 'approve' }>;
  for (const name of TEXTBOOK_MCP_WRITE_TOOLS) tools[name] = { approval_mode: 'approve' };
  return {
    name: `lexdistill-textbook-w${workerIndex}`,
    type: 'http',
    url: `${gatewayBaseUrl.replace(/\/$/, '')}${taskPath}`,
    default_tools_approval_mode: 'approve',
    tools,
  };
}
