# LexDistill - 渐进式里程碑路线图 (MVP Roadmap)

> **文档版本**：v1.2（2026-09-23：M0–M5 + P6-1/2/3 已交付；明确桌面优先与 Android 轻量伴随端策略）
> **维护责任人**：首席架构师 / 技术负责人
> **迭代策略**：优先打磨桌面端完整学习闭环与 Agent 体验；Android 作为后续轻量伴随端，按用户需求分阶段推进。
> **当前状态**：M0–M5 已交付；P6 周期排程 / 听写池化 / AI 真实批改已交付；后续只做小收口，不再开大里程碑。

---

## 产品平台策略（2026-09-23）

- **桌面端：主产品**。本机 Gateway Sidecar + SQLite，提供完整学习能力与 Agent 辅导。
- **浏览器：共享界面的开发、预览和调试运行态**。保留 React 客户端，但不承诺独立浏览器产品发行。
- **Android：后续轻量伴随端**。优先支持卡片复习、练习与学习记录；首期不在手机本地运行 Agent / ACP。
- **Agent 执行位置**：桌面端继续使用本机 Gateway；如未来确认 Android 需要 AI，优先评估远程 Gateway，不要求把 Agent Runtime 搬进 APK。
- **Android 数据策略为启动条件**：排期前明确是否要求离线使用及跨设备同步，再选择远程 Gateway 或移动端本地实现。当前桌面 Sidecar 不能视为 Android 可直接复用的运行时。

---

## 里程碑全景一览

```
[ M0: 架构骨架与基座 ] ──► [ M1: Agent 通信闭环 ] ──► [ M2: 学习者模型与错题本 ]
                                                              │
┌─────────────────────────────────────────────────────────────┘
▼
[ M3: 卡片与做题界面 ] ──► [ M4: AI 靶向出题与深度批改 ] ──► [ M5: 教材导入/多媒体/多端 ]
```

---

## M0: Bun Monorepo 架构骨架与类型基座 (当前阶段)

- **核心目标**：建立严格类型安全、单向依赖分明、开发运行极速的工程底座。
- **交付物 (Deliverables)**：
  - `package.json`（配置 `bun workspaces`）与严格模式 `tsconfig.base.json`。
  - 核心 Packages：`packages/protocol`, `packages/shared`, `packages/learner-core`, `packages/agent-runtime`, `packages/tool-core`, `packages/speech`。
  - 核心 Apps 骨架：`apps/gateway`, `apps/web`。
  - 单元测试与类型检查命令链。
- **验收标准 (Acceptance Criteria)**：
  - `bun install` 秒级链接无任何报错。
  - `bun run typecheck`（`tsc -b`）跨包类型推断 100% 通过，无 `any` 警告。
  - `bun test` 基础单测全部绿灯。

---

## M1: Gateway 双向通信与 Codex 原生 Agent 运行时

- **核心目标**：打通客户端与 Agent Gateway 之间的 WebSocket 双向流式通信，完成 `CodexAdapter` 对 Codex App Server 的深度原生集成。
- **交付物 (Deliverables)**：
  - Gateway WebSocket Server（支持 `WsEnvelope` 编解码、会话维护与心跳保活）。
  - `CodexAdapter` 原生实现（Thread 创建、Turn 启动、Item 流式转发）。
  - Context Snapshot 动态装配器（`ContextBuilder`）。
  - 动态工具 (Dynamic Tools) 注入与结果回传闭环。
- **验收标准 (Acceptance Criteria)**：
  - 客户端通过 WebSocket 发送消息，能实时收到 `agent.text.delta` 逐字流式返回。
  - Agent 能正确发起 `tool_call` 并成功接收网关返回的 `tool_result`。
  - 异常断线能基于 `sessionId` 恢复状态。

---

## M2: 学习者画像引擎、错题本与 FSRS 算法

- **核心目标**：在 Gateway 与领域核心中落地学习者多维画像计算、错题本归因体系与 FSRS 记忆衰减算法。
- **交付物 (Deliverables)**：
  - `packages/learner-core` 中的 FSRS 调度算法实现。
  - 优势与薄弱项量化评估器（识别高频出错知识点并打上 Weakness 标签）。
  - 错题本领域逻辑（错因分类、订正重练、彻底攻克状态流转）。
  - 基于 SQLite / 内存的 `LearnerRepository` 持久化实现。
- **验收标准 (Acceptance Criteria)**：
  - 单测覆盖 FSRS 算法在各种评级 (`AGAIN`/`HARD`/`GOOD`/`EASY`) 下的间隔计算。
  - 用户连续 2 次做错同一考点后，该考点自动晋级为 `WEAKNESS` 标签。
  - 错题重做连续正确 2 次后，状态自动更新为 `isResolved: true`。

---

## M3: 现代 Web 学习客户端 (卡片复习与做题练习)

