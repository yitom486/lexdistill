# Lingua Studio - 智能体协作与工程开发守则 (AGENTS.md)

> 对外产品名为 **Lingua Studio**；**Study Studio** 仅作为现有仓库、包命名空间和内部工程代号保留。

> 本文档是所有参与本工程（包括人类工程师与 AI Agent）必须严格遵守的**顶层宪章与不变量准则**。
> 任何代码变更如果违反以下规则，一律视为架构违规。

---

## 1. 架构不变量与边界铁律 (Architectural Invariants)

### 1.1 业务与模型厂商强解耦 (Zero Provider Leak)
- **禁止在核心业务中直接引用外部 SDK**：
  - `packages/learner-core`、`packages/tool-core`、`packages/protocol`、`apps/web` 绝对禁止 `import` 任何具体 AI 厂商库（如 `@openai/*`, `@anthropic/*`, `codex-*`, `acp-*`）。
  - 外部模型交互**必须且仅能**通过 `packages/agent-core` 中定义的抽象契约：`AgentAdapter`、`AgentSession`、`AgentEvent`。
  - 具体引擎代码（如 Codex App Server）必须完全封装在专有适配器中（如 `packages/agent-codex`）。

### 1.2 客户端通信唯一屏障 (Gateway Boundary)
- 客户端（Web 端 `apps/web`、桌面端 `apps/desktop`）**只连接系统自研的 Agent Gateway**（HTTP + WebSocket）。
- 客户端绝不直连任何 LLM 端点，不对底层是 Codex 还是其他模型产生任何感知。

### 1.3 上下文快照与工具调用的刚性边界 (Context vs Tools)
- **已知事实走快照**：题干内容、用户本次作答、用户语言等级、最近连续出错标签等界面已知事实，必须由前端或 Gateway 组装为不可变 `ContextSnapshot` 随 Turn 注入。
- **严禁反向 Read Tool 往返**：绝不允许 Agent 通过调用 `getCurrentQuestion()`、`getUserAnswer()` 等工具向客户端重复索要界面已知数据。
- **Tool 只用于未知与变更**：Tool 仅用于查询外部未知数据（权威词典检索）或触发持久化状态写入（错题入库、熟练度回写）。

### 1.4 Agent Gateway 的定位 (What Gateway Is)
- **Gateway = 客户端唯一后端屏障 + 领域调度中枢**（代码：`apps/gateway`），不是 Tauri 层，也不是 LLM 厂商本身。
- **职责边界**：
  1. 对客户端暴露 **HTTP + WebSocket**（`packages/protocol` 约定信封与事件）；
  2. 持有 / 调度 **SQLite（或未来 PostgreSQL）** 与 `learner-core` Repository；
  3. 组装 `ContextSnapshot`，经 `AgentRouter` 选择适配器，把 Turn 交给具体 `AgentAdapter`；
  4. 通过 `ToolRegistry` / `ToolRouter` 执行 **Server Tools**（出题、批改、错题入库等），必要时把 **Client Tools** 经 WS 下发给前端。
- **禁止事项**：前端不得直连数据库或任何 LLM/ACP 进程；业务包不得绕过 Gateway 私自起 Agent 会话。

### 1.5 Agent 引擎扩展与 ACP 接入方式 (Adapters & ACP)
- **所有引擎只许落在 Adapter 包内**：实现 `packages/agent-core` 的 `AgentAdapter` / `AgentSession`，在 Gateway 内注册即可，**业务与前端零感知**。
- **第一阶段主力**：`packages/agent-codex` → **Codex App Server 原生**能力（Thread / Turn / Item / dynamic tools / 审批），**禁止**用阉割版 ACP 去“兼容代替”Codex。
- **后续若需 ACP（Agent Client Protocol）**：
  1. 新增独立包（如 `packages/agent-acp`）实现 `ACPAdapter`；
  2. 在 Adapter 内完成 ACP 会话 ↔ 本系统 `AgentEvent` / `submitToolResult` 的双向翻译；
  3. Gateway 按路由策略选择 `codex` 或 `acp`，**不得**在 `apps/web`、`learner-core`、`tool-core` 中 `import` 任何 `acp-*` SDK；
  4. ACP 仅作为**可选兼容通道**，不得反向削弱 Codex 原生通路，也不得成为默认学习闭环依赖。

