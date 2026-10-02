# 教材目录与运行监视：集成验收记录

## 课程 CRUD 暂存与原子保存（2026-10-02）

当前六工具为 knowledge、vocabulary、exercises、articles、sentences、material，均支持增查改删。模型调用先校验并暂存，正常结束后以课程为单位一次事务提交；知识点、词汇、练习为必需内容。当前契约见[教材学习内容表](textbook-learning-tables.md)；下文其余阶段记录为历史取证，不代表现行旧工具或来源引用规则。

- [课程事务集成](../apps/gateway/src/modules/library/__tests__/lesson-content-transaction.integration.test.ts)：实际 HTTP 默认入口、ToolRegistry、Codex 原生 schema 转换、内容工具与 SQLite；核对六工具 action/ref 和嵌套字段完整注入，无数据库身份参数。
- 多次新增、查询、修改、删除仅改变当前尝试视图，模型运行期间学习表与全局词汇未变化；新增后又删除的词不进入全局表。已有条目修改保留内容身份，删除章节词汇不删除全局词或其他章节关联。
- 在最终 ready 更新处注入真实 SQLite 故障，此前内容、全局词和 FTS 写入全部回滚；同候选重试成功，模型只调用一次。
- 缺必需内容、关闭新增 AI 练习、跨课程/重试引用、非法批次或缺少正常 COMPLETED 均不能完成。下一轮收到真实缺项反馈，不继承失败缓存；正常字段修正复用会话。
- 重新提取失败保留旧版本，成功后整课替换。原生 callId 幂等，冲突内容拒绝；仅查询不算本轮提交。
- [监视 DOM](../apps/web/src/components/importer/monitor/__tests__/import-monitor.dom.test.tsx)：实际 Query→Gateway→SQLite，模型未结束时显示暂存且当前课数据库零写入，完成后改为整课保存；历史折叠、按需读取及关闭重开继续验证。

测试使用受控模型输出，没有调用付费模型，不证明语义整理质量；实际 Tauri 视觉验收由用户执行。最终门禁：`bun run typecheck` 通过；`bun run test:all` 1634 通过、3 项既有 RSS 跳过、0 失败，原生 PDF/OCR 不跳过。日志为 `.studio-internal/lesson-atomic-typecheck.log`、`.studio-internal/lesson-atomic-test-all.log`。本轮测试进程已退出。

## 失败记录修正：字段与来源（2026-10-01）

`submission-correction.integration.test.ts` 通过实际流水线、原生提交工具与 SQLite，验证同次回执同时包含目录越界、未知来源块、缺少对话角色及注音/释义来源，反馈定位原始数组路径且没有生成的内容 ID；拒绝时零写入，修正后内容与真实物理页保存。模型输入明确包含当前目录与解析材料。

`mineru-source.integration.test.ts` 保持真实页边界与表格行核对；模型仅引用块/行，系统映射页。越界行拒绝，修正后规范 AST 保存对应 page/row。所有外部模型输出受控，不代表真实模型语义质量，未重跑现有全书任务。

阶段门禁：`bun run test:all` 1685 通过、3 项既有 RSS 跳过、0 失败；原生测试未跳过。`bun run typecheck` 通过。日志为 `.studio-internal/failure-s1-test-all.log`、`failure-s1-typecheck.log`。

## 失败记录修正：重试、期限与进度（2026-10-01）

- 真实共享 Codex Adapter/Connection 的受控 RPC 测试：内部重试只进入对应线程，旧轮消息不进入新轮，不终止当前流；原始私密错误文本不进入诊断。初始化沿用已核实的 CODEX_BIN，未放宽测试超时。
- Gateway/工具/SQLite：持续引擎重试不刷新首响应/无活动期限；超时诊断包含实际原生启动身份、输入规模和最后原因。同轮修正预算耗尽即中断，迟到提交零写；有新轮预算时纠正后保存，无预算时明确失败。
- 实际后台注册表快照记录轮次和拒绝数，成功计数对应真实事务。桌面设置 → Gateway → MinerU V1 HTTP → 工具 → SQLite → 真实 HTTP 快照 → 进度组件，核对预算偏好、运行中 0/1 与保存后 1/1，不伪造进度。
- 桌面监视：非终止内部重试原因可见；后续保存后的失败调用默认折叠，手动展开仍能读取实际字段和合法枚举；解析事件仍不展示。

