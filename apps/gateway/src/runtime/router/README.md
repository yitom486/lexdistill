# runtime/router/ — Agent 与 Tool 路由

| 文件 | 作用 |
|---|---|
| `agent-router.ts` | 按路由策略选择 Agent Adapter；业务模块不直接选择厂商实现 |
| `tool-router.ts` | 根据 Tool Registry 执行 Server、Client、External Tool，并返回标准化结果 |
| `tool-catalog.ts` | Gateway 工具中央目录（基线/意图/提示词表 + 固定任务显式集 + 统一解析入口；MCP 目录见 library/mcp/textbook-mcp-catalog） |
| `turn-tools.ts` | 薄包装（签名不变，转发 tool-catalog；历史测试入口保留） |

路由层属于 Gateway Runtime。领域模块通过自身应用能力和公开契约提供 Tool，不直接依赖具体 Agent 厂商。