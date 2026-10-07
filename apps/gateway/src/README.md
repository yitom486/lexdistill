# `apps/gateway/src` — Agent Gateway 源码阅读指南

> 这里是 Lingua Studio 的后端中枢：客户端唯一连接的 HTTP + WebSocket Gateway。
>
> Web 客户端（`apps/web`）和桌面端（`apps/desktop`）只通过 Gateway 使用服务端能力。Gateway 的文件负责串接请求与领域用例；通用学习算法、协议契约、存储适配和 Agent 适配器由 `packages/*` 提供。梳理业务流程时先读本目录，遇到具体能力实现再追到对应 package。

---

## 1. 先理解 Gateway 在系统中的位置

Lingua Studio 采用**模块化单体（Modular Monolith）**，不是把每个学习功能拆成独立服务。Gateway 在一个进程内组合以下能力：

```mermaid
flowchart TD
    Client["Web / Tauri 客户端"]
    Adapters["agent-runtime/adapters"]
    Learner["learner-core 学习资产 SSOT"]

    subgraph Gateway["Agent Gateway 模块化单体"]
        Transport["Transport"]
        Runtime["Runtime"]
        Session["Session"]
        Context["ContextSnapshot"]
        Router["AgentRouter + ToolRouter"]
        Modules["Domain Modules"]
        Repository["Repository Facade"]
        SQLite["SQLite"]

        Transport --> Runtime
        Runtime --> Session
        Runtime --> Context
        Context --> Router
        Router --> Modules
        Modules --> Repository
        Repository --> SQLite
    end

    Client -->|"HTTP + WebSocket"| Transport
    Router --> Adapters
    Repository --> Learner
```

Gateway 的四个核心职责是：

1. **通信屏障**：向客户端提供 HTTP 和 WebSocket，不让客户端直连数据库或 LLM。
2. **领域调度**：把 HTTP、WebSocket、Agent Tool 等不同入口统一转成领域用例。
3. **Agent 编排**：组装 `ContextSnapshot`，选择 `AgentAdapter`，转发标准化事件流。
4. **学习资产落库**：通过 Repository 和领域模块读写 SQLite，保证学习者数据不依附于模型 Thread。

### 重要边界

- `transport/` 负责协议转换，不拥有权威学习规则。
- `modules/*/application/` 负责领域用例和业务编排。
- `modules/*/persistence/` 负责具体领域的数据库读写。
- `infrastructure/` 负责数据库、Repository 门面和跨域基础设施。
- `runtime/` 负责通用 Agent 运行时（会话、上下文、路由与流式协调），不属于某个具体学习领域。
- 具体模型厂商代码只能存在于 `packages/agent-runtime/adapters/*`，Gateway 只依赖 `agent-runtime` 抽象。

---

## 2. 推荐的源码阅读顺序

第一次阅读本目录时，建议按照下面的顺序，而不是从某个 HTTP 路由文件开始：

### 第一步：看启动装配

```mermaid
flowchart LR
    Index["index.ts"] --> Config["bootstrap/config.ts"]
    Config --> Create["bootstrap/create-gateway.ts"]
    Create --> Start["bootstrap/start-gateway.ts"]
```

这里可以回答“系统如何启动、依赖从哪里来”。

### 第二步：看对外入口

```text
transport/http/create-app.ts
transport/http/*-routes.ts
transport/websocket/websocket-handler.ts
```

这里可以回答“客户端发来的 HTTP/WS 消息如何进入系统”。

### 第三步：看运行时主循环

```text
runtime/gateway-runtime.ts
runtime/session/session-manager.ts
runtime/context/context-builder.ts
runtime/router/agent-router.ts
runtime/router/tool-router.ts
```

这里可以回答“一次 Agent Turn 如何创建、运行、流式返回、调用工具和结束”。

### 第四步：看领域模块

根据业务问题进入对应的 `modules/*`，优先看：

```text
application/  →  用例和业务编排
http/         →  HTTP 入口
 tools/       →  Agent 原生 Tool 入口
persistence/  →  数据库读写
```

### 第五步：最后看基础设施

```text
packages/storage-sqlite/          # M4/D2 起：SQLite 适配层（schema/迁移/种子/诊断）
infrastructure/persistence/
infrastructure/drizzle-learner-repository.ts
```