### 1.6 原生工具调用优先于 MCP (Native Tools First, MCP Last)
- **一等公民：引擎原生 Tool / Dynamic Tools + 本系统 `tool-core` Registry**。
  - 学习闭环内的出题、批改、词典、错题入库、熟练度回写等，必须注册为 Gateway **Server/Client Tool**，并由 Adapter 注入为运行时**原生 tool_call**（如 Codex `dynamic_tools`）。
  - 工具执行走 `ToolRouter` 进程内调度，结果经 `submitToolResult` 回填 Agent，**禁止**为同一能力再包一层 MCP 中转。
- **MCP 仅限外部异构系统的可选桥接**（如 Anki / Notion 同步），落在 `ToolLocation.EXTERNAL`：
  - 不得用 MCP 重写本已可原生调用的学习域工具；
  - 不得把 MCP 当作默认 Agent 工具总线，或要求每个 Turn 多跳一次 MCP Server；
  - 引入任何 MCP 依赖时，必须证明「目标系统无等价原生 API / 无本仓库内工具可覆盖」，并保持与 `agent-core` 契约隔离。
- **违反判定**：凡学习域工具仅因“图省事”改走 MCP、导致额外进程/协议往返的，一律视为架构违规。

### 1.7 领域能力与 UI 组合解耦 (Composable Domain Capabilities)
- **领域命令先于界面**：学习域能力（查词、收藏生词、建卡、复习、学习记录、AI 分析）必须先定义为 Gateway / Repository / `learner-core` 可调用的命令与数据契约；不得把核心流程藏在某个 React 组件、按钮回调或页面状态中。
- **UI 只负责组合与呈现**：Web / Tauri 组件通过 TanStack Query Mutation 调用领域命令、组合展示结果与交互反馈；禁止直连 SQLite、复制 FSRS / 统计 / 去重等业务规则，或让一个“大而全页面”成为唯一调用入口。
- **多入口复用同一业务链路**：同一能力必须可被不同界面、HTTP / WebSocket，以及未来 Agent 原生 Tool 复用；新增 AI 分析时应消费持久化学习资产与 `ContextSnapshot`，再通过同一命令写回结果，而不是读取或操纵 UI 私有状态。
- **数据归属明确**：词典包是可再分发的公共课程资产；生词卡、复习历史、每日统计和 AI 分析结果均为用户学习资产，必须按用户与目标语种持久化并可追溯。

### 1.8 静态表结构与行表达动态 (Static Schema, Rows for Dynamics)

- **禁止运行时动态建表**：任何"新教材 / 新用户 / 新内容"的需求一律用**加行**表达（`documents` / `textbook_*` 按 `document_id`、`user_id` 扩展行），绝不 `CREATE TABLE book_xxx` / `user_123_progress`。动态表名意味着 SQL 字符串拼接（注入风险）、迁移不可管、drizzle 类型不可见（只能 `as any` 糊，直接违反 §2.3）。
- **新维度才值得一次版本化迁移**：只有"以前从没存过的一类信息"（如文法例句列、自带习题表）才允许 `ALTER TABLE` / 新表，且必须走 `schema_migrations` 版本登记（`ddl.ts` 的 `runMigrations` 可重放、可断言；升级 SQL 放 `apps/gateway/src/infrastructure/db/migrations/`），随发版一次性升级，不在导入某本书的瞬间现造。禁止改已发布迁移的 version / name / sql，修复用更高 version 前向迁移。
- **教材六层模型对号入座**（新增教材相关表必须能映射进这六层，映射不进就说明设计错了）：
  - `material/document` → `documents`（`source_kind` 区分私产 `user_import` / 公共种子）；
  - `section` → `textbook_lessons`；`content_block` → `textbook_lines`；
  - `knowledge_point` → `textbook_vocab` + `textbook_grammar`（文法例句存 `examples_json`，v16）；
  - `exercise` → `textbook_exercises`（v16 起 shred 落库；此前仅 AST 内）；
  - 底稿 `documents.ast_json` 为 SSOT，shred 表永远由它同事务拆出（全删全插），两边永不分叉。
