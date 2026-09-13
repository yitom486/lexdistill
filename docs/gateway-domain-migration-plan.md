# Gateway 领域模块化迁移计划

> 状态：提议 / 待逐阶段实施；本文件不代表迁移已完成。
> 日期：2026-09-05。
> 范围：`apps/gateway/src` 及必要的 import、测试、启动配置和文档引用调整。
> 依据：`AGENTS.md`、`docs/architecture.md`，以及当前 Gateway 源码与内部运行时设计。

## 1. 决策与适用边界

推荐把 Gateway 从以技术职责为主的顶层目录（`services`、`tools`、`repository`）逐步改为 **领域模块优先、公共基础设施保留的模块化单体**。

这不是“功能组织一定不好，DDD 一定更好”。当前代码已经有领域服务和 `repository/domains`，不是从零开始。目标是让一次练习、词典或学习记录的变更尽量落在同一模块，并明确调用方向和数据归属。

扩展性来自稳定契约、单一业务写入入口和可测试的模块边界，而不是目录名：

- 不引入微服务、消息总线、DI 框架、事件溯源或完整 CQRS。
- 不为每张表、每个页面、每个 Tool 建一个领域。
- 不强制每个模块都有 `entities/aggregates/repositories/services` 等空目录。
- `packages/learner-core` 仍拥有纯学习领域规则和 Repository 契约；Gateway 负责应用编排和基础设施实现，不复制一套核心模型。
- 保留 HTTP + WebSocket 唯一客户端屏障、原生 ToolRegistry/ToolRouter，以及 Adapter 隔离；不借迁移引入 MCP 中转。

### 是否主要是移动文件？

**第一阶段可以以文件移动和 import 调整为主；整个迁移不能只有移动。**

| 变更类型 | 内容 | 原则 |
| --- | --- | --- |
| M：机械迁移 | 独立服务、Tool、测试归组；修正路径与引用 | 不改算法、接口、错误码或事务语义 |
| E：结构提取 | 从 `index.ts` 提取路由/启动；从运行时提取装配；拆混合职责文件 | 需要改代码，但保持可观察行为不变 |
| B：业务调整 | 修正判题、授权、幂等、重试等行为问题 | 独立任务与验收，不夹带在搬迁中 |

不能预先承诺整个工程改动的某个比例只是移动；尤其入口和跨领域仓储不是独立文件，必须提取实现。

## 2. 当前源码事实

| 位置 | 已确认现状 | 迁移含义 |
| --- | --- | --- |
| `src/index.ts` | 同时创建 Repository/Gateway 实例、注册 Hono 路由、导出 `GatewayAppType`、实现 `Bun.serve` 与 `/ws`；约 1,700 行 | 应拆启动、依赖装配和 HTTP 应用，不只是改文件名 |
| `src/server.ts` | 定义 `GatewayServer`；注册 Tools、构造 Adapter、管理会话/流式事件并编排业务 | 实际是运行时协调器，不是独立监听端口入口 |
| `src/repository/domains/*` | 已按 profile、practice、dictionary 等拆分 SQL 实现；由 `DrizzleLearnerRepository` 门面委托 | 复用既有拆分；SQL 文件不等于纯领域模型 |
| `src/services/practice-assembly.ts` | 依赖具体 Drizzle Repository 和 `learning-content-tool` 输入输出类型 | 移动后仍需将应用能力与 Tool 适配契约解耦 |
| `src/tools/learning-plan-tool.ts` | 同时处理今日计划、练习模板/运行查询和计划建议 | 是跨模块入口，不能简单归入其中一域并形成反向依赖 |
| `src/tools/learning-content-tool.ts` | 覆盖出题、讲解、例句、假名、阅读、写作等 action | 保留外部 Tool 契约，内部逐步委托应用能力 |
| `src/services/learning-language-policy.ts` | 混合语种规范化、阅读 prompt 和教练文案 | 不能未经拆分就作为万能 shared 模块 |