这里解释“数据最终怎样落到 SQLite，以及各个领域如何共享事务和 Repository 上下文”。

---

## 3. 顶层入口与启动装配

| 路径 | 作用 |
|---|---|
| `index.ts` | 生产入口和兼容导出；创建应用依赖并暴露 `startGatewayServer` 等入口。 |
| `sidecar.ts` | 桌面端 sidecar 场景使用的启动入口。 |
| `bootstrap/config.ts` | 读取 Gateway 配置，例如 `GATEWAY_PORT` 和 `STUDY_STUDIO_DB`；测试可以使用 `:memory:`。 |
| `bootstrap/create-gateway.ts` | `createGateway()` 创建 Repository 和 GatewayServer，并执行启动期内容初始化；Agent Adapter 由装配根经 `composition/agent-deps.ts` 工厂显式注入，Tool Registry 由 GatewayServer 构造时装配。 |
| `bootstrap/start-gateway.ts` | 启动监听生命周期。通过 `Bun.serve` 承载 HTTP，并处理 `/ws` 升级；不放领域逻辑。 |

`bootstrap/` 的依赖方向是单向的：它可以装配其他层，但领域代码和传输代码不应该反向依赖启动装配目录。

---

## 4. `transport/`：把外部请求转换成内部调用

`transport/` 是协议适配层，负责解析请求、校验载荷、调用 Gateway Runtime 或领域用例，并把结果编码回 HTTP/WS。它不应该复制 FSRS、错题判定或学习统计规则。

### `transport/http/`

| 文件 | 作用 |
|---|---|
| `create-app.ts` | 创建 Hono 应用，配置 CORS、404、统一错误兜底，并挂载各域路由。导入它本身不会打开真实数据库。 |
| `../composition/gateway-deps.ts` | 定义 HTTP 路由可使用的 `GatewayDeps`，是 repo、runtime/server 等依赖的统一来源（E4a 起家于此）。 |
| `../composition/agent-deps.ts` | 定义 Agent 装配契约 `AgentAdapterFactory` 与生产默认工厂；Adapter 创建权收归装配根，各领域模块经 ToolRegistry 按工具名订阅，不持有 Adapter 实例。 |
| `health-routes.ts` | 健康检查和运行状态接口。 |
| `agent-routes.ts` | Agent Session/Turn 等 Agent 管理接口。 |
| `learning-routes.ts` | 历史兼容入口；将跨域的 `learning.content`、`learning.assess` 请求委托给 Tool/领域能力。 |

领域新增 HTTP API 时，优先把路由放到对应的 `modules/<domain>/http/`，再由 `create-app.ts` 统一挂载，而不是继续把所有接口写进 `learning-routes.ts`。

### `transport/websocket/`

| 文件 | 作用 |
|---|---|
| `websocket-handler.ts` | 处理连接、统一 WS Envelope、解析客户端事件、发送 Gateway/Agent 事件，并把业务消息交给 `GatewayServer.handleClientMessage`。 |

WebSocket 主要用于实时场景：

```mermaid
sequenceDiagram
    participant Client as Client
    participant WS as websocket-handler
    participant Runtime as GatewayRuntime

    Client->>WS: client.turn.send
    WS->>Runtime: 转发 Turn
    Runtime-->>WS: agent.turn.start
    WS-->>Client: agent.turn.start

    loop 流式输出
        Runtime-->>WS: agent.text.delta
        WS-->>Client: agent.text.delta
    end

    opt 按需调用
        Runtime-->>WS: agent.tool.call / agent.approval.request
        WS-->>Client: 转发事件
    end

    Runtime-->>WS: agent.turn.completed 或 agent.error
    WS-->>Client: 终态事件
```

客户端发来的数据属于不可信边界，必须先通过协议 Schema 校验，再进入运行时或领域模块。

### `transport/tools/`

这里是跨域 Tool 的入口和装配位置：

| 路径 | 作用 |
|---|---|
| `register-tools.ts` | 在启动装配阶段向 Tool Registry 注册 Gateway 暴露的工具。 |
| `learning-plan-tool.ts` | 学习计划相关的跨域兼容入口。 |
| `ui-command-tools.ts` | `ui.navigate`、`ui.present` 等 Client Tool，执行时通过 WS 下发到前端。 |

