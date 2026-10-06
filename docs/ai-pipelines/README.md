# Lingua Studio - AI 原生智能体流水线 (AI Pipelines)

本目录记录 Lingua Studio 中 AI Agent 运行时、提示词工程、专精工具调用与长任务批处理流水线的核心技术规格与架构设计。

---

## 目录索引 (Index)

| 规格文档 | 核心内容 | 关键架构规范 |
| :--- | :--- | :--- |
| [**专用出题实施计划**](./question-generation-plan.md) | 固定工具与数据先行，依次接通运行、学习记录、桌面入口，再开放配置实验。 | 宿主权限与额度、资产持久化、分阶段验收 |
| [**出题开发交接提示词**](./question-generation-handoff-prompt.md) | 给实施智能体的 P0/P1 任务、约束和验证要求。 | 复用现有契约，不改已应用迁移，不扩大本批范围 |
| [**出题运行提示词草案**](./question-generation-runtime-prompt.md) | 产品内专用模型的固定规则与动态配置组装方式，尚待接入验证。 | 提示词不代替后端校验，资料不升级为指令 |
| [**教材原生工具提交**](./tool-calling-vs-json-prompting.md) | 运行时工具注入、会话绑定、独立校验、事务回执和有界重试；已删除文本 JSON 回填。 | AGENTS.md §1.6 原生工具；§1.6b 专精会话白名单与设防 |
| [**教材导入六层模型与拆行架构**](../textbook-import-architecture.md) | 教材全生命周期六大阶段：格式解析、AST 校验、SQLite 拆行（Shredding）、底稿 SSOT 同步、FTS 全文检索。 | AGENTS.md §1.8 静态表结构行表达动态；§1.9 Drizzle ORM 规范 |
| [**智能体运行时与适配器体系**](../agent-runtime.md) | `AgentAdapter`、`AgentSession`、`AgentEvent` 抽象契约与零厂商泄漏隔离（Zero Provider Leak）。 | AGENTS.md §1.1 业务与模型厂商强解耦；§1.2 网关边界 |

---

## 核心设计哲学 (Core Design Principles)

1. **Native Tools First**：学习闭环内的出题、批改、词典、目录提交、知识点回填，必须注册为 Gateway Server Tool，由模型通过原生 `tool_call` 发起；
2. **Context vs Tools 边界刚性**：已知事实走不可变 `ContextSnapshot` 注入，未知与写操作走 Tool，严禁反向向前端重复索要已知事实；
3. **In-Turn Reflection Loop**：工具执行结果必须回填 Agent，业务校验失败触发模型同一 Turn 内自省修复，不打崩整体流水线。