- **JSON 列只当底稿**：`ast_json` / `*_json` 存动态结构可以，但查询面要用的字段必须 shred 成列；全文检索走 FTS 虚表（建表语句静态，变的只是行）。

### 1.9 ORM 使用边界 (Drizzle First, Raw When Forced)

- **默认走 drizzle 构造器**：`db/schema.ts` 的表定义与 `ddl.ts` 的建表 SQL 必须一字对齐（SSOT 是 `ddl.ts`）；简单 CRUD 一律 `db.select/insert/update/delete` + `eq/and`，列名拼错要在编译期炸，不许裸写 `INSERT INTO …`。
- **只在三处允许原生 SQL**（且必须注释说明哪一条）：① DDL 与版本化迁移；② FTS 虚表建表与 `MATCH` 查询（drizzle 无一等支持）；③ 经实测证明的万行级批量热点。
- **drizzle builder 是惰性的**：同步事务里必须显式 `.run()`（或 `await`），光 `tx.insert(...).values(...)` 不执行也不报错——静默零写是最阴的 bug，写完必须有行数断言的单测覆盖。
- **原生 sql 查询只用 `db.all(...)[0]`**：`db.get(sql`…`)` 在 bun-sqlite 会话上返回形状不对（实测回 `[0]`），COUNT 查出来是 0——静默误报，同样要单测锁。
- **禁止新的双源漂移**：新增表必须同时落 `ddl.ts`（最新建表）、`schema.ts`（类型）和 `migrations/vNNN-*.ts`（旧库升级），缺一边即视为未完成。
- **`sqliteTable` 第三参数只许返回数组**（Drizzle 0.45）：`(table) => ({ pk: primaryKey(...) })` 命中已废弃的 `SQLiteTableExtraConfig` 对象签名，IDE 会报 deprecated。正确写法是 `(table) => [primaryKey({ columns: [...] }), index('idx_...').on(...)]`。对象键名没有运行时意义；约束/索引名写在 `primaryKey` / `index()` / `uniqueIndex()` 里。全仓库表定义只许在 `apps/gateway/src/infrastructure/db/schema.ts`；无复合主键/索引的表不要硬加第三参数。本条只约束 TypeScript schema，不改 `ddl.ts`。

---

## 2. 错误处理机制与链条规范 (Error Handling & Result Pattern)

### 2.1 强制采用 `Result<T, BusinessError>` 模式
- 在领域模型、工具执行（`Tool.execute`）、适配器调用及数据仓库层，**尽可能避免随意的 `throw new Error()`**，全面采用 Rust 风格的 `Result<T, E>`：
  ```typescript
  import { ok, err, Result, BusinessError } from '@study-studio/shared';

  export async function gradeAnswer(input: Submission): Promise<Result<GradingResult, BusinessError>> {
    if (!isValid(input)) {
      return err(new BusinessError('E_INVALID_INPUT', '提交的内容格式不正确', 'VALIDATION'));
    }
    return ok(computedResult);
  }
  ```

### 2.2 底层错误向业务错误的完整翻译链条 (Error Translation Chain)
- **严禁向客户端与用户暴露原始底层异常**：
  - 禁止向用户抛出形如 `ECONNREFUSED`、`fetch failed`、`Unexpected token < in JSON`、`NullPointerException` 的原始调用栈。
- **统一通过 `translateToBusinessError` 转换**：
  - 所有捕获到的未知/底层异常必须经过 `translateToBusinessError(error, context)` 管道处理；
  - 翻译后的 `BusinessError` 必须包含：
    1. 结构化错误代码 (`code`)；
    2. **对用户友好、具有可读性和安抚性的自然语言解释 (`userMessage`)**；
    3. 错误分类 (`category`: `AGENT_RUNTIME`, `TOOL_EXECUTION`, `VALIDATION`, `NETWORK` 等)；
    4. 是否允许重试标记 (`retryable`)。