具体领域 Tool 放在 `modules/*/tools/`；`learning.content` 的实现归 `modules/learning-content/`，此处只保留跨域入口和注册装配，不是新的“大工具实现集中地”。

---

## 5. Agent 运行时：`runtime/`

### `runtime/`：跨领域的 Agent 运行协调

| 文件/目录 | 作用 |
|---|---|
| `runtime/gateway-runtime.ts` | Gateway Runtime 主协调器：管理 Turn、连接 Session、消费 `AgentEvent`、调用 Tool、转发客户端事件。旧的 `server.ts` 实现已迁移到这里。 |
| runtime/handlers/turn-handlers.ts | 处理 Turn 发送与流式输出。 |
| runtime/handlers/queue-handler.ts | 消费 Agent 队列并汇总队列 Turn。 |
| runtime/handlers/control-handlers.ts | 处理审批、打断、引导与客户端工具回执。 |
| `runtime/responses-lite-coach.ts` | 轻量 Coach 旁路，适合快速问答；学习闭环默认仍由 Codex 主通路处理。 |
| `runtime/turn-summary-builder.ts` | 生成 Turn 摘要、最终结果和失败时的用户友好回退文案。 |

这里应该放“Agent 如何运行”的通用逻辑，不应该放“助词题如何判定”或“FSRS 如何计算”这样的领域规则。学习类 WebSocket 消息由 `modules/practice/websocket/` 和 `modules/learning-progress/websocket/` 适配；`GatewayRuntime` 按事件类型分发，并只经对应模块的 `public.ts` 调用。

### `runtime/session/`：会话生命周期

| 文件 | 作用 |
|---|---|
| `runtime/session/session-manager.ts` | 管理客户端会话和 Agent Session 的创建、恢复、查找、关闭；协调流式事件和 Tool Result 回填。 |

要区分两个概念：

- **Client Session**：客户端与 Gateway 的连接/学习会话。
- **Agent Session**：Gateway 与具体 Agent Adapter 之间的模型会话。

客户端不应该直接管理 Codex Thread；客户端只持有系统协议中的 session/turn 标识。

### `runtime/context/`：构建不可变 `ContextSnapshot`

| 文件 | 作用 |
|---|---|
| `runtime/context/context-builder.ts` | 合并客户端传来的当前 UI/题目/作答事实，并从 Repository 补充用户弱项、复习数据等学习摘要，形成发送给 Agent 的上下文快照。 |

上下文快照适合放：

- 当前题干和用户答案
- 当前目标语言和等级
- 当前打开的学习工作台
- 最近错误标签
- Top 弱项
- 到期卡片数和未解决错题数
- 本轮用户意图和硬约束

不要新增以下类型的反向读取工具：

```text
getCurrentQuestion()
getUserAnswer()
getActiveTab()
```

如果客户端或 Gateway 已知这些信息，应随 Turn 放入 Snapshot。Tool 只用于查询外部未知数据，或触发持久化写入。

### `runtime/router/`：选择 Agent 和执行 Tool

| 文件 | 作用 |
|---|---|
| `runtime/router/agent-router.ts` | 根据路由策略选择 `codex`、Responses 或未来的其他 `AgentAdapter`。业务模块不直接选择厂商 SDK。 |
| `runtime/router/tool-catalog.ts` | Gateway 工具中央目录：基线/意图/提示词表 + 固定任务显式集 + `resolveSessionTools` 单一解析入口（选型唯一 owner，实现仍在各域）。 |
| `runtime/router/turn-tools.ts` | 薄包装（对外签名不变，转发 tool-catalog；历史测试入口保留）。 |
| `runtime/router/tool-router.ts` | 根据 Tool Registry 的定义执行 Server/Client/External Tool，检查权限，并把结果回传给 Agent。 |

推荐的数据流是：

```mermaid
flowchart LR
    Call["Agent 原生 tool_call"] --> Router["ToolRouter"]
    Router --> Registry["Tool Registry 中的 Tool"]
    Registry --> Application["application 用例"]
    Application --> IO["persistence / 外部 IO"]
    IO --> Result["ToolResult"]
    Result --> Submit["AgentSession.submitToolResult()"]
```

