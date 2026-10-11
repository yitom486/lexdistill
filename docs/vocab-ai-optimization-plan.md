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
- 真实选项已合入：`GET /api/agent/runtimes/:id/options`（建会话读 configOptions，10 分钟缓存）＋网关发前证伪拦截（旧 id 串台改默认＋toast 警告）＋前端按运行时拉真实模型/深度列表＋按运行时记忆选择＋切换重置会话；22/0。解析已委托 acp-client（`parseAcpConfigOptions`＋`findModelConfigOption`，网关手搓 `pickEntry` 已删；effort 暂无 SDK finder，按同款哲学最小匹配）。codex-acp 模型源已纠正：实测 ACP 探针有 `gpt-6.1-sol` 而 App Server `model/list` 没有（两套目录不一致，会话跑在 ACP 上），故 codex-acp 模型/思考深度改走 ACP 探针，前端 codex 特例门控已删；16/0＋8/0＋typecheck 零错。
- 历史/排队走 ACP 已合入（`AcpConversationLedger` 网关台账：建会话/回合完成入索引＋transcript，JSON 落盘；`session/load` 只恢复上下文。sessions/items/改名/归档/队列按归属路由，compact/fork 对 ACP 大声拒绝；MCP 注入 SDK 全程携带已由 spike 证实，无需另建；队列消费走 WS 同一事件映射；前端零改动）；48/0＋14/0＋typecheck 零错。
- 前端 UI 对齐已合入：新增 `supportsHistory`（ACP 全运行时历史/队列走台账；用量仍 Codex 专属），历史面板/查询/开机恢复按 `threads||history` 开门，脚注改写为“历史/队列走网关台账 · 用量面板不可用”，下拉显示探针命中的真实选择名（探针失败标题带错）；34/0＋typecheck 零错。
- configId 发现＋偏好降级已合入：各 Agent 选项 id 不一（OpenCode 无 `reasoning_effort`，旧代码硬编码致整轮失败回本地）。适配器经注入式 `describeConfigIds` 用会话真表发现 id（解析归网关 SDK，适配器零 SDK 依赖），无选项则跳过、有错则警告走默认（toast 明示，回合照常）；51/0＋7/0＋typecheck 零错。
- 思考档发现规则移植已合入（网关 `model-thinking`，SDK 零改动零发版）：独立选项 rank2 规则（thought|reason|effort＋thought_level）→直设；方括号变体（同 base listed≥2）→模型 id 改写；两者皆无→不可设如下游一致不发明。探针变体档标 `effortsVariant`（发前不误杀，建会话 live 解析）；opencode 现状（model＋mode 无变体）如实空；77/0＋typecheck 零错。
- 动态级联已合入（实测破案：OpenCode `session/new` 仅 model＋mode，切模型后回执动态追加 `effort`；SDK 回执本就带全量表，网关此前直接丢弃）。建会话模型设置成功即读刷新表再发现档位 id；探针 `?model=` 先设再读（缓存键带模型）；发前验证用目标模型档位表；前端 model 变化重拉档位。实机铁证：Muse Spark→minimal/low/medium/high/xhigh/default，GPT-6 Luna→none/low/medium/high/xhigh/max/default，与 ACP Studio 截图逐项一致，零硬编码。
- 全面 ACP 对齐已合入：① 上下文用量（`usage_update` 只读透传→turn 回执→表头“上下文 %”徽标，切运行时清零；配额类全协议无对应物，楷模亦无——不编）；② 额度芯片/用量查询对 ACP 关闭（目录全 false；网关状态改为自有就绪，不再被 Codex 单账户卡门禁）；③ codex-acp 线程帽摘掉（Codex 原生 Skills/MCP 面板隐藏，历史走台账）；④ Mode 选择器仅旧链路可见（ACP 会静默忽略，不给用户假开关）；⑤ 批处理 lane（生成/导入/精读）经核执行后端仍是 agentpools＋Codex（systemPrompt/sandboxMode 无 ACP 对应），其 picker 保留原目录——不是残留，是归属正确；realtime 命名空间 internals、agentpools、CodexAdapter、逃生 id 保留（教材管线＋语音 staging＋逃生）。83/0＋typecheck 零错。
- ACP 会话身份已合入：协议 `session/new` 无 systemPrompt 字段（仅 cwd＋mcpServers），身份随新会话首条消息前置（导师＋中文直答＋禁英文前缀；台账 `recordSessionCreated` 返回首轮标记，常驻上下文靠 resume）。老会话迁移：`ensureIdentityApplied` 按身份版本补一次（续跑的旧上下文借此纠正，不再出现编程助手）。
- ACP 批执行立项 core 已合入（`LINGUA_ACP_BATCH=1` 缺席默认关）：桥调用记录收割（成功/失败均记参记果，take/peek＋revoke/sweep 连带清；会话 `listMcpTokens` 定位）、台账 lane 过滤（用户历史默认 coach/learning，`batch:*` 隐藏但可查）、批首消息组装＋lane 命名。未动调用方：目录提炼/出题逐 lane 切＋真机验证在后（文件输入、工具态收割、预算重计、取消语义逐项落地）。
- 目录提炼 lane 已切（首个批 lane，flag 门后）：路由接受 `runtimeId`（两输入分支）→`resolveBatchAdapter` 选池（用户历史默认排除批 lane）→模型/档位发前证伪（400 大声拦，与聊天同一实现）→文字版内嵌页文字（原物理页分隔，`extractOriginalPageTexts` 逐页取字）→`library.propose_toc` 经桥直收（sessionId 对齐 take 键）；扫描版/无字版大声拦（无静默回落）。前端请求带所选运行时，目录 picker 运行时感知（探针级联档位）。79/0＋27/0＋typecheck 零错。
- acp-client 对接收尾（本轮）：SDK 侧 `env` 透传＋图片 prompt 块已提交待发版（`cb14b00`，0.1.1，未 push）；网关侧 custom 探针改走 codex-acp＋自定义 env（与会话同链路，未配置不 spawn）＋旧 SDK（0.1.0）fail-fast（`E_ACP_CLIENT_OUTDATED` 可读错，不静默鉴权失败）；16/0＋typecheck 零错。
- codex-acp 已翻转（spike 带 luna＋medium 建会话＋两轮工具＋resume 全绿）：已知残留差异——中断/steer 明确拒绝、collaborationMode 暂忽略、旧 codex thread 续接首轮失忆（均有声失败或注释）。
- 固定工具任务运行时门禁已合入（用户故障破案：词语“生成讲解”在 agy/gemini-3.8-flash-high 上报 `ACP_PROTOCOL_ERROR: 请求超时: session/prompt`）。实机复现：agy 挂载会话 MCP 后无视网关工具、空转内置 run/view 命令至 prompt 超时（free-chat 同症状，100s 零输出）；同 prompt 切 codex-acp 40s 流式完成（工具实调＋落库）。修法：`supportsSessionTools` 进 capabilities（codex-acp true，其余 false，custom 同默认），`vocabulary.explain` 在探针/建会话前 fail-fast（实测 583ms 回指引，不烧模型轮次）；未动 free-chat（另案）。41/0＋typecheck 零错。
- 运行时自由配置解绑（用户要求）：教材目录识别 `resolveBatchAdapter` 的 `LINGUA_ACP_BATCH=1` 总门已拆（唯一调用方即 toc lane）——指名 ACP 运行时即走池，`runtimeId` 不再被丢弃；opencode 经单工具＋先读后写两轮 MCP 调用实测通过，进入 `SESSION_TOOLS_VERIFIED`（codex-acp＋opencode），词汇讲解门禁同步放行；agy（无视 MCP 空转超时）与未验证运行时仍 fail-fast 明示。开关函数保留备查，注释标退役。
- 扫描版回归修复（解绑引入：之前默认走 Codex 原生读文件，扫描版可用；切 ACP 后无字可嵌直接 E_TOC_SCANNED_ACP）：页面图经会话契约既有 `attachments` 字段随 prompt 直传模型（acp-client 0.1.2 图片块已支持，之前没接）。opencode 实测读图通过（准确读出扫描页第1課/会話/对话/練習A）；路由预算 12 张/12MB，超限指引收窄页码。`isAcpBatchEnabled` 零调用，一并删除。
- 死代码清理（用户批准全删）：realtime 全链（网关路由＋方法＋CodexAdapter/传输/queries/协议类型＋协议事件）、旧面板路由（skills/usage/mcp-servers/collab-modes）及网关方法、前端 4 个旧 hooks＋顶栏 Skills/MCP/额度 UI＋作曲区 Mode/旧模型分支；facade 测试 9→11 系历史遗留（ACP 导出时未同步），按测试规约补齐。`/api/agent/models` 保留作生成器逃生（跑者仍绑定 Codex，目录与 ACP 探针非同一套，删了会重演 400 事故；跑者迁 ACP 时再删）。
- 全量迁 acp-client（用户批准由易到难）：待办——小路由（词条例句/学习分析/批改/enrich，`agentAdapter` 直连改按 runtimeId 选池）→出题 runner（`new CodexAdapter` 写死＋systemPrompt/sandbox 重映射）→正文 agentpool（Codex 二进制硬依赖，最难）。本轮未动，下轮起按此顺序逐批实测＋回归。
- 小路由迁移第一批落地（词条例句/学习分析/单课与整本 enrich）：`resolveAgentAdapter` 网关唯一选型＋`resolveAgentFirstMessage` 首消息前置（ACP 无 systemPrompt 通道），四路由收 `runtimeId`，前端统一带全局所选运行时；附带修好 `/examples` 被 `/:language` 遮蔽的旧 bug。opencode 实测连破两关：先是模型回异形 JSON（已见 3 种形状，解析器别名宽容＋接地不变），再是适配器层真 bug——prompt 结果无文本字段时用信封 JSON 当 finalOutput 并覆盖增量（codex 结果带文本故从未暴露），已改为累积回吐＋排空退出，单测锁定；端到端 200 两条例句入库。批改（SubmitExerciseGradeTool 绑定式有状态工具）与出题 runner、正文 agentpool 顺延下批。
- 正文提炼 agentpool 迁 ACP（agentpools 原生支持多运行时，apiVersion 2）：新增 `resolveAcpPoolAgent`（模板＋adapter 三件套决议 program/args/env，只读 acp-client，业务零厂商分支；codex-acp 沿用本地 pin，custom 走隔离 CODEX_HOME），驱动增 `acp` 配置（ACP 条目带 autoApprove，无 effort/sandbox 对应物），管线 `runtimeId` 从 Schema→路由→boot 全链透传（前端本就发送）。真池验证通过（opencode 起池→ask→42→关闭全流程走自家 driver）。
- 出题 runner 全迁 ACP：请求增 `acp`（池适配器＋克隆注册表，与 createAdapter 二选一）；按次克隆 6 工具唯一名并注册（MCP 桥按名执行），门面委托 scope 闭包（合成引擎会话上下文，额度/allowlist 同一闭包），提示词内工具名重写＋映射声明，用完注销；身份前置；approvalPolicy 用 never（自有预授权工具直行，引擎原生动作无 ACP 沙箱对应、残余风险已注释）；sandboxMode 仅 Codex 通路。冻结配置加 `runtimeId`，创建时模型证伪（400 E_GENERATION_MODEL_MISMATCH），调度器按冻结 runtimeId 选池（池适配器不关闭）；出题面板加运行时下拉＋探针模型（AgentRuntimeSelect 以后端目录为主源，静态表仅离线回退）。opencode 真机最小任务（2 道语法、无音频）一次通过：建任务 200→运行 202→COMPLETED，真卷 2 题入库（探针数据已从开发库清除）。Codex 原通路零改动（集成测试全过）。
- 出题 runner 全迁 ACP：请求增 `acp`（池适配器＋克隆注册表，与 createAdapter 二选一）；按次克隆 6 工具唯一名并注册（桥按名执行），门面委托 scope 闭包（合成引擎会话上下文，额度/allowlist 同一闭包），提示词内工具名重写＋映射声明，用完注销；身份前置；approvalPolicy 用 never（自有预授权工具直行，引擎原生动作无 ACP 沙箱对应、残余风险已注释）；sandboxMode 仅 Codex 通路。冻结配置加 `runtimeId`，创建时模型证伪（400 E_GENERATION_MODEL_MISMATCH），调度器按冻结 runtimeId 选池（池适配器不关闭）；出题面板加运行时下拉＋探针模型（-AgentRuntimeSelect 以后端目录为主源，静态表仅离线回退）。
- dom 脚手架跟进：探针/runtimes mock、创建证伪桩。
- 能力开关已合入：模型/思考深度控件由后端 capabilities 驱动禁用（codex 全开保 luna，其余用 Agent 默认；零按 id 特例），`useSelectedRuntimeCaps` fail-open。
- 桥记录铁证：首轮 `dictionary.lookup` 调用＋resume（`session restore ok`）后 `flashcards.due` 再调——resume 带工具成立，Codex 旧链路的死结解开。
- 附带修通：更新包实形状映射、HTTP 必填 `headers`、Bun 长连接超时、SDK prompt 120s、本地 pin（`@agentclientprotocol/codex-acp ^2.1.1`，不再赌 bunx）、建连抖动重试、单 adapter 只连一次。
- 遗留要求（Phase 1 立项条件）：`pickAllowOptionId` 审批映射、事件全量映射、中断/steer、温进程池、turn 预算收敛。
- Codex 通路全量退役（用户批准全收）：`adapters/codex` 整目录删除（含 App Server client/queries/event-mapper/tools-bridge/image-attachments/jsonrpc-stdio/mapper/singleflight 测试）；`composition/agent-deps.ts` 工厂删除，`GatewayServer` 默认适配器即 codex-acp 池实例（`resolveAgentAdapter`/`resolveBatchAdapter` 按 id 归一取池，无旧分支）；`resolveSessionAdapterId` 改为 `resolveAgentRuntimeId`（未知回落 codex-acp）；出题 runner `createAdapter` 删除、`acp` 必填，调度器只走池；agentpool 驱动 Codex 分支删除（缺席即 codex-acp）；`/api/agent/models`＋`listModels`＋`useAgentModelsQuery`＋`model/list` 全链删除，四处选择器改探针唯一源；`preferCodex` 字段删除；`source: 'codex'`→`'agent'`（协议保留旧值兼容），`codexOutcome`/`codexFailureMessage`/`recordCodexTurnCompletion`/`formatCodexLocalFallbackNote` 改中性名并双发/别名兼容旧前端；E_CODEX_* 改 E_AGENT_*。网关 191/0＋agent-runtime 75/0＋runtime-select 6/0＋tsc 零错。
- 批改去双分支：`TextbookGrading` 删除 `instanceof AcpAdapter` 兼容分支，一律按次克隆唯一名工具＋注册表执行＋用完注销；`SubmitExerciseGradeTool.bindings` 删除，共享实例 `execute` 大声拒绝（误调不落库）；`submitGradeAttempt` 加 `binding.active` 守卫挡迟到调用；`GradeBinding.turnId` 死字段删除；三处测试（textbook-grading 集成/p2-fixes/grading dom）同步改克隆断言。网关 191/0＋tsc 零错；grading dom 预存在失败经 stash 对照确认（pristine 树同样失败），非本次引入。
- 迁移收尾（死通道清除＋语义做实）：enrich model/effort 从死 `turnOptions` 改走建会话（单课＋整本同 funnel，一并生效）；TOC effort 同理进建会话，`sandboxMode`/`workingDirectory` 传参删除（无 ACP 对应物）；契约删除 `AgentInput.turnOptions`/`onTurnStarted`（无适配器读写）与 `CreateSessionOptions.sandboxMode`/`workingDirectory`；主回合删 per-turn `turnOptions`＋`collaborationMode` 解析（前端照发，网关忽略，UI 统一处理时再清发送端）；队列删 `sendQueued` 死分支，一律台账消费，单测改台账播种/空队列两条；池 effort 双保险——管线有档位即 `E_TEXTBOOK_EFFORT_UNSUPPORTED` 大声拒绝＋驱动入口拒收 effort/sandbox/approvalPolicy（`E_AGENTPOOL_OPTION_UNSUPPORTED`），`AgentpoolRunInput` 的 effort 字段删除。网关 221/0（31 文件）＋tsc 零错。残留：前端 `collaborationMode`/队列 `approvalPolicy` 发送端（UI 统一处理）、agy free-chat、两处 dom 既有失败。

## P3 Hub 锁态 409 对齐（对方地盘，只 review 不动手）
- `DailyWordStudyHub` 课程单元扩展返回 400 而非 409，锁 banner 失效；文件在对方手里，等它改。

## P4 E2E 真机验证（等用户）
- 用户重启网关（新代码）＋确认 luna；一次生成 run，验保存→渲染。

## P5 MCP 外部真通道（已关闭：无需求，不做）
- 立项分析结论：全仓零 `EXTERNAL` 注册工具（仅 `permissions` 定义＋`ToolRouter` stub 分支）；Anki 经 SERVER 工具 `flashcards.anki_push` 直连本机 AnkiConnect，已覆盖；Notion 等无需求方。
- 按简单优先＋`agent-runtime.md`（禁 Server Tools 无故改道 MCP），stub 保留，待真实外部系统出现再立项。
