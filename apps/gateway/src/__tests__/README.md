# __tests__/ — 网关单测

| 文件 | 覆盖 |
|---|---|
| `modules/practice/__tests__/practice-assembly.test.ts` | 按块装配、题型映射、跨块去重、缺题回退（G1 已归组） |
| `modules/practice/__tests__/practice-grading.test.ts` | 服务端权威判题：选择、填空变体、排序、缺题回退（G1 已归组） |
| `practice-collect.test.ts` | 生成题目持久化到 `practice_collections` / `practice_items` |
| `gateway-websocket.test.ts` | WS 连接、事件收发 |
| `turn-summary.test.ts` | Turn 汇总与复盘 |

正式门禁：bun run test:all 与 bun run typecheck（仓库根执行）。定位失败时可单独运行 bun test apps/gateway/src/__tests__/xxx.test.ts。
