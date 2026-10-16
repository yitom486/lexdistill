# LexDistill - 系统架构设计规格说明书 (System Architecture Specification)

> **文档版本**：v1.1（2026-09-23：明确桌面优先与 Android 伴随端运行边界）
> **维护责任人**：首席系统架构师  
> **核心架构原则**：单体模块化 (Modular Monolith)、强隔离适配层、学习者资产中心化、统一网关屏障
>
> **Gateway 演进计划**：[领域模块化迁移计划](./gateway-domain-migration-plan.md)（提议，按阶段实施；包含模块命名、文件映射与兼容性验收）

---

## 一、系统上下文架构 (C4 Context Diagram)

```mermaid
C4Context
    title LexDistill - 系统上下文图 (Level 1)

    Person(learner, "外语学习者", "使用 Web 浏览器或桌面客户端进行刷卡复习、练习做题、查看错题本及接受 AI 个性化批改与辅导")

    System(studyStudio, "LexDistill 系统", "提供自适应练习出题、FSRS 间隔复习调度、AI 智能批改诊断、能力画像与学习资产管理")

    System_Ext(codexAppServer, "Codex App Server", "原生 Agent 执行引擎，提供 Thread/Turn 管理、流式生成、动态工具执行与沙箱审批")
    System_Ext(externalMcp, "外部 MCP 工具集", "Anki 同步、Notion 知识库导出等第三方工具集成")
    System_Ext(externalDict, "权威词典服务", "提供词汇词条、音标、例句等权威检索")

    Rel(learner, studyStudio, "通过 Web (HTTP/WS) 或桌面端交互", "WebSocket / JSON")
    Rel(studyStudio, codexAppServer, "派发 Agent 任务与消费流式事件", "IPC / JSON-RPC / WS")
    Rel(studyStudio, externalMcp, "调度外部集成能力", "MCP 协议")
    Rel(studyStudio, externalDict, "查词与例句拓展", "REST API")
```

---

## 二、系统容器架构 (C4 Container Diagram)

```mermaid
C4Container
    title LexDistill - 容器与子系统图 (Level 2)

    Container_Boundary(c_client, "客户端层 (Client Layer)")
        Container(web_app, "Web 学习客户端 (apps/web)", "React 19, TypeScript, Vite, Tailwind, shadcn/ui", "展示学习卡片、答题界面、实时批改结果、错题本与优势/缺陷能力雷达")
        Container(desktop_shell, "桌面端外壳 (apps/desktop)", "Tauri v2 (Rust)", "包装 Web 产物，提供原生系统托盘、本地文件缓存与系统级快捷键")
    Container_Boundary_End()

    Container_Boundary(c_gateway, "服务端调度中枢 (Agent Gateway - apps/gateway)")
        Component(session_mgr, "Session Manager", "TypeScript", "管理连接生命周期、认证鉴权与学习者交互上下文")
        Component(context_bldr, "Context Builder", "TypeScript", "提取题干、答题结果、当前弱项标签组装 Context Snapshot")
        Component(agent_router, "Agent Router", "TypeScript", "四级路由 (DIRECT / FAST / REASONING / AGENT)")
        Component(tool_router, "Tool Router", "TypeScript", "调度 Client / Server / MCP 工具并做权限管控")
        Component(event_router, "Event Router", "TypeScript", "规范化双向 WebSocket 事件流")
    Container_Boundary_End()

    Container_Boundary(c_core, "核心领域引擎 (Domain Core Packages)")
        Component(learner_core, "Learner Core (packages/learner-core)", "TypeScript", "学习者画像、薄弱项统计、做题记录、错题本生命周期与 FSRS 算法")
        Component(agent_core, "Agent Runtime Contracts (packages/agent-runtime/src/contracts)", "TypeScript", "统一 AgentAdapter, AgentSession, AgentEvent 纯抽象")
        Component(tool_core, "Tool Core (packages/tool-core)", "TypeScript", "统一工具契约、Zod Schema 与权限定义")
    Container_Boundary_End()

    Container_Boundary(c_adapters, "Agent 适配器层 (Adapter Layer)")
        Component(codex_adapter, "CodexAdapter (packages/agent-runtime/src/adapters/codex)", "TypeScript", "对接 Codex App Server 原生 Thread/Turn/Item 事件流")
        Component(resp_adapter, "ResponsesAdapter (预留)", "TypeScript", "轻量化单次问答与极速批改适配")
    Container_Boundary_End()

    ContainerDb(db, "持久化存储 (Database)", "SQLite / PostgreSQL", "存储用户档案、熟练度指标、答题记录、错题记录与卡片状态")

    Rel(web_app, session_mgr, "建立长连接与数据交互", "WebSocket & HTTP")
    Rel(desktop_shell, web_app, "嵌入渲染", "Webview")
    Rel(session_mgr, context_bldr, "请求装配上下文", "In-Process")
    Rel(session_mgr, agent_router, "提交任务", "In-Process")
    Rel(agent_router, codex_adapter, "派发复杂 Agent 任务", "AgentAdapter 接口")
    Rel(codex_adapter, tool_router, "执行 Tool Call", "ToolRouter 接口")
    Rel(tool_router, web_app, "转发 Client Tools (如高亮)", "WebSocket")
    Rel(tool_router, learner_core, "执行 Server Tools (如记错题)", "In-Process")
    Rel(learner_core, db, "读写学习者数据与错题本", "Repository 模式")
```

