# runtime/ — 通用 Agent 运行时协调（非学习领域）

| 路径 | 作用 |
|---|---|
| `gateway-runtime.ts` | `GatewayServer`：会话/流式事件编排、Tool 调度、Adapter 接线（原 `src/server.ts`，G3 搬入；`src/server.ts` 兼容 stub 已在 G5 删除） |
| `handlers/turn-handlers.ts` | 处理 Turn 发送与流式输出 |
| `handlers/queue-handler.ts` | 消费 Agent 队列并汇总队列 Turn |
| `handlers/control-handlers.ts` | 处理审批、打断、引导与客户端工具回执 |
| `context/context-builder.ts` | 把客户端已知事实与学习摘要组合为随 Turn 注入的 `ContextSnapshot` |
| `session/session-manager.ts` | 管理客户端会话与 Agent Session 的创建、恢复、查找、关闭及 Tool Result 回填 |
| `router/agent-router.ts` | 根据路由策略选择符合契约的 Agent Adapter |
| `router/tool-router.ts` | 检查 Tool 权限与位置，执行 Server/Client/External Tool 并回填结果 |
| `router/turn-tools.ts` | 按本轮意图选取工具 allowlist，并约束专精会话可调用的工具 |
| `responses-lite-coach.ts` | 轻量旁路教练（快问快答），学习闭环默认走 Agent |
| `turn-summary-builder.ts` | Turn 执行摘要与失败回退文案 |

约束：领域模块不得（值）引用运行时协调器；`module-boundaries.test.ts` 强制执行。