这些测试的外部模型/解析服务输出受控，实际窗口人工操作与云端失败章节未重新执行。MinerU 远端仅提供 parsing failed 的情况继续如实显示，不能假称已修复远端服务。没有调大用户的超时、更换模型或清理教材数据。

最终门禁：`bun run test:all` 1689 通过、3 项既有 RSS 跳过、0 失败，1692 项 / 257 文件；`bun run typecheck` 通过。日志为 `.studio-internal/failure-s2-test-all.log`、`failure-s2-typecheck.log`。首轮门禁发现保存后重复广播 saved，已修复并重新通过原断言；迟到启动也不得更新后续尝试进度。

日期：2026-10-01。按用户批准的 Plan 33，以 P1 → P5 顺序实施、验证并分别提交。产品为 Tauri 桌面，`apps/web` 是其 WebView 源码目录。

## 交付与核对

| 阶段 | 实际交付 | 阶段门禁 | 提交 |
| --- | --- | --- | --- |
| P1 | 独立部分纳入任务；模型收到真实目录路径、完整子树、顺序及物理页码；完成判断覆盖全部任务 | 1660 通过、0 失败；类型检查通过 | `6ebad7af` |
| P2 | 持久化实际输入、会话、原生工具、校验、重试与事务事件；查询/SSE 与桌面折叠弹窗 | 1665 通过、0 失败；类型检查通过 | `f3b7a34c` |
| P3 | 生词独立 AI 讲解；准确身份反馈；修正/生成重试/保存重试分开；首响应与停滞期限 | 1670 通过、0 失败；类型检查通过 | `a369aca1` |
| P4 | 正文、生词、知识点及习题按保存目录分组；两类讲解分开；候选与当前数据库版本分别展示 | 1670 通过、0 失败；类型检查通过 | `9b334ab2` |
| P5 | 目录模型到正文保存的贯通验收；严格父关系校验；超时故障会话先关闭再重试；本记录及实现文档 | 1674 通过、0 失败；类型检查通过 | 本记录随 P5 提交 |

每次全量门禁均有 3 个既有实时新闻 RSS 网络测试跳过；教材原生 PDF/OCR 测试没有跳过。上述数量是全仓库结果，业务证据如下。

## 需求对应的集成证据

模型输出在 `AgentAdapter` / 原生工具参数边界受控替代；业务工具、任务绑定、Repository、SQLite 和 Gateway 路由使用真实实现。原生 OCR 使用实际扫描夹具及 ONNX 引擎。桌面交互在 DOM 中运行真实 Query、Hook 和 Base UI 组件，不等同于人工操作 Tauri 窗口。