现有 `src/README.md` 把 `server.ts` 描述为监听入口并注明 8999，与当前代码不符：启动在 `index.ts`，默认端口为 8080，受 `GATEWAY_PORT` 覆盖。实施时同步纠正文档，不以 README 的旧描述安排迁移。

本计划基于包含未提交改动的工作区；例如新加入的 `practice-grading.ts` 也在清单内。正式执行前重新核对，不覆盖正在进行的判题和前端重构。

## 3. 目标模块命名与数据归属

目录使用 kebab-case；类和导出符号在机械迁移阶段保持原名。HTTP URL 与 Tool name 不随内部目录改名。

| 模块 | 职责与资产 | 明确不负责 |
| --- | --- | --- |
| `practice` | 练习模板、运行、练习集合/题目/attempt、装配、提交、完成、建议与复盘 | 不拥有 FSRS、学情画像算法或外部引擎协议 |
| `learning-progress` | 学习画像、技能指标、每日计划、活动记录、错题生命周期、学习分析编排 | 不拥有练习模板与运行；今日计划只消费运行进度 |
| `review` | 用户闪卡、卡片复习命令和记录写入；调用 learner-core 的 FSRS | 不复制调度算法，不拥有公共词典资产 |
| `library` | 用户文档、批注、文档切片、资料入库与批注转卡编排 | 不拥有闪卡调度规则 |
| `curriculum` | 公共课程、假名、内容模板、阅读篇目与配题、新闻采集和内容生成 | 不直接拥有用户长期学习进度 |
| `dictionary` | 公共词典包安装/检索、来源链接，以及用户词条收藏记录 | 公共包与用户收藏必须区分归属；转卡通过 review 能力 |

以上是当前代码规模下的模块边界，不声称已经证明为彼此独立的 DDD 限界上下文。阅读/新闻先作为 curriculum 内部子能力，不提前拆独立包。

### 目标目录（按需落地，不一次创建空壳）

```text
apps/gateway/src/
  index.ts                         # 启动兼容入口和既有公开导出
  bootstrap/
    config.ts                      # 环境配置及稳定资源路径
    create-gateway.ts              # Repo、Adapter、应用能力、Tools 的装配根
    start-gateway.ts               # Bun.serve 与启动/关闭生命周期
  transport/
    http/
      create-app.ts                # Hono 路由组合与 GatewayAppType
      http-error-handler.ts
      health-routes.ts
      agent-routes.ts              # 现有 Agent 管理 HTTP 外壳
    websocket/
      websocket-handler.ts        # 升级后的协议收发，调用 runtime
    tools/
      learning-plan-tool.ts       # 跨领域兼容 Tool 入口
      learning-content-tool.ts
      ui-command-tools.ts
      register-tools.ts
  runtime/
    gateway-runtime.ts             # 原 GatewayServer；先保留类名
    session-manager.ts
    context-builder.ts
    agent-router.ts
    tool-router.ts
    responses-lite-coach.ts
    turn-summary-builder.ts
  modules/
    practice/
    learning-progress/
    review/
    library/
    curriculum/
    dictionary/
  infrastructure/
    db/                            # schema、连接、迁移、seed：先整体保留
    persistence/
      drizzle-learner-repository.ts # 过渡/兼容门面与共享事务基础
      sqlite-learner-repository.ts
      repo-context.ts
      repo-utils.ts
  shared/
    language.ts                    # 仅经审查的纯语种值/规范化，不塞业务文案
  scripts/
    import-oewn.ts
  __tests__/                       # 跨领域/HTTP/WS/启动集成测试
```

模块内部按需要使用 `application/`、`http/`、`tools/`、`persistence/`、`__tests__/` 和 `public.ts`；不是每个模块都必须拥有每一层。`public.ts` 仅显式导出跨模块能力与类型，不导出 SQL 内部实现。

`runtime` 是通用 Agent 运行时协调，不是新的学习领域；`transport` 是协议适配，不持有权威学习规则。厂商 Adapter 继续位于现有 `packages/agent-*`。

