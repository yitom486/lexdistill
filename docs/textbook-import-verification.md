# 教材目录与运行监视：集成验收记录

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