### 2.3 类型安全与诊断 hygiene (No `any` / No stray `console`)
- **禁止新增 `as any` / `: any`**（存量已清零，以 grep 为验收口径）：
  - 未知输入一律 `unknown` 优先：`catch (e)` 不写 `: any`；WS / HTTP / JSON / 工具输出等信任边界必须先收窄（`typeof` / `in` / zod `safeParse` / 白名单集合）再使用。
  - `as` 只允许断言为具体结构化类型（对象形状、联合类型），且必须能说清运行时保证；跨信任边界的断言必须配注释说明不断言不放行的理由。
  - DB TEXT 列 → 联合类型必须经校验或白名单收敛，损坏值回退中性默认（读侧永不抛），**永不臆造业务数据**。
  - `exactOptionalPropertyTypes` 下禁止把显式 `undefined` 赋给可选属性，缺省用条件 spread（`...(v ? { k: v } : {})`）。
- **诊断日志统一走 `@study-studio/shared` 的 `logger`**：
  - 业务文件中禁止散落 `console.*`；运维日志（CLI、网关启停、种子自愈、外部进程 stderr）保留并集中。
  - `logger.debug` / `info` 默认静默（生产控制台零刷屏），`warn` / `error` 透出；面向用户的失败只走 `BusinessError.userMessage`（toast / 空状态），不得依赖控制台。

---

## 3. 学习者模型为唯一事实源 (Learner Core as SSOT)

- 用户的掌握度、听力/语法薄弱项雷达、做题记录与错题本生命周期，**由 `packages/learner-core` 独立掌控并持久化于数据库**。
- 绝不把学习者数据保存在外部大模型的 Thread 或会话历史中。换用模型时，所有学习资产必须 100% 完整保留。

---

## 4. 测试与验证标准 (Quality & Testing)

- **单测先行**：`packages/shared`、`packages/protocol`、`packages/learner-core` 等所有核心逻辑必须编写单元测试。
- **统一测试命令（唯一正式门禁 `bun run test:all`）**：
  - 单元+集成测试：`bun run test:all`（仓库根执行；全 workspace，含 PDF native E2E，永不 skip native）
  - 全局严格类型检查：`bun run typecheck`
- 任何提交前，必须确保 `bun run test:all` 零失败，`bun run typecheck` 零报错。
- 不得把裸 `bun test` 宣称为全量门禁：`bun test <filter>` 会绕过 bunfig 的 pathIgnorePatterns
  把 `tsc -b` 的 stale dist 编译副本也跑一遍；`test:all` 显式排除 dist（`--path-ignore-patterns`）。

---

## 5. 硬编码与静态数据登记铁律 (Static Data & Hardcode Tracking Rule)

- **渐进式动态化原则**：当前工程在原型与验证阶段允许存在用于前端交互演示与离线验证的静态数据，但**绝对禁止无声硬编码**。
- **强制登记不变量**：
  - 凡是在任何代码文件（`apps/*`、`packages/*`）中编写或引入了**硬编码数据、静态题库、演示词表、Mock 状态或静态规则**，**必须立即**在隐藏归档文件 `.studio-internal/STATIC-DATA-INVENTORY.md` 中进行登记。
  - 登记内容必须明确标注：
    1. 具体文件路径；
    2. 静态数据或硬编码逻辑的具体内容；
    3. 当前阶段用途；
    4. 未来动态化改造对接方案（如改写为通过 Gateway 异步查询 SQLite 数据库、调用 AI Agent 实时组卷生成等）。
- **后续重构依据**：未来所有“由静态转向真实数据驱动”的工程任务，均严格以此清单作为第一事实源进行逐项改造与闭环验证。

### 5.1 内部设计沉淀文档（实现完成后删除引用）

以下文件位于 **`.studio-internal/`**（已被 `.gitignore`，不进公开仓库），供实现期对照；**对应能力落地并验收后，删除本小节引用，并可归档/删除原文**：

