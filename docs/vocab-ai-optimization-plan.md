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

## P10 ACP Phase 1（进行中）
- 适配器补完：审批全流（REQUESTED→RESOLVED、120s 超时、inflight 跟踪）；never/缺席自动放行；中断/steer/`submitToolResult` 明确拒绝；model-free 单测 3/0。
- UI 先行：`AgentRuntimeSelect`（8 运行时＋自定义 API，主聊＋单词配置双入口，偏好持久化，`runtimeId` 已下发；未配置标灰，进设置页）。
- 网关底座：`SessionToolBridge`（token 端点＋最小工具集＋TTL/sweep）＋`runtime-catalog`（id/认证态，custom 伪条目）＋`GET /api/agent/runtimes`＋`/mcp/session/:token`＋凭证存取路由（Key 永不回传）。
- 路由：codex-acp 留守 Codex（等 parity 再翻），其余＋custom 走 ACP 温复用池；切换必重建，跨协议不续接；custom 供隔离 CODEX_HOME＋Key 环境（需 acp-client 发版生效 env 合并，改动已在你仓库 WIP）。
- 待办：codex-acp 切 ACP（模型/思考深度映射验证后）。
- 面板去 Codex 化已合入：历史/技能/MCP/用量/队列查询按开关停拉，表头用量与历史/技能入口隐藏＋明示，输入条脚注按运行时切换，回执带 `adapter`＋`runtimeId` 诊断。
- 选择驱动修正：非 Codex 下模型标签显示“运行时自带”（不再残留 luna 旧名造成“无法选中”误会）；表头副标题显示选中运行时；18/0。
- 真实选项已合入：`GET /api/agent/runtimes/:id/options`（建会话读 configOptions，10 分钟缓存）＋网关发前证伪拦截（旧 id 串台改默认＋toast 警告）＋前端按运行时拉真实模型/深度列表＋按运行时记忆选择＋切换重置会话；22/0。
- acp-client 对接收尾（本轮）：SDK 侧 `env` 透传＋图片 prompt 块已提交待发版（`cb14b00`，0.1.1，未 push）；网关侧 custom 探针改走 codex-acp＋自定义 env（与会话同链路，未配置不 spawn）＋旧 SDK（0.1.0）fail-fast（`E_ACP_CLIENT_OUTDATED` 可读错，不静默鉴权失败）；16/0＋typecheck 零错。
- codex-acp 已翻转（spike 带 luna＋medium 建会话＋两轮工具＋resume 全绿）：已知残留差异——中断/steer 明确拒绝、collaborationMode 暂忽略、旧 codex thread 续接首轮失忆（均有声失败或注释）。
- 能力开关已合入：模型/思考深度控件由后端 capabilities 驱动禁用（codex 全开保 luna，其余用 Agent 默认；零按 id 特例），`useSelectedRuntimeCaps` fail-open。
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