## 4. 文件迁移清单

下列来源均相对 `apps/gateway/src`；目标亦同。M/E 含义见 §1。

### 4.1 现有服务

| 来源 | 目标 | 类型/说明 |
| --- | --- | --- |
| `services/practice-assembly.ts` | `modules/practice/application/practice-assembly.ts` | M，后续 E 解耦 Tool DTO 与具体仓储 |
| `services/practice-grading.ts` | `modules/practice/application/practice-grading.ts` | M；纯规则是否应下沉 learner-core 单独评审，不在搬迁时复制 |
| `services/practice-proposal.ts` | `modules/practice/application/practice-proposal.ts` | M；保留令牌 TTL、一次性消费和确认边界 |
| `services/practice-summary.ts` | `modules/practice/application/practice-summary.ts` | M；保留只读与 AI/local 来源语义 |
| `services/learning-analysis.ts` | `modules/learning-progress/application/learning-analysis.ts` | M；经 `public.ts` 提供分析快照 |
| `services/dictionary-packages.ts` | `modules/dictionary/application/dictionary-packages.ts` | M；目前仍含 DB 访问，后续提取 persistence，不伪称纯领域服务 |
| `services/dictionary-external-links.ts` | `modules/dictionary/application/dictionary-external-links.ts` | M |
| `services/generate-news-passage.ts` | `modules/curriculum/application/generate-news-passage.ts` | M |
| `services/news-reading.ts` | `modules/curriculum/application/news-reading.ts` | M |
| `services/news-rss.ts`、`services/news-article-fetch.ts` | `modules/curriculum/infrastructure/` 下同名文件 | M；外部采集是模块专属 IO |
| `services/responses-lite-coach.ts`、`services/turn-summary-builder.ts` | `runtime/` 下同名文件 | M；保留 seed 引用，后续单独评估动态化 |
| `services/learning-language-policy.ts` | 过渡保留；最终拆为 `shared/language.ts`、`modules/curriculum/application/reading-language-policy.ts`、`runtime/coach-language-policy.ts` | E；语种规范化与仓储 `language.ts` 对照测试后再去重，不盲目合并 |

### 4.2 Tools

| 来源 | 目标 | 说明 |
| --- | --- | --- |
| `tools/learning-practice-tool.ts` | `modules/practice/tools/learning-practice-tool.ts` | 保留现有工具契约 |
| `tools/learning-assess-tool.ts`、`tools/grade-subjective-quiz.ts` | `modules/practice/tools/` 下同名文件 | 评测算法逐步委托应用能力，静态规则不得无声变化 |
| `tools/generate-adaptive-quiz.ts` | `modules/practice/tools/generate-adaptive-quiz.ts` | 自适应选择消费学情快照；内容生成通过 curriculum 能力 |
| `tools/learning-progress-tool.ts` | `modules/learning-progress/tools/learning-progress-tool.ts` | 进度/错题等写入复用同一命令 |
| `tools/learning-library-tool.ts` | `modules/library/tools/learning-library-tool.ts` | 新闻话题读取通过 curriculum 公共能力或已有 protocol 契约 |
| `tools/learning-curriculum-tool.ts` | `modules/curriculum/tools/learning-curriculum-tool.ts` | 公共课程访问 |
| `tools/dictionary-lookup-tool.ts` | `modules/dictionary/tools/dictionary-lookup-tool.ts` | 词典读取 |
| `tools/learning-plan-tool.ts`、`tools/learning-content-tool.ts`、`tools/ui-command-tools.ts` | `transport/tools/` 下同名文件 | 先 M，后 E；跨域入口只委托，不成为新的超级业务类 |
| `server.ts` 中的 Tool 注册代码 | `transport/tools/register-tools.ts` | E；由 bootstrap 注入依赖，不在 Tool 内创建第二个 DB |

`learning.plan` 的今日计划动作委托 learning-progress，模板/运行/建议动作委托 practice。`learning.content` 的各 action 委托内容生成与练习入库能力；迁移期间不改变公开 name/schema/权限/location。

