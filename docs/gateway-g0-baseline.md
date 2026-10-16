# Gateway G0 基线清单（冻结基线）

> 日期：2026-09-05。来源：`apps/gateway/src/index.ts`（1,733 行）静态枚举 +
> `packages/protocol/src/events.ts` + `apps/gateway/src/tools/*`。
> 迁移期间任何阶段验收都以本清单为对照：URL、事件名、Tool name/schema/权限、
> 公开导出、端口与 DB 路径语义不得无声变化。

## 1. HTTP 路由（method + path，共 80 条）

### 健康与 Agent 管理

| Method | Path |
|---|---|
| GET | `/health`, `/api/health` |
| GET | `/api/agent/codex/status`, `/api/agent/codex/models` |
| GET | `/api/agent/codex/threads`, `/api/agent/codex/threads/:threadId/items` |
| POST | `/api/agent/codex/threads/:threadId/name`, `.../archive`, `.../compact`, `.../fork` |
| GET | `/api/agent/codex/collaboration-modes` |
| GET/POST/DELETE/POST | `/api/agent/codex/threads/:threadId/queue`（list/add/remove `/:queuedId`/start） |
| GET | `/api/agent/codex/skills`, `/api/agent/codex/rate-limits`, `/api/agent/codex/mcp-servers` |
| GET | `/api/agent/codex/realtime/capability`, `/api/agent/codex/realtime/voices` |
| POST | `/api/agent/codex/realtime/:threadId/start`, `.../stop`, `.../append-text`, `.../append-speech`, `.../append-audio` |

### 词典 / 生词

| Method | Path |
|---|---|
| GET | `/api/dictionary/packages` |
| POST | `/api/dictionary/packages/:packageId/install` |
| GET | `/api/dictionary/:language` |
| POST | `/api/vocabulary/:userId/entries/:entryId/collect` |

### 画像 / 每日任务 / 学习计划 / 分析

| Method | Path |
|---|---|
| GET/POST | `/api/profile/:userId` |
| GET | `/api/task/progress/:userId`, `/api/task/history/:userId` |
| POST | `/api/task/activity/:userId` |
| GET | `/api/learning/plan/:userId` |
| POST | `/api/learning/plan/:userId/complete` |
| GET | `/api/learning/analysis/:userId` |
| POST | `/api/learning/content/:userId`, `/api/learning/assess/:userId` |

### 练习计划与运行（G1 试点范围）

| Method | Path |
|---|---|
| GET | `/api/practice/templates/:userId`, `/api/practice/templates/:userId/:templateId` |
| POST | `/api/practice/templates` |
| DELETE | `/api/practice/templates/:userId/:templateId` |
| PATCH | `/api/practice/templates/:userId/:templateId/enabled` |
| POST | `/api/practice/templates/:userId/:templateId/copy` |
| POST | `/api/practice/templates/propose`, `/api/practice/templates/apply-proposal` |
| POST | `/api/practice/runs/start` |
| GET | `/api/practice/runs/:userId/:runId`, `/api/practice/runs/:userId/:runId/items`, `/api/practice/runs/:userId/:runId/summary` |
| POST | `/api/practice/runs/draft`, `/api/practice/runs/submit-objective`, `/api/practice/runs/submit-subjective`, `/api/practice/runs/submit-batch`, `/api/practice/runs/finalize` |
| POST | `/api/practice/runs/:userId/:runId/assemble` |
| GET | `/api/practice/collections/:userId`, `/api/practice/collections/:userId/:collectionId/items` |
| POST | `/api/practice/items/:userId/to-cards` |

### 卡片 / 错题 / 题库

| Method | Path |
|---|---|
| GET/POST | `/api/cards/:userId` |
| POST | `/api/cards/:userId/:cardId/review` |
| GET | `/api/mistakes/:userId` |
| POST | `/api/mistakes/:userId`, `/api/mistakes/:userId/resolve/:mistakeId`, `/api/mistakes/:userId/retry/:mistakeId` |
| GET/POST | `/api/questions/:userId` |

### 文档 / 批注 / 课程 / 阅读

| Method | Path |
|---|---|
| GET/POST | `/api/documents/:userId` |
| GET/DELETE | `/api/documents/:userId/:documentId` |
| GET/POST | `/api/annotations/:userId/:documentId`（list/add） |
| DELETE | `/api/annotations/:userId/:annotationId` |
| POST | `/api/annotations/:userId/:annotationId/to-card` |
| GET | `/api/curriculum/kana` |
| POST | `/api/curriculum/kana/practice/:userId` |
| GET | `/api/reading/sets/:userId`, `/api/reading/news-topics`, `/api/curriculum/pitch` |
| POST | `/api/reading/generate/:userId`, `/api/reading/practice/:userId` |

## 2. WebSocket（`/ws`，`packages/protocol/src/events.ts`）

