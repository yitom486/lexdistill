import { describe, expect, it } from 'bun:test';
import {
  TEXTBOOK_MCP_WRITE_TOOLS,
  buildTextbookWorkerMcpServer,
} from '../mcp/textbook-mcp-catalog.js';

describe('textbook-mcp-catalog（教材 MCP 中央目录）', () => {
  it('写入六工具全量且与服务端同名', () => {
    expect([...TEXTBOOK_MCP_WRITE_TOOLS]).toEqual([
      'write_grammar',
      'write_vocabulary',
      'write_exercises',
      'write_articles',
      'write_sentences',
      'write_material',
    ]);
  });

  it('按 Worker 生成唯一命名 + 六工具全部预授权', () => {
    const a = buildTextbookWorkerMcpServer(0, 'http://127.0.0.1:8787', '/mcp/textbook/t0/w/0');
    const b = buildTextbookWorkerMcpServer(1, 'http://127.0.0.1:8787', '/mcp/textbook/t0/w/1');
    expect(a.name).toBe('lingua-textbook-w0');
    expect(b.name).toBe('lingua-textbook-w1');
    expect(a.type).toBe('http');
    expect(a.default_tools_approval_mode).toBe('approve');
    for (const tool of TEXTBOOK_MCP_WRITE_TOOLS) {
      expect(a.tools[tool]).toEqual({ approval_mode: 'approve' });
    }
    expect(Object.keys(a.tools).length).toBe(6);
  });

  it('网关基址末尾斜杠归一，端点路径原样拼接', () => {
    const s = buildTextbookWorkerMcpServer(2, 'http://127.0.0.1:8787/', '/mcp/textbook/t9/w/2');
    expect(s.url).toBe('http://127.0.0.1:8787/mcp/textbook/t9/w/2');
    expect(s.name).toBe('lingua-textbook-w2');
  });
});