### 4.3 Repository 与数据库

**仓储实现是基础设施，不因为旧目录叫 domains 就搬入纯 domain 层。**

| 来源 `repository/domains/` | 最终归属 | 策略 |
| --- | --- | --- |
| `practice-plan.ts`、`practice.ts` | `modules/practice/persistence/` | M；保持 run 完成与统计写回的事务边界 |
| `dictionary.ts` | `modules/dictionary/persistence/` | M |
| `documents-annotations.ts` | `modules/library/persistence/` | M；转卡仍在共享事务中完成 |
| `profile.ts`、`profile-internals.ts`、`mistakes.ts`、`activity-plan.ts` | `modules/learning-progress/persistence/` | M；activity-plan 暂不再细拆 |
| `cards-questions.ts` | `modules/review/persistence/cards.ts` + `modules/practice/persistence/questions.ts` | E；先保持原位置，按函数和事务依赖拆分 |
| `curriculum-reading.ts` | 课程/篇目读写归 `modules/curriculum/persistence/`；学习记录调用归 learning-progress 应用能力 | E；不按文件名一刀切 |
| `language.ts` | 最终 `shared/language.ts` 的候选来源 | E；先比较现有规范化语义 |
| `repo-context.ts`、`repo-utils.ts` | `infrastructure/persistence/` | M；seed/业务默认值不能继续作为无限扩大的 utils |

`repository/drizzle-learner-repository.ts` 与 `sqlite-learner-repository.ts` 最终移入 infrastructure，保留现有契约和兼容导出。第一轮不删除门面、不改表、不改 ID、不改 DB 文件位置，不把每域拆成独立数据库连接。

`db/` 整体移入 `infrastructure/db/`，先不拆 schema/seeds。迁移 seed 与包含静态规则的文件时，同步更新 `.studio-internal/STATIC-DATA-INVENTORY.md` 的路径登记；本计划本身不引入代码静态数据。

### 4.4 HTTP、运行时、脚本与测试

- `index.ts` 中 `/api/practice/*` → `modules/practice/http/practice-routes.ts`。
- 学情/活动/每日计划/错题/分析 → `modules/learning-progress/http/learning-progress-routes.ts`。
- 卡片与 review → `modules/review/http/review-routes.ts`；题库 → practice。按现有 URL 逐项核对，不借机改 URL。
- 文档/批注 → `modules/library/http/library-routes.ts`。
- 课程/阅读/新闻 → `modules/curriculum/http/curriculum-routes.ts`。
- 词典/安装/收藏 → `modules/dictionary/http/dictionary-routes.ts`。
- `/api/learning/*` 等兼容跨域入口 → `transport/http/learning-routes.ts`，再委托应用能力。
- 健康检查与 Agent 管理接口 → transport/http；现有 provider-specific URL 暂保持兼容，其进一步抽象单列任务。
- `context/context-builder.ts`、`session/session-manager.ts`、`router/*.ts` → runtime 下同名文件。
- `server.ts` → `runtime/gateway-runtime.ts`，第一步保留 `GatewayServer` 名称及旧路径 re-export；不同时重写运行时。
- `errors/http-error-handler.ts` → `transport/http/http-error-handler.ts`。
- `scripts/import-oewn.ts` 暂不移动，保持 package script 稳定；只更新依赖和资源路径。
- 单模块测试随模块归组；`gateway.test.ts`、`gateway-websocket.test.ts`、`agent-streaming.test.ts`、仓储门面及跨领域事务测试保留根 `__tests__`。Agent 路由/会话/汇总测试可移入 `runtime/__tests__`。
- 例如 practice 系列测试归 practice；dictionary-packages/oewn/pitch 依实际覆盖归 dictionary 或 curriculum；阅读/news/kana 归 curriculum；learning-analysis 归 learning-progress。不能仅靠文件名前缀自动搬迁。