---

## 三、客户端与数据库管理架构决策 (Tauri vs Next.js vs Vite)

针对用户的核心疑问：**“客户端采用 Tauri，数据库是放在 Tauri Rust 层管理更好，还是用 Next.js 这类框架直接对接更好？”**

针对当前桌面主产品，我们采用**“Vite/React 共享界面 + 模块化单体 Gateway 统一管库 + Tauri 桌面外壳”**。浏览器运行态服务于开发、预览与调试，不构成必须单独发行的产品：

### 3.1 方案优缺点深度对比

| 评估维度 | 方案 A：Tauri Rust 直接管库 | 方案 B：Next.js 全栈直连 | 方案 C (采纳方案)：Gateway 统一管库 + Vite 前端 + Tauri 壳 |
| :--- | :--- | :--- | :--- |
| **多端同构性** | Web 客户端不能直接调用 Tauri Rust IPC，需另设浏览器接口。 | SSR、Server Actions 与桌面本地封装需额外设计。 | Web 与 Tauri 桌面复用 React 界面和 Gateway 协议；Android 需适配移动 UI，并另行决定 Gateway 运行与数据同步方式。 |
| **安装包与资源开销** | Tauri 壳轻，但业务若迁入 Rust 有迁移成本。 | SSR 与桌面本地运行时需额外设计。 | Windows 当前实测：NSIS 安装包约 31.9 MB、MSI 约 45.7 MB；Gateway Sidecar 解包后约 111 MB。 |
| **数据库一致性** | 业务逻辑下沉到 Rust，需要维护复杂的 Rust SQL 与前端 TypeScript 序列化。 | 严重受限于 Vercel / Node 部署范式，不利于轻量离线运行。 | **极高**。在 Gateway 内通过 TypeScript ORM/Repository 统一管理，与领域模型零距离。 |
| **单机离线运行能力** | 可在 Tauri 本地实现。 | 通常依赖外部服务或额外本地运行时。 | 桌面端通过本机 Sidecar + SQLite 支持；Android 离线能力尚未定案，不能从桌面实现直接推导。 |

### 3.2 架构实施原则
1. **统一由 Gateway 提供数据抽象**：
   - 数据库操作全部封装在 `packages/learner-core` 的 `LearnerRepository` 接口之后。
   - 业务、做题记录与错题本的 SQL 逻辑集中于 Gateway，绝不在前端散落裸露 SQL。
2. **Web 客户端轻量化 (`apps/web`)**：
   - 采用 **Vite + React 19**，开发体验极速，构建出标准的静态产物目录 `dist/`。
3. **Tauri 桌面端无缝接入 (`apps/desktop`)**：
   - Tauri 的 `tauri.conf.json` 中 `frontendDist` 直接指向 `../web/dist`，复用 React 界面构建 Windows / macOS / Linux 桌面应用。

### 3.3 Android 伴随端策略