客户端 → 网关：`client.session.init`, `client.turn.send`, `client.quiz.submit`,
`client.quiz.generate`, `client.quiz.grade_subjective`, `client.card.review`,
`client.tool.result`, `client.approval.respond`, `client.turn.interrupt`,
`client.turn.steer`, `client.queue.start`, `client.ping`, `client.profile.get`,
`client.profile.update`, `client.task_progress.get`, `client.task_activity.record`。

网关 → 客户端：`agent.turn.start`, `agent.text.delta`, `agent.reasoning.delta`,
`agent.tool.call`, `agent.approval.request`, `agent.approval.resolved`,
`agent.turn.completed`, `agent.queue.changed`, `agent.skills.changed`,
`agent.realtime.*`（started/closed/error/transcript.delta/transcript.done/audio.delta/sdp/item.added，
注：realtime 仅协议占位，完整音频/SDP 管线尚未接入）,
`agent.error`（含 `E_WS_INTERNAL` 回退）, `learner.profile.updated`,
`learner.daily_task.updated`, `learner.mistake.added`, `gateway.pong`。

## 3. Tool 清单（name / location / permission / actions）

| name | location | permission | actions（zod enum） |
|---|---|---|---|
| `learning.content` | SERVER | READ | generate_quiz, explain, example_set, kana_drill, generate_passage, generate_writing_prompt, generate_for_block |
| `learning.assess` | SERVER | READ | grade, diagnose, grade_batch |
| `learning.practice` | SERVER | WRITE | start_run, get_run, save_draft, submit_objective, submit_subjective, submit_batch, finalize_run, summarize_run |
| `learning.plan` | SERVER | WRITE | get, complete_step, list_templates, get_template, preview_template, get_today_run, propose（跨 practice + learning-progress，见迁移计划 §4.2） |
| `learning.progress` | SERVER | WRITE | record_mistake, resolve_mistake, upsert_skill, review_card, record_quiz_attempt |
| `learning.library` | SERVER | READ | list_documents, get_document_slice, list_annotations, list_news_topics |
| `learning.curriculum` | SERVER | READ | get_kana_chart, search_entry, list_pitch_benchmarks, lookup_pitch |
| `dictionary.lookup` | SERVER | READ |（无 action 枚举：语言 + query 直查） |
| `quiz.generateAdaptive` | SERVER | READ |（旧版自适应出题，仅兼容回退） |
| `quiz.gradeSubjective` | SERVER | WRITE |（旧版主观批改） |
| `ui.navigate` | CLIENT | WRITE |（经 WS 下发前端执行） |
| `ui.present` | CLIENT | WRITE |（经 WS 下发前端执行） |

迁移期间不改变公开 name/schema/权限/location。

## 4. 公开导出与调用方

`apps/gateway/package.json`：`main: ./src/index.ts`；`index.ts` 导出：
`server.js`（`GatewayServer`）、`session-manager.js`、`context-builder.js`、
`tool-router.js`、`agent-router.js`、`db/index.js`、`drizzle-learner-repository.js`、
`sqlite-learner-repository.js`、`http-error-handler.js`、`GatewayAppType`（Hono 链式推断类型）、
单例 `drizzleRepo`/`sqliteRepo`（别名）/`gatewayServer`、`app`、`startGatewayServer`。

调用方：`apps/web/src/lib/api-client.ts` 用 `hc<GatewayAppType>` 做类型安全 RPC；
`scripts/import-oewn.ts` 复用 `dictionary-packages.js` 解析器。

## 5. 启动、端口、环境变量、资源路径

- 脚本：`bun src/index.ts`（start）、`bun --watch src/index.ts`（dev）、
  `bun src/scripts/import-oewn.ts`（`dictionary:import:oewn`）。
- 端口：`GATEWAY_PORT`，默认 **8080**（注：8999 仅为 `gateway-websocket.test.ts` 的测试端口；
  纠正：`apps/gateway/src/README.md` 曾误写默认 8999，需同步修正）。
- 环境变量：`GATEWAY_PORT`、`STUDY_STUDIO_DB`（默认 `<repo>/lexdistill.db`，
  由 `path.resolve(import.meta.dir, '../../..', 'lexdistill.db')` 解析；import-oewn 无变量时默认
  `./lexdistill.db`）、`NODE_ENV`/`BUN_ENV=test`（测试内存库）。
- 单例注意：`index.ts` 模块加载即 `new DrizzleLearnerRepository(dbPath)` +
  `new GatewayServer(...)`；迁移提取时兼容导出不得重复创建实例或重复监听。

## 6. 测试与类型基线（2026-09-05 实测）

- `bun run typecheck`：零报错。
- `bun test`：574 通过、0 失败，83 个文件（含 `dist` 编译产物重复计入；`src` 侧含新增
  `practice-grading.test.ts` 4 用例）。
- 若基线已有失败必须先记录，不可声明迁移验收通过。