| 文档 | 链接 | 覆盖范围 | 清理条件 |
| :--- | :--- | :--- | :--- |
| 静态/硬编码清单 | [`.studio-internal/STATIC-DATA-INVENTORY.md`](.studio-internal/STATIC-DATA-INVENTORY.md) | Mock 数据登记与动态化改造对照 | 清单表项全部动态化闭环后可精简或删除 |
| AI Native 运行时设计 | [`.studio-internal/AI-NATIVE-RUNTIME-DESIGN.md`](.studio-internal/AI-NATIVE-RUNTIME-DESIGN.md) | 流式对话、参数化工具、ContextSnapshot、导入/批注/入库表、阅读写作新闻双源、双栏可调 UI 等 | D0–D5 里程碑实现并迁入正式 `docs/` 或代码后删除本引用 |

实现 Agent **必须先读上述文档再改相关模块**；不得与 `AGENTS.md` §1 铁律冲突。

---

## 6. 前端现代基建与组件选型铁律 (UI & State Infrastructure Invariants)

### 6.1 杜绝自建简陋玩具轮子 (Zero Hand-Rolled UI Toys)
- **全面对齐现代成熟组件生态**：禁止在业务组件中手写缺乏无障碍（WAI-ARIA）支持的简陋弹窗、原生丑陋 `<select>` 下拉框或生硬的进度条。
- **shadcn/ui (Base UI / Radix) 规范化**：
  - 基础交互组件全面依托 **shadcn/ui** 架构体系（支持并拥抱最新基于 **Base UI** 或 Radix Primitives 的现代化实现）；
  - 核心控件（`Select`、`Dialog`、`Popover`、`Tabs`、`Slider`、`Tooltip`、`Badge`）统一收归在 `apps/web/src/components/ui/`，具备完善的键盘导航、Focus Trap 与自动防滚动击穿。

### 6.2 Magic UI 增强优先原则 (Magic UI First Principle)
- **同根同源与交互升维**：Magic UI 与 shadcn 属于同一技术生态与设计哲学（React + Tailwind + Headless Primitives）。
- **适用场景优先采纳 Magic UI**：凡在涉及学习者仪式感、正向心理反馈（Delight UX）、高质感数据看板与发音纠音视觉呈现的场景，**优先采纳 Magic UI 改造或增强后的组件**（如 `BorderBeam` 流光边框、`BentoGrid` 学情仪表盘、`NumberTicker` 翻牌数字、`AnimatedBeam` 知识图谱连线、`ShimmerButton` 微光按钮等）。

### 6.3 严格区分两类状态架构 (Server State vs Client Persist State)
- **服务端/网关异步状态 (Server State) 归 TanStack Query**：
  - 教材课文树、用户学情画像、熟练度指标、错题本查询与自适应做题评测，统一使用 **TanStack Query (`@tanstack/react-query`)** 的 `useQuery` / `useMutation`；
  - 严格依托 QueryClient 进行缓存控制、后台自动重试与变更失效（`invalidateQueries`），**严禁手写 `useEffect` + `useState(loading)` 自建请求轮子**。
- **客户端偏好与本地状态 (Client State) 归 Zustand + `persist`**：
  - TTS 语音参数（男女声、语速、音色、自定义外挂端点）、主题明暗（Light/Dark）、盲听遮罩开关、假名注音开关、UI 导航状态，以及**阅读双栏宽度比（splitPaneRatio）**等布局偏好，统一使用 **Zustand 并启用 `persist` 中间件**；
  - 彻底杜绝在各个组件中到处分散编写 `localStorage.getItem/setItem` 胶水代码，保证多组件、跨标签页与未来 Tauri 桌面端的响应式自动持久化。

---

## 7. 进程生命周期与端口归属红线 (Process Lifecycle & Port Ownership)

> 背景（2026-09-11 实测定案）：昨日 `bun test` 孤儿进程存活 22 小时仍在烧 CPU；
> Vite 缺 `strictPort` 静默漂移端口；网关零信号处理；前端写死 `:8080` 且无握手。
> 四者叠加的后果就是线上所见：页面绑死僵尸网关、识别永久停在“准备 PDF…”、重启一次漂一个端口。
> 本节每一条都是红线，违反即视为架构违规（验收口径见各条末尾）。

