# 词汇＋AI 优化计划（worktree：study-studio-vocab-ai）

> 状态：P0 已合入 master（`9afe1353`、`7865222e`、`b4193af0`）。
> 约束：WRITE 类工具必须明示才给；固定任务走 `task` id；改动按批提交并 ff 到 master。

## P0 已完成（中央目录＋task 闭环）
- `runtime/router/tool-catalog.ts`：Gateway 工具选型唯一 owner（基线/意图/提示词表＋`TASK_TOOL_PRESETS`＋`resolveSessionTools`/`resolveTaskTools`）。
- `modules/library/mcp/textbook-mcp-catalog.ts`：教材 MCP 服务器唯一 owner（六写入工具＋`buildTextbookWorkerMcpServer`）。
- `turn-handlers`：`task`＞`tools`＞提示词；升级判定用同一份请求集。
- `useWordTutor`：首个 `task: 'vocabulary.explain'` 发送方。
- 文档：`agent-runtime.md` 门禁第 5 条＋路由 README＋PDF 流程 MCP 归属。

## P1 主聊默认 vocab 读工具（已完成）
- `READ_BY_INTENT.FREE_COACH` 加 `vocabulary.learning.context`（只读；`submit` 仍需“生成讲解”类明示）。

## P2 教材行学习 UI 接线（已完成）
- `WordChatThread` 纯展示线程抽出（`WordAiPanel` 改调，行为不变）；`TextbookWordAiPanel` 教材行面板（行 ID 进指令经 `textbookVocabularyId` 绑定，存后刷词汇库＋词表）。
- `StructuredVocabularyList` 加 `enableAi`（默认关，导入预览不受影响）；`TextbookCurriculum` 学习路径开启。
- 验收：dom 测试（默认无入口→展开→收起）。

## P6 Batch A 前端去重（已完成）
- `WordTutorPanel` 容器合一（`WordAiPanel`＋`TextbookWordAiPanel` 变薄；target 按字段 memo，send 稳定）。
- `getWordUsageList`＋`selectVocabularyForCard`（id 优先两段式）收归 `queries/vocabulary.ts`；`WordStudyDetail`＋`FsrsCardWorkbench` 改调（Hub 侧等对方合入）。
- 旧会话工具缺失升级按本轮解析集判定＋缺失工具服务端 warn（`32adc715`，修用户截图“找不到工具”）。
- 验收：选择器单测＋面板 dom 回归 18/0；typecheck 零新增。

## P7 Batch B 后端正确性（已完成，本轮）
- 任务一次一用（成功即消费，重试重调 context；TTL 单一 `TASK_TTL_MS` 源）。
- `getVocabularyEntry` 按 id 直查（context 热路径不再全表扫描；组装与列表页共用）。
- 每日抽词逐词门禁（混级词按自带 jlpt 判定＋`skippedLocked` 实计数；有效词等级不再被库等级覆盖；空级显示 0% 为有意口径，注释锁定）。
- 掌握统计联表补用户＋语种归属。
- 验收：vocab-learning／daily-pick／flashcards／gate 33/0；typecheck 零新增。

## P8 “找不到工具”根治（已完成，本轮）
- 发送前预检（`GET /api/agent/tools` 60s 缓存，缺失就地拦截提示，不烧模型轮次；探测失败放行）。
- 网关 fail-fast（显式任务零落点：不建会话不调模型，直接回可操作文案；`toolWarnings` 进回执）。
- 验收：路由单测＋预检 dom＋回归 25/0；typecheck 零新增。

## P9 ACP 迁移 Phase 0 spike（已证，72 秒一次过）
- 桥记录铁证：首轮 `dictionary.lookup` 调用＋resume（`session restore ok`）后 `flashcards.due` 再调——resume 带工具成立，Codex 旧链路的死结解开。
- 附带修通：更新包实形状映射、HTTP 必填 `headers`、Bun 长连接超时、SDK prompt 120s、本地 pin（`@agentclientprotocol/codex-acp ^2.1.1`，不再赌 bunx）、建连抖动重试、单 adapter 只连一次。
- 遗留要求（Phase 1 立项条件）：`pickAllowOptionId` 审批映射、事件全量映射、中断/steer、温进程池、turn 预算收敛。

## P3 Hub 锁态 409 对齐（对方地盘，只 review 不动手）
- `DailyWordStudyHub` 课程单元扩展返回 400 而非 409，锁 banner 失效；文件在对方手里，等它改。

## P4 E2E 真机验证（等用户）
- 用户重启网关（新代码）＋确认 luna；一次生成 run，验保存→渲染。

## P5 MCP 外部真通道（已关闭：无需求，不做）
- 立项分析结论：全仓零 `EXTERNAL` 注册工具（仅 `permissions` 定义＋`ToolRouter` stub 分支）；Anki 经 SERVER 工具 `flashcards.anki_push` 直连本机 AnkiConnect，已覆盖；Notion 等无需求方。
- 按简单优先＋`agent-runtime.md`（禁 Server Tools 无故改道 MCP），stub 保留，待真实外部系统出现再立项。