- **核心目标**：基于 React 19 + Tailwind + shadcn/ui 打造响应迅捷、高颜值的 Web 学习界面。
- **交付物 (Deliverables)**：
  - **学习卡片模块**：生词卡与语法卡翻转交互、FSRS 评级快捷键（1/2/3/4）。
  - **交互做题模块**：单选题、完形填空题答题卡，支持 0ms 本地秒级比对判定。
  - **能力雷达图模块**：展示学习者在词汇、语法、听力等维度的优势与缺陷。
  - **错题本复盘界面**：按错因分类筛选、一键发起错题重练。
- **验收标准 (Acceptance Criteria)**：
  - Web 端在 Chrome / Edge 中流畅运行，首屏加载小于 1 秒。
  - 客观题作答无需等待网络大模型往返，就地反馈正误。

---

## M4: AI 靶向自适应出题与智能批改闭环

- **核心目标**：将学习者薄弱画像与 AI Agent 闭环打通，实现“测出弱点 -> 定向出题 -> 智能批改 -> 沉淀错题”的全自动化教学。
- **交付物 (Deliverables)**：
  - 服务端工具 `quiz.generateAdaptive`：基于当前 Top 弱项生成针对性练习。
  - 服务端工具 `quiz.gradeSubmission`：针对主观翻译/造句的多维深度诊断。
  - 自动沉淀流水线：批改完成后无缝触发错题入库与画像指标更新。
- **验收标准 (Acceptance Criteria)**：
  - AI 生成的试题 100% 符合 Zod Schema，绝不出现格式错乱或超纲。
  - 主观题批改能准确指出语法错误、母语负迁移原因并给出地道润色。

---

## M5: 教材导入、PDF 交互阅读、多媒体扩展与 Tauri 桌面发布

- **核心目标**：支持《标日》、《大家的日语》等教材结构化抽取、按需加载交互式 PDF 阅读器、音视频辅助播放器与 Tauri 桌面端封装。
- **交付物 (Deliverables)**：
  - 教材结构化知识树（Textbook AST）解析与卡片一键导入。
  - 基于 `pdfjs-dist` 的动态懒加载 PDF 阅读器（透明 Text Layer 划词即查与 Context 提问）。
  - 多媒体播放器组件（支持音频短句切片、听力跟读与字幕点选）。
  - `apps/desktop` Tauri v2 打包配置，产出 Windows / macOS 安装包。
- **验收标准 (Acceptance Criteria)**：
  - 导入教材章节后可直接生成该课生词卡；
  - Windows 桌面包实测基线（2026-09-23）：NSIS 安装包约 31.9 MB、MSI 约 45.7 MB；Gateway Sidecar 解包后约 111 MB。后续以真实安装包与启动体验评估优化，不再把小于 20 MB 作为验收门槛。

---

## M6 之后：远期 Backlog（有明确需求或资源到位才排期）

> 按 2026-09-06 取舍会记录；排序不分先后，进每一项之前必须先有产品确认（成本 / 触发策略 / 回退语义）。
> **2026-09-06 决策落地**：TTS 接口（`packages/speech`；C1 合并时由旧包更名）＋ Web Speech 真机默认引擎 +
> 分语言提示词/上下文）、Readability 正文升级（一级抽取 + 启发式兜底）、词典保持用户手动一键按需安装
> （设置页按 Gateway 目录渲染全语种包）——三项已实现，不再是远期。接入一律真机，stub 只允许出现在单测。

- **TTS 神经语音 voiceId 映射**（剩余）：接口与透传已就绪（`TtsNeuralOptions.voiceId/stylePrompt`），缺外部 TTS 端点选型与费用方案，定了再排。
- **韩语 AI 正文 + TOPIK 配题**：韩语新闻 RSS 已通，AI 生成正文仍是英文脚手架，需韩语 prompt 与质量验收。
- **词典包预装 vs 按需安装**：**已决策——保持按需一键安装**（不同语种不同词典），不预装。
- **Responses 真实 API**：lite stub + 路由已就位；真接意味着模型成本与延迟，先有明确场景再说。
- **OJAD 权威声调接入**：当前深链方案合规可用；真接入交给专项 agent。
- **旧领域工具摘除**：兼容别名单独保留中，需明确 deprecation 窗口后再删。
- **Android 轻量伴随端**：桌面端收口并验证留存后再排期；首期只做复习、练习与学习记录，不要求手机本地 Agent / ACP。开工前先确定联网、离线与跨设备数据策略，并验证 Gateway 部署方式；当前桌面 Sidecar 不可直接作为 Android 运行方案。iOS 不在当前路线图承诺内。

## 明确不做（Do Not Do）

> 以下方向经 2026-09-06 取舍会否决，不再立项；后人重提需先推翻本节理由。

- **MCP 业务总线 / Anki 导出**：与 `AGENTS.md`“原生工具优先、MCP 最后”铁律冲突；MCP 仅限外部异构系统桥接。
- **真实 pdfjs 二进制渲染管线**：仿真排版 + 划词/批注/转卡交互已全通；真 PDF 解析是无底洞，有用户明确要求再议。
- **入学定级考 / 知识图谱联想 / 事件溯源**：早期畅想项，无用户需求支撑，不立项。
- **ACP 适配器**：按 `AGENTS.md §1.5` 仅为可选兼容通道，不得削弱 Codex 原生通路；无需求则不建。