## 5. 依赖方向与跨领域用例

目标依赖方向：

```text
bootstrap → transport / runtime / 模块应用能力 / infrastructure
HTTP、Tool、WS → 应用能力（WS 经 runtime 调度）
应用能力 → learner-core / protocol / 窄 Repository 与能力接口
persistence 实现 → DB + 核心契约
模块调用其他模块 → 对方 public.ts 暴露的能力或注入接口
```

约束：

1. 模块不得反向 import `index.ts`、bootstrap 或 `GatewayServer` 单例；需要能力时由装配根注入。
2. 应用层不得依赖 Tool 类才能出题/批改；Tool 和 HTTP 应是同一用例的两个入口。
3. 提取窄依赖可先使用 `Pick<LearnerRepository, ...>`；缺失的必要领域契约再补入 learner-core，不一次性重设计整个接口。
4. persistence 的共享 SQL 辅助必须显式依赖；过渡期已有跨域 SQL import 登记为例外，不直接宣称全部边界合规。
5. 多模块写入必须沿用同一个事务上下文。引入模块门面不能把原子事务变成多次独立提交。
6. 跨模块循环通过组合层协调消除，不靠万能 shared 或动态 import 隐藏。

重点用例：

| 用例 | 应用编排归属 | 协作 |
| --- | --- | --- |
| 开始/装配练习 | practice | 注入 curriculum 内容能力、review 卡片读取、学情快照 |
| 完成练习与统计 | practice 发起 | 同一事务写 attempts/run 与学习进度；保留幂等 |
| 每日计划展示运行进度 | learning-progress | 由组合层注入运行进度读取，避免与 practice 双向深层 import |
| 批注/词条/练习题转卡 | 来源模块发起 | 调用 review 建卡能力，保留去重与用户/语种隔离 |
| Agent 批改后入库 | practice | Agent 经 agent-runtime 抽象；HTTP/Tool 复用同一应用命令 |

## 6. 分阶段执行与验收门槛

每个阶段单独可审查、可回退；每批记录旧路径、新路径、调用点、兼容导出、验证结果和未解决依赖。执行者不得默认提交 Git 或覆盖用户未提交代码。

### G0：冻结基线与建立清单

- [ ] 重新检查工作区，将正在进行的功能修复与迁移区分。
- [ ] 枚举 HTTP 的 method/path、WS event、Tool name/schema/权限、公开导出及其调用方。
- [ ] 记录启动脚本、端口、环境变量、DB/词典资源路径和测试基线。
- [ ] `bun test`、`bun run typecheck`；若已有失败，明确记录，不能声明迁移验收通过。
- [ ] 标记本文件哪些目标是 M、哪些仍需 E，不一键批量搬迁混合职责文件。

### G1：practice 服务试点（先验证目录方案）

- [ ] 移动独立 practice 服务和对应单模块测试；调整所有静态/动态 import 与库存路径。
- [ ] 其他领域、仓储门面和入口暂保留。
- [ ] 验证装配去重、阅读篇目关联、听写语料、权威判题、提案确认和复盘行为不变。
- [ ] 不在这一步重写判题算法或修复其他行为问题。

### G2：提取启动与按域 HTTP 路由

- [ ] 建立 `createGateway` 和 `createApp(deps)`；生产只创建一套依赖，测试可显式注入。
- [ ] 将 practice 路由先提取，再逐域拆其他路由。
- [ ] 分离 Bun HTTP/WS 启动与应用构建；明确会话、DB 和 Adapter 关闭责任。
- [ ] 保留旧入口和公开类型兼容；不让 `create-app.ts` 因 import 而打开真实 DB。
- [ ] 验证所有旧 URL、状态码、错误信封与 Hono RPC 类型保持一致。

### G3：其余服务与 Tools 归组