| 核对项 | 观察与断言 | 测试入口 |
| --- | --- | --- |
| **提示词确实带目录** | 从实际 `session.send` 输入解析目录，与规范目录逐项比较 ID、父节点、层级、标题、顺序、物理页；祖先路径单独比较；包含当前文字和工具名，不复制参数 Schema | [directory-task-pipeline.integration.test.ts](../apps/gateway/src/modules/library/__tests__/directory-task-pipeline.integration.test.ts) |
| 目录模型结果贯通后续输入 | 受控目录模型通过实际草稿工具提交单元、独立部分、课次及小节；HTTP 父关系保留；独立保存时正文数量为零；正文输入与保存子树完全相等；trace 保留目录结果、保存、候选及事务回执 | [toc-vision-route.test.ts](../apps/gateway/src/modules/library/__tests__/toc-vision-route.test.ts) |
| 默认物理页换算与再次导入 | 使用不同目录结束页验证动态换算与手工修改；保存失败可重试；重进读取已有目录，不再次探测或调用模型；保持原目录身份 | [textbook-import-flow.dom.test.tsx](../apps/web/src/components/importer/__tests__/textbook-import-flow.dom.test.tsx)、[textbook-outline.integration.test.ts](../apps/gateway/src/modules/library/__tests__/textbook-outline.integration.test.ts) |
| OCR、会话池与逐章保存 | 首章提交时后章仍在 OCR；队列背压与配置并发上限有效；两条固定会话处理多章；乱序完成仍按目录读取；长章成功批次不重复 OCR | [textbook-import-pipeline.e2e.test.ts](../apps/gateway/src/modules/library/__tests__/textbook-import-pipeline.e2e.test.ts) |
| 真实扫描文字进入保存链路 | 本地路径 → 后台任务 → 原生 OCR → 工具 → SQLite；透传模型与思考等级；实际扫描返回日语、坐标和置信度；正式正文使用结构化内容 | [pdf-ocr-native-integration.test.ts](../apps/gateway/src/modules/library/__tests__/pdf-ocr-native-integration.test.ts) |
| 独立部分不能遗漏 | 课次全部成功但独立部分失败时，不能标记全书完成；恢复只处理未完成部分；父项缺失或循环在模型和内容写入之前拒绝 | [directory-task-pipeline.integration.test.ts](../apps/gateway/src/modules/library/__tests__/directory-task-pipeline.integration.test.ts) |
| 校验与模型修正 | 旧尝试身份、未知字段、缺少 AI 例句关联、目录越界及非法答案拒绝写入；准确错误回填；合法修正成功；普通格式重试复用线程；新增七种 AI 题型不要求原书另有习题目录 | [submission-correction.integration.test.ts](../apps/gateway/src/modules/library/__tests__/submission-correction.integration.test.ts)、[textbook-import-pipeline.e2e.test.ts](../apps/gateway/src/modules/library/__tests__/textbook-import-pipeline.e2e.test.ts) |
| 停滞与迟到提交 | 首响应及无活动超时能结算；旧工具不能写入；发生运行时故障的会话先关闭，再创建替代会话完成本章并复用到下一部分 | [submission-correction.integration.test.ts](../apps/gateway/src/modules/library/__tests__/submission-correction.integration.test.ts) |
| 文本不能冒充工具回执 | 模型只返回合法 JSON 文本或代码围栏仍失败且零写入；监视保存实际文本及无工具提交的原因 | [submission-correction.integration.test.ts](../apps/gateway/src/modules/library/__tests__/submission-correction.integration.test.ts) |
| 保存、幂等与事务回滚 | 数据库暂忙仅重试有效候选保存，不重新生成；重复提交不覆盖首次内容；派生写入故障时 AST、正文和 ready 状态整体回滚；监视只有回滚事件，没有成功提交事件 | [textbook-import-pipeline.e2e.test.ts](../apps/gateway/src/modules/library/__tests__/textbook-import-pipeline.e2e.test.ts) |
| 全程监视与隔离 | 两 Worker 的提示词、工具与事务关联到实际会话；列表不携带大参数；SSE 游标补取；文件库重开保存提示词；用户与 trace 隔离；记录失败不改变教材保存结果 | [import-monitor.integration.test.ts](../apps/gateway/src/modules/library/__tests__/import-monitor.integration.test.ts) |
| 桌面可核对的结果 | 当前交互展开、结束轮次折叠；详情按需读取；关闭重开历史仍在；真实目录分组；原书/AI 讲解独立；候选与 Gateway 当前 AST 及派生计数分别呈现 | [import-monitor.dom.test.tsx](../apps/web/src/components/importer/monitor/__tests__/import-monitor.dom.test.tsx)、[structured-textbook.dom.test.tsx](../apps/web/src/components/textbook/structured-textbook.dom.test.tsx) |

## P5 验收中修正的两个问题

1. 目录草稿转换用于校验时没有传入父关系，会把有效容器误判为空。现在沿用工具真实 `parentIndex` 转成 `parentId`；父循环和不存在的父项记录具体失败，未知字段严格拒绝，不静默丢弃。
2. 停滞超时后立即在旧会话重试，旧响应流可能还未收尾。现在在下一次生成之前关闭已记录运行时故障的会话，再创建替代会话；旧尝试资格已撤销。正常章节和字段修正保留原会话。

这两项由对应集成测试覆盖，没有添加教材内容兜底、固定页码或旧数据兼容。

## 最终门禁与运行环境

- `bun run test:all`：**1674 通过、3 跳过、0 失败**，252 个测试文件，62.22 秒。
- `bun run typecheck`：通过，`tsc -b --force` 退出码 0。
- Windows 桌面账户，Bun 1.3.14，本机 Codex CLI 0.159.2。
- 最终全量测试进程已退出；收尾清理了启动时间、完整命令和日志均已核对的本轮 P3 遗留测试进程，不触碰应用服务。

第一次 P5 全量执行有一个既有连接生命周期测试超过 5 秒。独立复核同样失败，定位到连接构造时自动探测多个 Codex 安装版本，尚未进入连接并发断言。使用项目已有的 `CODEX_BIN` 配置指定系统解析且已核实版本的可执行文件后，独立测试 4 项通过，最终全量门禁通过；超时、断言、测试清单均未放宽。未在本计划内修改 Codex 安装探测代码。

