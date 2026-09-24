# modules/learning-content — 学习内容生成领域

本模块拥有基于课程模板的内容生成能力，包括练习题、语法讲解、例句、假名/谚文专项内容、阅读短文和写作题干。内容命令可由 Agent Tool 或其他客户端入口复用。

| 路径 | 作用 |
|---|---|
| `contracts.ts` | 内容命令的参数 Schema、输入输出与上下文契约。 |
| `ports.ts` | 内容模板查询、课程、词典抽样与练习收集所需的仓储能力契约。 |
| `application/execute-learning-content.ts` | 内容动作分发与业务错误翻译。 |
| `application/actions/` | 各内容动作、模板选择与练习收集。 |
| `tools/learning-content-tool.ts` | learning.content Agent Tool 适配器，只声明工具元数据并调用领域命令。 |
| `public.ts` | 跨领域使用的公开入口。 |

Gateway 的 Tool Registry 由 transport/tools/register-tools.ts 装配。内容动作不得依赖具体数据库类；仓储通过能力契约注入。