学习域工具优先走进程内的原生 Tool 调度；MCP 只用于 Anki、Notion 等外部异构系统，不作为默认学习工具总线。

---

## 6. `modules/`：按领域组织业务能力

每个领域模块通常采用以下结构：

```text
modules/<domain>/
├── application/   # 领域用例、业务编排、事务边界
├── http/          # 该领域的 HTTP 路由
├── tools/         # 该领域提供给 Agent 的原生 Tool
├── persistence/   # 该领域的数据读写
└── infrastructure/# 仅在该领域确有专属外部 IO 时使用
```

阅读一个模块时，先找 `application/`，因为它最能说明业务意图；再看 `http/` 和 `tools/`，理解有哪些入口；最后看 `persistence/`，理解数据如何保存。

### `modules/practice/`：练习领域

负责练习模板、练习运行、题目装配、答题提交、判题和复盘。

- `application/`：练习装配、客观题判题、AI 建议 propose/apply、练习总结。
- `persistence/`：练习计划、练习运行、题库、作答记录。
- `tools/`：练习生成、练习批改、自适应出题、主观题批改等 Agent Tool。
- `http/`：练习域 HTTP 入口。
- `websocket/`：练习提交、自适应出题和主观题批改的 WS 协议适配；由 `public.ts` 对 Gateway Runtime 提供稳定入口。
- `__tests__/`：装配、判题和练习闭环测试。

客观题的确定性判断应优先在本地领域逻辑中完成；主观题的深度诊断可以交给 Agent，但最终结果和相关学习进度仍需写回领域层。

### `modules/learning-content/`：学习内容生成领域

负责由课程内容模板生成练习内容、讲解、例句、短文和语言专项练习。模块内部分工如下：

- contracts.ts：内容命令的参数 Schema、输入输出和调用上下文契约。
- ports.ts：模板查询、课程读取、词典抽样和可选练习收集能力的接口。
- application/execute-learning-content.ts 与 application/actions/：领域命令分发及各内容动作实现。
- tools/learning-content-tool.ts：Agent Tool 适配器，校验仓储能力后调用领域命令。
- public.ts：对其他领域公开命令、Tool 与类型；Tool 注册由 transport/tools/register-tools.ts 统一装配。

### `modules/learning-progress/`：学习进度领域

负责用户画像和长期学习状态：

- 用户 Profile 和语言档案
- 技能指标、优势/弱项和错误标签
- 每日计划和学习活动
- 错题新增、重做、攻克和生命周期
- 练习成绩、假名成绩、阅读成绩写回
- 学情分析快照

其中：

- `application/`：学习分析等用例。
- `persistence/`：Profile、Mistakes、Activity Plan、Learning Records 等数据读写。
- `tools/`：学习进度相关 Agent Tool。
- `http/`：画像、任务、计划、错题和分析路由。
- `websocket/`：画像读取/更新、每日进度读取/活动记录的 WS 协议适配；由 `public.ts` 对 Gateway Runtime 提供稳定入口。

该模块是学习者事实源的主要后端落点，但不应该把练习模板或练习运行本身据为己有。

### `modules/review/`：复习和 FSRS 领域

负责闪卡复习命令和记录写入：

- `persistence/`：卡片数据和复习记录。
- `http/`：卡片查询、到期卡片和复习提交。

FSRS 算法由 `packages/learner-core` 掌握，本模块只调用领域契约，不在 Gateway 中复制一套调度算法。

### `modules/flashcards/`：闪卡兼容/拆分模块

该目录包含 `application/`、`http/`、`persistence/`、`tools/`。它用于承接闪卡相关能力的模块化迁移；当前与 `review/` 存在历史拆分关系。

新增代码前应先确认能力属于：

- “复习调度和复习记录”——优先查看 `review/`；
- “闪卡内容或卡片管理”——查看 `flashcards/` 的现有用例和装配方式。

不要仅根据目录名称重复实现 FSRS 或卡片规则。

### `modules/curriculum/`：课程内容领域

负责公共课程和内容资产：