### 7.1 单实例与端口归属 (No Silent Port Drift)
- **禁止静默换端口**：Vite 必须 `strictPort: true`；网关 `Bun.serve` 必须捕获 `EADDRINUSE` 并大声失败（非零退出 + 明确文案，告知占位 PID 与启动时间），**禁止回退到其他端口**。
- “端口被占就往后挪”（代码、脚本、框架默认行为一视同仁）属于**掩盖僵尸进程**的红线行为：漂移的当时爽，绑死的页面随后就去跟僵尸说话。
- 启动 dev 前必须确认旧实例已死：按端口查 PID → 核对命令行与启动时间 → 只杀确认的僵尸，**禁止盲 kill**（验收：`apps/web/vite.config.ts` 有 `strictPort: true`；`start-gateway.ts` 有 EADDRINUSE 分支）。

### 7.2 信号与优雅关闭 (Graceful Shutdown)
- **网关入口必须处理 `SIGTERM` / `SIGINT`**：停止接受新连接 → 关闭监听 → 通知并关闭 WS/SSE 长连接 → 存量 Turn 走已有 signal 检查点停扫 → 超时后退出并留下可观测退出码。
- 当前 dev 进程树深达 4 层（`run dev:web` → `--parallel` → `exec` → `--watch` → child），Windows 下关终端 / Ctrl+C **带不走整棵树**（已实测 orphan）。必须提供一键清理脚本并文档化，禁止要求用户逐个杀进程。
  - 一键清理：`bun run dev:clean`（只读列出 3000-3010 / 8080-8090 监听者：端口/PID/年龄/父存活/命令行）；确认后 `bun run dev:clean -- --kill <pid>`（仅名单 PID + 命令行命中 dev 特征才杀，非 dev 进程拒绝）。
  - 默认启动入口必须是监督器 `bun run dev:web`（`scripts/dev-run.ts`）：启动前核对 3000/8080，脏房间拒绝开工（`--force` 只杀 dev-verified 占位者）；web/gateway 作为其直属子进程，任一退出或收到信号即杀整棵树。禁止绕过监督器直调 `dev:web:parallel` 常驻（保留仅作排障对比）。
- 后台任务（OCR 批、enrich jobs）在关机时必须可中断、可恢复：已有检查点的不得重跑，重复投递必须幂等（验收：grep `SIGTERM` 在网关入口存在；关机路径有单测或集成断言）。

### 7.3 前端必须验证服务端身份 (Server Identity Handshake)
- **禁止写死单端口、无探测、无握手**：Web 启动后必须先调 `/api/health`（响应必须携带 `bootId` + 进程启动时间 + 版本号），关键 Turn 前核对 `bootId`；变化必须显式提示用户刷新/重连，**禁止静默绑僵尸**。
- **所有流式请求必须有首字节超时与 stall 超时**：超时统一转为可读 `BusinessError` 并退出 busy。只靠用户点“取消”等于无容错——本次“准备 PDF…”永久卡死即此缺失的直接后果（验收：`textbooks-annotations.ts` 流式函数含 `AbortSignal.timeout` 或等效首字节计时；grep `timeout` 非零命中）。

### 7.4 Agent 与运行中服务的互斥 (Agent/Dev Mutual Exclusion)
- Agent（含人类工程师）在用户 live dev（`bun --watch` / Vite HMR）运行时**落盘改文件前必须先声明**：watch 重载会掐断用户正在点的请求流，HMR 会重置前端世代守门（`runId` 失配导致迟到结算被丢弃）。能暂停 dev 则暂停；不能暂停则分批小步保存，并在任务报告里写明保存时间窗。
- Agent 自己的常驻命令（`test:all`、大体积 E2E、探针脚本）跑完必须确认进程退出，**禁止留下 detached runner**（本次已抓到一个存活 22 小时、累计 218 秒 CPU 的 `bun test` 孤儿；验收：任务收尾含进程存活检查）。