- [ ] 按 §4 迁移 dictionary、curriculum、library、learning-progress 和 runtime 文件。
- [ ] 抽出 Tool 注册；保留 native dynamic tools、审批、取消、事件顺序和工具结果回填。
- [ ] 拆出跨入口共用的应用能力与输入输出类型，消除 application → Tool 的依赖。
- [ ] 公共入口使用显式导出；不添加无用层和全量 barrel。

### G4：持久层按域归属（风险最高，晚于路由试点）

- [ ] 独立 SQL 文件先移动，再拆 cards-questions、curriculum-reading 等混合文件。
- [ ] 保持 DrizzleLearnerRepository 门面、数据库 schema、迁移历史和事务行为。
- [ ] 验证用户/语种隔离、转卡去重、运行完成幂等、统计只写一次及中途失败回滚。
- [ ] DB 根路径配置由 bootstrap 注入；不得因目录加深而创建新数据库造成“数据丢失”假象。

### G5：清理与长期边界验证

- [ ] 用依赖扫描或小型测试禁止模块导入启动入口、循环依赖和未批准的跨模块内部路径。
- [ ] 更新 docs、各目录 README、静态数据库存、脚本和 import 消费方。
- [ ] 旧路径 re-export 仅在确认内部及已知包消费者迁完后删除；不留两份业务实现。
- [ ] 全局 `bun test` 零失败，`bun run typecheck` 零报错。
- [ ] 人工验收 Web/Tauri 经 Gateway 的开始练习、作答、保存草稿、恢复、完成复盘，以及原生 Agent Tool 流。

## 7. 易遗漏的兼容性风险

### Hono RPC 类型

`GatewayAppType` 当前由链式 Hono app 推断，Web 消费它。提取路由时保留链式 `.route(...)` 的类型累积，不能把工厂返回值标成宽泛 `Hono` 而丢失 endpoint 类型。继续从兼容入口导出类型，并以全局 typecheck 验证 Web 调用端，不用 `any` 绕过。

### 路径、入口与副作用

- 移动 `index.ts` 中基于 `import.meta.dir` 的 DB 路径逻辑时，保持解析后的实际路径相同。
- 检查 `new URL(..., import.meta.url)`、动态 import、seed/词典文件路径、构建配置和测试相对路径。
- `@study-studio/gateway` 的 `main` 当前指向 `src/index.ts`，start/dev 也使用它；保持兼容后再单独决定是否更换入口。
- 兼容导出不得再次创建 Repo/Adapter 或重复监听；同进程只装配一次生产实例。

### 状态与事务

- 词典安装中的任务 Map、提案令牌缓存、会话 Map、事件订阅不能在路由提取后变成每请求新建或多个不相通实例。
- 保留时间语义、默认语种、排序、限额、fallback 标记和缓存 TTL；这些不是可以顺手清理的细节。
- HTTP 路由迁移不要夹带授权或 CORS 行为变化；发现问题另建行为修复任务。
- 依赖窄接口后，不能用“非 Drizzle 就新建内存库”作为长期替代方案；装配根显式提供课程、词典等能力。相关现存 fallback 的变更应单独测试。

### 回退

迁移不做数据库结构变更，使回退只涉及路径、装配与 import。每批范围保持足够小，可单独逆向移动/恢复结构；遇到失败先定位，不对有用户改动的工作区执行全量 reset。若必须变更 schema，另立数据库迁移计划，不纳入本次机械迁移。

## 8. 完成定义

只有满足以下条件，才能称为领域模块化完成，而不是目录整理完成：

1. `index.ts` 不再集中业务路由与用例；runtime 不再独占业务入口。
2. 新增领域能力主要在所属模块内完成，HTTP/Tool 可复用同一应用命令。
3. 模块公开边界、跨域协作和共享事务清晰，没有第二套学习状态事实源。
4. 现有客户端契约、原生 Adapter 能力、持久化资产和启动行为保持兼容。
5. 自动化测试、类型检查、边界检查和关键人工验收都有实际通过记录。

当前仅完成规划。建议下一步只启动 G0 与 G1，不一次迁移所有领域，也不同时重写 GatewayServer 和 Repository。