- 五十音、课程内容和教材结构
- 阅读篇目及其配题
- 新闻 RSS 和文章获取
- AI 阅读材料生成
- 发音相关课程路由

目录职责：

- `application/`：新闻篇目生成、新闻阅读等用例。
- `persistence/`：课程和篇目内容读写。
- `infrastructure/`：新闻 RSS、文章抓取等模块专属外部 IO。
- `tools/`：课程查询类 Agent Tool。
- `http/`：假名、阅读和发音相关路由。

课程资产是公共内容，不等同于用户长期学习进度；阅读成绩等用户学习记录应回写到 `learning-progress/`。

### `modules/dictionary/`：词典领域

负责：

- 词典包安装和管理
- 词条检索
- 来源链接
- 用户词条收藏

目录职责：

- `application/`：词典包、外部来源链接等用例。
- `persistence/`：词典数据读写。
- `tools/`：`dictionary-lookup` 等 Agent Tool。
- `http/`：查询、安装和收藏路由。

公共词典包和用户收藏属于不同数据归属。查词是只读能力；“收藏”“转卡”等写入能力要经过对应领域命令，而不是由路由直接改数据库。

### `modules/library/`：文库和用户资料领域

负责用户文档以及文档学习资产：

- 文档导入和存储
- 文档切片
- 批注
- 文档资料入库
- 批注转卡编排

- `persistence/`：文档和批注数据。
- `tools/`：文库相关 Agent Tool。
- `http/`：文档、切片和批注路由。

批注转卡可能跨越文库和复习领域，应通过共享用例/事务边界完成，不能在 UI 中拼接两次独立写入。

### `modules/tts/`：Gateway 侧语音入口

该目录包含 `application/` 和 `http/`，用于承接 Gateway 侧的语音请求。真正的语音引擎抽象位于 `packages/speech`；本模块负责把 HTTP/领域请求接到该抽象，不应在路由里直接实现 Azure 或其他厂商协议。

---

## 7. `infrastructure/`：数据库和 Repository 实现

基础设施层不拥有学习业务含义，只负责把领域契约落到具体技术上。

### `@study-studio/storage-sqlite`（M4/D2 起，前身 `infrastructure/db/`）

| 路径 | 作用 |
|---|---|
| `src/schema.ts` | SQLite/Drizzle 表结构定义。 |
| `src/ddl.ts` | 建表、迁移或 DDL 辅助。 |
| `src/connection.ts` | 数据库连接和初始化入口（`createDrizzleDb`）。 |
| `src/seed-bootstrap.ts` | 开发/安装阶段的 seed 初始化和自愈逻辑。 |
| `src/seeds/` | 静态课程或开发数据的种子资源。 |
| `src/index.ts` | 包唯一公共出口（白名单制）。 |

### `infrastructure/persistence/`

| 文件 | 作用 |
|---|---|
| `app-paths.ts` | 数据库和应用数据路径处理，兼容 Web 开发与 Tauri 桌面环境。 |
| `repo-context.ts` | 向各领域 persistence 提供共享的数据库依赖和 Repository 上下文。 |
| `repo-utils.ts` | 日期、JSON、种子等通用持久化辅助。 |
| `language.ts` | 语种归一和持久化边界处理。 |

### Repository 门面

`infrastructure/drizzle-learner-repository.ts` 实现 `packages/learner-core` 定义的 Repository 契约，并把具体操作委托给各领域的 `persistence/`。

可以把它理解为：

```mermaid
flowchart TD
    Contract["learner-core Repository 契约"] -->|"implemented by"| Facade["infrastructure/drizzle-learner-repository.ts"]
    Facade -->|"delegates to"| Persistence["modules/*/persistence/"]
    Persistence --> Database["SQLite / Drizzle"]
```

`infrastructure/sqlite-learner-repository.ts` 是旧的兼容门面，已经 deprecated。新代码不应优先使用它。

持久层的一个关键要求是：练习运行、作答记录、统计和学习进度需要保持正确的事务边界，不能为了拆模块而牺牲一次业务操作的原子性。

---

## 8. `errors/`：统一错误翻译

| 文件 | 作用 |
|---|---|
| `errors/http-error-handler.ts` | 把业务错误和未预期异常转换成安全的 HTTP 响应。 |

