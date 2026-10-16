# bootstrap/ — 启动装配（进程内只执行一次）

| 文件 | 作用 |
|---|---|
| `config.ts` | `GATEWAY_PORT`（默认 8080）、`STUDY_STUDIO_DB`（默认仓库根 `lexdistill.db`，测试 `:memory:`） |
| `create-gateway.ts` | `createGateway()`：Repo + Adapter + GatewayServer 装配根；测试可显式注入 |
| `start-gateway.ts` | `startGateway(app, server, port)`：`Bun.serve` 同时承载 `/ws` 升级与 Hono HTTP，只管监听生命周期 |

约束：领域与传输层代码不得引用本目录；只能由 `index.ts`（生产入口）调用。