- Android 是桌面端之后的轻量伴随端目标，首期聚焦卡片复习、练习与学习记录，不要求手机本地运行 Agent / ACP。
- React 界面与 `packages/protocol` 契约可以复用；手机布局、触控与系统权限需要适配。
- 当前 Gateway Sidecar 构建脚本只生成桌面目标。Android 开工前必须先决定 Gateway 由远程服务提供，还是建设移动端本地实现；同时明确离线与跨设备数据策略。
- 若未来需要 Android AI 辅导，优先由可访问的远程 Gateway 执行 Agent，手机只提交请求并展示流式结果。手机本地 Agent 不属于当前目标。

---

## 四、Agent Gateway 内部拓扑与流式做题/批改数据流

```mermaid
sequenceDiagram
    autonumber
    actor Learner as 学习者 (Web / Desktop)
    participant GW as Agent Gateway (Session & Router)
    participant CB as Context Builder
    participant TR as Tool Router
    participant LC as Learner Core Engine
    participant CA as CodexAdapter
    participant CAS as Codex App Server

    Note over Learner, CAS: 阶段 1: AI 靶向出题流
    Learner->>GW: 请求出题 (client.turn.send: 针对薄弱项)
    GW->>CB: 抓取当前用户薄弱点 (TOP 3 错误标签)
    CB->>LC: getWeaknesses(userId)
    LC-->>CB: 返回 ['jp.particle.ni_vs_de', 'jp.tense.past']
    CB-->>GW: 装配包含等级与弱项的 ContextSnapshot
    GW->>CA: send(input, contextSnapshot)
    CA->>CAS: 启动 Turn 并动态注入 quiz.generate 约束
    CAS-->>CA: 触发 ToolCall: quiz.generateAdaptive(args)
    CA->>TR: executeServerTool('quiz.generateAdaptive', args)
    TR->>LC: 生成结构化题目
    LC-->>TR: 返回题目与参考解析 (Zod 校验通过)
    TR-->>CA: 回传 ToolResult
    CAS-->>CA: 流式输出试题说明 (TEXT_DELTA)
    CA-->>GW: AgentEvent.TEXT_DELTA
    GW-->>Learner: 下发题目数据 (agent.turn.finish)

    Note over Learner, CAS: 阶段 2: 答题与智能批改流
    Learner->>GW: 提交作答 (client.turn.send: 用户答案)
    alt 客观题 (单选/填空)
        GW->>LC: 0ms 本地比对标准答案与容错变体
        LC-->>GW: 即时比对成功 / 判定错误
    end
    GW->>CB: 装配包含作答记录的 ContextSnapshot
    GW->>CA: send(作答内容, contextSnapshot)
    CA->>CAS: 启动批改 Turn
    CAS-->>CA: 流式生成错因诊断与润色报告 (TEXT_DELTA)
    CA-->>GW: 实时转发文本流
    GW-->>Learner: 客户端实时流式渲染批改解析
    CAS-->>CA: 触发 ToolCall: learner.recordMistake(...)
    CA->>TR: executeServerTool('learner.recordMistake', errorInfo)
    TR->>LC: 写入错题本并更新用户薄弱项指标
    LC-->>TR: 确认持久化完成
    TR-->>CA: 回传结果
    CAS-->>CA: Turn 结束
    CA-->>GW: agent.turn.completed
    GW-->>Learner: 批改完成，已自动沉淀入错题本
```

---

## 五、Tool 体系与三层权限模型

所有的工具必须向 `packages/tool-core` 注册，并声明以下属性：
1. **Name & Description**：语义化名称与模型易读描述。
2. **Location**：
   - `CLIENT`：客户端工具，网关通过 WebSocket 下发给 Web 客户端执行（如 UI 标注、短句发音）；
   - `SERVER`：服务端工具，网关本地直接执行（如词典查询、错题沉淀）；
   - `EXTERNAL`：外部工具，通过 MCP 适配器代理（如 Anki 同步）。
3. **Permission**：
   - `READ`：只读无害（无条件放行）；
   - `WRITE`：常规数据记录（默认自动允许，产生局部日志）；
   - `DESTRUCTIVE`：高危破坏性操作（如清空错题本，必须经用户确认）；
   - `SENSITIVE`：隐私与敏感权限（如麦克风长期监听，需客户端授权）。