复核命令（PowerShell，仅影响该 shell 子进程环境）：

```powershell
$env:CODEX_BIN = (Get-Command codex -ErrorAction Stop).Source
bun run test:all
bun run typecheck
```

完整输出保存在忽略目录 `.studio-internal/plan33-p5-tests-configured.log`、`plan33-p5-connection-configured.log` 和 `plan33-p5-typecheck.log`；失败的初次记录也保留，不将其计为通过。

## 实际限制

- 没有调用付费真实模型，也没有重新提取、清空或修复用户现有教材。既有错误段落不会因更新界面自动变成正确结构。
- 测试证明目录传递、结构校验、归属保护和事务一致性；不能证明模型对原书内容的语义还原完全正确。真实模型与实际 Tauri 操作需要单独验收。
- 监视只能展示实际捕获的公开事件；此前未记录的提示词不能回溯。查询“数据库当前保存版本”不代表历史时刻的内容。
- 会话复用仍保留模型历史及其 token 成本。原生 OCR 正在执行的批次不能立即中断；在途文字和队列没有跨进程持久化。

实现链路见[教材导入架构](textbook-import-architecture.md)、[原生工具提交说明](ai-pipelines/tool-calling-vs-json-prompting.md)及[Gateway 协议](protocol.md)。

## MinerU 升级：M1 → M4（2026-10-01）

系统 ID 阶段沿用真实工具→校验→SQLite 测试：模型提交无 ID 内容，原生旧轮次零写入；未知身份字段被拒绝；系统生成 ID 并正确关联知识点、七题型选项及匹配答案；越界下标拒绝；同线程重试、取消、数据库回滚仍验证。模型/外部服务输出受控，不把模拟输出当作真实模型正确率。

后续 S0 修复集成：真实共享 Codex Adapter/Connection + 受控 JSON-RPC 交错通知，验证 B 完成不结束 A、旧轮通知拒收、原生 callId 和合法枚举到达执行与模型回执。11 个真实 PDF 页通过生产流水线分为 8+3 页渲染，完整 PNG 和目录随模型输入发送，实际 SQLite 事务后教材就绪。附件物化验证 11 张完整传递与总字节超限拒绝；不调用付费模型。

原 Plan 33 验收记录是当时实现的历史证据；其正文 OCR 生产者在本轮被替换，当前正文路径见[架构说明](textbook-import-architecture.md)。目录原生识别能力保留。

| 阶段 | 交付与关键核对 | 正式门禁 | 提交 |
| --- | --- | --- | --- |
| M1 | 真实云端完整 12 页章节解析；逐页输入契约；两页表格保持边界并进入实际工具/SQLite 链路 | 1675 通过、0 失败；类型检查通过 | `ac1b519` |
| M2 | 精准云端/显式本地 V1；物理页裁切、并发与背压；下载失败继续同一任务，超时/取消/异常回执处理 | 1678 通过、0 失败；类型检查通过 | `35b4410` |
| M3 | 实际目录子树、表格与原页 PNG 进入 Turn；错误来源行拒绝零写入；修正引用随规范 AST 保存 | 1679 通过、0 失败；类型检查通过 | `4c26db5` |
| M4 | 桌面配置/偏好持久化；解析时间线与来源可视化；UI → Gateway → V1 HTTP → 原生工具 → SQLite → 监视读回；已保存章不再次解析 | 1681 通过、0 失败；类型检查通过 | 本记录随 M4 提交 |

各阶段均有 3 项既有 RSS 网络测试跳过，原生 PDF 测试没有跳过。最终 255 文件、1684 项，61.15 秒。分阶段日志为忽略目录中的 `.studio-internal/mineru-m1-test-all.log` 至 `mineru-m4-test-all.log`，类型检查日志同理。

### 可检查的集成证据

本轮分步门禁：故障修复 `b311ec4` 与系统 ID/原生轮次绑定 `7dad1e6` 各为 1683 通过、0 失败；监视精简最终为 1684 通过、0 失败（1687 项、257 文件，62.72 秒），`bun run typecheck` 零报错。三个阶段均有 3 项既有 RSS 联网测试跳过，原生 PDF/OCR 集成没有跳过。最终日志：`.studio-internal/monitor-test-all.log`、`monitor-typecheck.log`。

