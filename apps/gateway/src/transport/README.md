# transport/ — 协议适配（不持有权威学习规则）

| 路径 | 作用 |
|---|---|
| `http/create-app.ts` | `createApp(deps)`：CORS/错误兜底/404 + 各域 `.route('/', …)` 组装；import 本模块不打开真实 DB |
| `http/health-routes.ts`、`http/agent-routes.ts` | 健康检查、Codex Agent 管理接口 |
| `http/learning-routes.ts` | 跨域兼容入口：`learning.content` / `learning.assess` 只做 Tool 委托 |
| `../composition/gateway-deps.ts` | `GatewayDeps`：路由唯一的依赖来源（repo/server/port；E4a 起家于此，组合契约不跨包） |
| `websocket/websocket-handler.ts` | WS 信封解析与事件转发，业务经 `GatewayServer.handleClientMessage` |
| `tools/` | 跨域 Tool 入口（learning-plan、ui-*）+ `register-tools.ts`（装配根调用）；`learning.content` 实现在 `modules/learning-content/tools/` |
