# runtime/router/ — Agent 与 Tool 路由

| 文件 | 作用 |
|---|---|
| `agent-router.ts` | 按路由策略选择 Agent Adapter；业务模块不直接选择厂商实现 |
| `tool-router.ts` | 根据 Tool Registry 执行 Server、Client、External Tool，并返回标准化结果 |
| `turn-tools.ts` | 按回合意图收窄工具集，并执行会话级 allowlist 约束 |

路由层属于 Gateway Runtime。领域模块通过自身应用能力和公开契约提供 Tool，不直接依赖具体 Agent 厂商。