监视精简阶段：`import-monitor.dom.test.tsx` 验证默认展示当前章节提示词与已发送目录、历史未展开不请求详情、实际 callId 的校验拒绝/合法枚举和成功事务分组、系统生成内容可展开核对、刷新保留章节/折叠状态、关闭重开及数据库正文/生词/原书与 AI 讲解。`mineru-desktop.dom.test.tsx` 验证解析结果页可查看实际表格，三个页签均不列解析事件，已保存章节不重解析。额外流水线场景验证服务失败原因保存为最终结果，另一章正常入库。以上为真实组件/Query/Gateway/SQLite 与受控外部输出；尚未替代 Tauri 窗口人工验收或真实全书模型质量评估。

- [MinerU HTTP 集成](../apps/gateway/src/modules/library/__tests__/mineru-http.integration.test.ts)：真实 HTTP 上传收到可读取的两页裁切 PDF；云端认证头只出现在服务请求，签名上传不携带 Token；上传/轮询/下载计数证明下载失败不重建任务；本地 V1 上传确认、Standard 任务和 302 文件下载贯通。限流、无效 Token、损坏 ZIP、结果页数不符均不进入模型、不写入章节内容；轮询有明确期限，取消停止等待。
- [来源集成](../apps/gateway/src/modules/library/__tests__/mineru-source.integration.test.ts)：实际 `session.send` 同时带目录子树、表格行、原页 PNG；提示词没有 Schema 文本；无效行引用被真实工具拒绝，SQLite 内容行仍为零，合法修正后引用保存在规范 AST。
- [桌面贯通](../apps/web/src/components/importer/__tests__/mineru-desktop.dom.test.tsx)：使用实际 Base UI 选择本地模式、填写地址并记住配置；真实 Query/HTTP 路由启动受控 V1 服务，真实生产解析器/裁切/工具/SQLite 保存；弹窗读回解析表格及来源定位。重复启动没有新增解析调用或模型 Turn。
- [并发流水线](../apps/gateway/src/modules/library/__tests__/textbook-import-pipeline.e2e.test.ts)：解析与池初始化并行，首章保存时后章未完成，有界队列背压、会话复用、乱序保存、成功页段缓存、取消和事务回滚持续验证。

外部 MinerU 及 LLM 输出受控替代的 HTTP/DOM 集成，不能等同真实解析或模型语义质量验收。原生测试中正文边界注入受控解析器，仍运行真实原生 OCR 验证目录探测能力。

### 真实云端质量与限制

另外完成同一本书 6 页与完整第 1 课 12 页的独立精准云端实测，上传、查询、下载和实际逐页结果转换均成功。完整章节的原始表格保留 28 + 25 行，采用逐页模型输出可避免观察到的后处理错合并。实测仍发现音调编号错误；目录页码/标题不能仅依靠解析后的文字恢复。因此目录继续发送原页，正文工具要求核对必要原页，无法确认的音调省略。

实测材料保存在忽略目录 `.studio-internal/mineru-cloud-probe/` 与 `.studio-internal/mineru-chapter-probe/`，Token 不进入 Git 或客户端。没有调用真实正文 LLM，也没有安装本地 MinerU 模型；本地接口测试不能代表本机性能。没有重新导入、清空或修复用户已有教材。已接受的远端任务在用户取消后可能继续，远端检查点只在本次进程执行内有效。保存源文件已提前声明，正式测试进程均已退出。

收尾实机只读检查发现，原配置接口路径会被先注册的文档 ID 通配路由截获。已替换为 `/api/documents/:userId/textbook-parsers/config`，桌面贯通测试同步按生产顺序组合真实文库/导入路由并断言配置响应。现有桌面 Gateway 新接口实际返回配置布尔值，未暴露凭据。此修正单独提交，不保留旧路径兼容。

## 桌面跨端口教材请求（2026-10-02）

Tauri WebView 与本机 Gateway 端口不同，教材监视头 `X-Textbook-Trace` 必须通过 CORS 预检许可。此次故障为该请求头未列入允许列表；“大 PDF 导致进程中断”不能由 `Failed to fetch` 推断。

新增 [教材网关集成测试](../apps/web/src/lib/__tests__/textbook-gateway.integration.test.ts) 使用完整 `createApp` 及真实临时 HTTP 服务：