底层异常不能直接返回给客户端。错误应经过 `translateToBusinessError`，至少包含：

- `code`：机器可识别的错误代码
- `userMessage`：用户友好的说明
- `category`：例如 `VALIDATION`、`NETWORK`、`AGENT_RUNTIME`、`TOOL_EXECUTION`
- `retryable`：客户端是否可以重试

例如不要把下面的内容直接返回给用户：

```text
ECONNREFUSED
fetch failed
Unexpected token < in JSON
```

而应该转换成稳定的业务错误和可理解的提示。业务日志统一使用 `@study-studio/shared` 的 `logger`，不要在业务代码中散落 `console.*`。

---

## 9. 目录职责和迁移状态

### 持久化实现

旧的顶层 repository/ 目录已移除。持久层位于：

```text
infrastructure/                         # Repository 门面、DB、共享持久化基础
modules/*/persistence/                  # 各领域 SQL 和数据访问
```

### `transport/`

HTTP / WebSocket 协议适配、应用路由组合，以及跨领域 Tool 的注册装配。领域 Tool 适配器放在 `modules/*/tools/`，可复用的领域命令放在 `modules/*/application/`；跨域 Tool 和注册装配入口保留在 `transport/tools/`。

### `errors/`

统一把底层异常翻译并格式化为客户端可读的 `BusinessError` HTTP 响应。领域 HTTP 路由复用 `errors/http-error-handler.ts`。

### 顶层 `services/` 与 `tools/`

这两个通用目录已移除。课程阅读策略归 `modules/curriculum/application/`，Agent 教练策略归 `runtime/`；Tool 实现按领域放入 `modules/*/tools/`，跨域 Tool 和注册装配归 `transport/tools/`。

### `runtime/` 的职责边界

`runtime/context/`、`runtime/session/` 和 `runtime/router/` 分别承载上下文、会话与路由能力，均属于通用 Agent 运行时。领域业务继续放在 `modules/*`，不要在领域模块中复制一套 Agent 运行时。

---

## 10. 两条典型调用链

### 10.1 Agent 请求生成练习

```mermaid
sequenceDiagram
    participant Client as Client
    participant WS as websocket-handler
    participant Runtime as GatewayRuntime
    participant Context as ContextBuilder
    participant Repo as Repository
    participant Router as AgentRouter
    participant Adapter as AgentAdapter
    participant Tools as ToolRouter
    participant Content as learning-content module
    participant Session as AgentSession

    Client->>WS: client.turn.send
    WS->>Runtime: 转发 Turn
    Runtime->>Context: 构建 ContextSnapshot
    Context->>Repo: 查询用户弱项和学习摘要
    Repo-->>Context: 返回学习摘要
    Context-->>Runtime: ContextSnapshot
    Runtime->>Router: 路由 Turn
    Router->>Adapter: 启动 Turn（默认 Codex）
    Adapter-->>Runtime: Agent 原生 tool_call
    Runtime->>Tools: 执行 Tool
    Tools->>Content: 调用 learning.content
    Content-->>Tools: 返回结构化内容结果
    Tools-->>Runtime: ToolResult
    Runtime->>Session: submitToolResult()
    Session-->>Adapter: 继续 Agent Turn
    Adapter-->>Runtime: agent.text.delta / agent.turn.completed
    Runtime-->>WS: 转发 AgentEvent
    WS-->>Client: WebSocket 返回客户端
```

要点：题目等结构化数据必须经过校验后再交给 UI；文本流用于解释，不应该代替可交互题包。

### 10.2 用户提交答案并沉淀错题

```mermaid
sequenceDiagram
    participant Client as Client
    participant Transport as transport / runtime handler
    participant Practice as practice application
    participant Context as ContextBuilder
    participant Adapter as AgentAdapter
    participant Progress as learning-progress Tool
    participant Repo as learning-progress persistence

    Client->>Transport: client.quiz.submit
    Transport->>Practice: 提交作答
    Practice->>Practice: 客观题先做确定性判定
    Practice-->>Transport: 作答结果和诊断输入
    Transport->>Context: 组装作答快照
    Context-->>Transport: ContextSnapshot
    Transport->>Adapter: 主观诊断或错因分析
    Adapter-->>Transport: learning-progress tool_call
    Transport->>Progress: 执行学习进度 Tool
    Progress->>Repo: 写入 mistakes / learning-records
    Repo-->>Progress: 更新 skill metrics 和错题状态
    Progress-->>Transport: ToolResult
    Transport-->>Client: agent.turn.completed + learner.* 事件
```

Agent 负责解释和诊断；`learner-core` 与数据库负责长期事实记录。

---

## 11. 新功能应该放在哪里？

可以用下面的判断表：

| 问题 | 首选位置 |
|---|---|
| 是 HTTP/WS 请求解析、路由或响应格式吗？ | `transport/` 或对应模块的 `http/` |
| 是一次可复用的业务动作吗？ | 对应模块的 `application/` |
| 是给 Agent 原生调用的能力吗？ | 对应模块的 `tools/`，跨域才考虑 `transport/tools/` |
| 是某个领域的数据库读写吗？ | 对应模块的 `persistence/` |
| 是表结构、连接、路径、事务上下文吗？ | `infrastructure/` |
| 是 Agent Session、Turn、流式事件或模型路由吗？ | `runtime/` |
| 是所有模块都可能使用的错误、日志、ID、时间能力吗？ | `packages/shared` |
| 是具体模型厂商 SDK 或协议转换吗？ | `packages/agent-runtime/adapters/*` 等适配器 |

新增功能时优先遵循：

```mermaid
flowchart TD
    HTTP["HTTP 入口"] --> Command["领域命令"]
    WS["WebSocket 入口"] --> Command
    AgentTool["Agent Tool 入口"] --> Command
    Command --> Application["application 用例"]
    Application --> Persistence["persistence"]
    Persistence --> Protocol["protocol 稳定结构"]
```

不要把完整业务流程藏在 React 按钮回调、单个 HTTP 路由或 Agent Prompt 中。

---

## 12. 需要始终遵守的架构规则

1. **客户端只连接 Gateway**：不直连 SQLite、LLM、Codex 或 ACP 进程。
2. **Provider 零泄漏**：Gateway 业务层只使用 `agent-runtime` 抽象；具体厂商实现封装在 Adapter 包内。
3. **Context 优先**：客户端/Gateway 已知事实放入不可变 `ContextSnapshot`，不新增反向 Read Tool。
4. **原生 Tool 优先**：学习域能力通过 Tool Registry + ToolRouter 执行；MCP 只用于外部异构系统。
5. **学习者数据以数据库为 SSOT**：模型 Thread 不能代替 `learner-core` 和 Repository。
6. **不要复制领域规则**：FSRS、错题生命周期、熟练度和统计应由领域层统一掌握。
7. **错误先翻译再出网**：不要把底层异常、调用栈或厂商错误原文返回客户端。
8. **类型安全**：不要新增 `any`；跨信任边界的数据必须解析和收窄。
9. **静态数据要登记**：新增 seed、演示题库、Mock 状态或硬编码规则时，登记到 `.studio-internal/STATIC-DATA-INVENTORY.md`。
10. **按真实代码位置阅读**：持久化实现位于 infrastructure/ 与 modules/*/persistence/；领域 Tool 位于 modules/*/tools/。

---

## 13. 相关文档与命令

- 系统总架构：[`docs/architecture.md`](../../../docs/architecture.md)
- 通信协议：[`docs/protocol.md`](../../../docs/protocol.md)
- Agent 运行时：[`docs/agent-runtime.md`](../../../docs/agent-runtime.md)
- 学习者模型：[`docs/learner-model.md`](../../../docs/learner-model.md)
- Gateway 领域迁移基线：[`docs/gateway-g0-baseline.md`](../../../docs/gateway-g0-baseline.md)
- 顶层架构守则：[`AGENTS.md`](../../../AGENTS.md)

常用命令：

```bash
bun run dev:gateway
bun run typecheck
bun test
```

阅读 Gateway 时，最重要的问题不是“这个文件被谁调用”，而是：

> 这是在做协议转换、运行时协调、领域决策、持久化，还是具体 Agent/外部 IO？
>
> 先确定职责边界，再沿着上面的调用链追踪，通常就能快速理解代码应该放在哪里、数据应该经过哪一层。