- 先核对目录探测、目录提炼、目录保存的 OPTIONS 许可，再发送 POST；无效输入能读取安全的 HTTP 400 回执。
- 合法目录实际保存到隔离的 SQLite，并核对对应 trace 的开始/结果记录。
- TTS 专属凭证头预检保留，普通目录 API 不放开任意请求头。
- 客户端失败诊断读取真实网关健康结果；服务关闭后健康检查失败，分别生成教材请求失败和连接失败文案，details 保留实际检查结果。

修复前测试确实因缺少 `x-textbook-trace` 失败；修复后通过。Bun fetch 不执行 WebView 的 CORS 限制，所以测试显式检查许可；WebView 无响应错误形状受控替代。没有调用真实目录模型，不能替代桌面人工操作及模型质量验收。

本次生产源码集中保存于北京时间 20:26:46–20:26:52，watch 自动重载；20:30 左右删除首次类型检查意外生成的未跟踪 JS/声明文件。未手动停止或重启用户服务。桌面动态端口上的只读复核返回 HTTP 204，允许头实际包含 `Content-Type,Authorization,X-Textbook-Trace`，健康检查正常。

正式门禁：`bun run typecheck` 通过；`bun run test:all` 为 1637 通过、3 项既有 RSS 联网跳过、0 失败，共 263 文件，69.63 秒。首次沙箱内执行遇到原生依赖及文件权限限制，不计为验收通过；获准在沙箱外重跑后通过。最终日志位于忽略目录 `.studio-internal/textbook-cors-typecheck.log`、`textbook-cors-test-all.log`。

## 2026-10-02 一级标题分组提取（用户批准）

原任务规划按 `lesson/section` 类型挑根节点，跳过一级 `unit/chapter` 并将其子标题拆成独立任务。本轮删除该规则：每个无父节点的一级标题生成一个任务，所有后代随该任务处理；语义类型只作内容分类，不决定切分。非末章的物理结束页取下一一级标题起始页减一，末章使用用户结束页或 PDF 实际末页。

目录保存、流水线和进度共用 `planTextbookTasks`。现有 `documents.chapters_json` 的每个一级章节增加本章 `tocEntries` 参考树，保留父子关系及目录身份；没有新增表，也没有将学习内容存回目录。重新读取目录时恢复真实父子关系，模型提示词只发送本章标题树与材料，不发送目录 ID、页码或覆盖清单。界面编辑一级/子标题时同步修改 `parentId`，保存提示与进度显示一级任务数。

验证证据：

- `heading-group-pipeline.integration.test.ts`：通过真实 HTTP 保存四种类型的混合目录，关闭并重开临时 SQLite；再次确认保留子标题身份；实际八页 PDF 切为四个两页文件。两个受控 Agent 会话收到四组独立本章材料，三级标题保留缩进，六类内容工具按章完成事务；统计和进度均为四个任务。
- `toc-vision-route.test.ts`：受控原生目录工具的父关系贯通 HTTP、保存及正文输入；单个一级单元只生成一个任务，其嵌套课次和小节全部进入同一提示词。
- `textbook-import-flow.dom.test.tsx`：真实 Hook、Query、Base UI 键盘选择；改变缩进后保存的父节点同步变化，回读仍保留子标题，重新启动无需重复识别目录。新交互测试采用已有 DOM 测试的独立子进程模式，防止全量测试先在无 DOM 时缓存组件能力检测。
- 缺失父节点、循环关系或一级页码倒退被拒绝，隔离数据库没有伪造教材；既有会话历史和保存结果监视测试保持通过。

正式门禁：`bun run typecheck` 通过；`bun run test:all` 为 **1640 通过、3 项既有 RSS 联网跳过、0 失败**，共 264 文件、1643 项，72.81 秒；原生 PDF 测试未跳过。首次全量检查暴露的两个旧测试依赖被废弃的分组规则，已按批准的一级标题规则更新输入和断言。日志为 `.studio-internal/heading-group-typecheck.log`、`heading-group-test-all.log`。

生产源码保存约为北京时间 20:59–21:53，触发 live watch/HMR；未手动启停用户服务或清理用户教材数据。本次验证使用临时 PDF、数据库及受控模型，没有新增 MinerU 云端解析任务。已有运行任务不会自动换成新分组；此前只存了扁平任务的教材需重新确认完整目录，不能凭丢失的父子关系猜测恢复。真实桌面视觉效果及真实模型内容质量仍由用户检查。

