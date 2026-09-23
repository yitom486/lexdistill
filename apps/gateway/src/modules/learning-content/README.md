# modules/learning-content — 学习内容生成领域

本模块拥有基于课程模板的内容生成能力，包括练习题、语法讲解、例句、假名/谚文专项内容、阅读短文和写作题干。Agent 使用的 `learning.content` Tool 实现在本模块，不属于协议传输层。

| 路径 | 作用 |
|---|---|
| `public.ts` | 对其他领域公开 Tool 输入输出类型、Tool 构造器和练习块输入合成函数。跨模块消费通过此文件。 |
| `ports.ts` | 声明内容模板查询所需的窄仓储契约。 |
| `tools/learning-content-tool.ts` | `learning.content` Tool 的参数 Schema、动作分发和输出类型。 |
| `tools/learning-content/` | 各内容动作的实现及模板选择、收集等内部辅助逻辑。 |

`modules/practice/application/practice-assembly.ts` 只通过 `public.ts` type-only 消费内容输入输出契约；Gateway 的 Tool Registry 仍由 `transport/tools/register-tools.ts` 负责装配，注册顺序保持原样。

内容生成面向模板库读取；练习收集仍通过现有仓储能力写入练习集合。新增内容动作时，应留在本模块并复用公开的结构化契约，不要把实现放回 `transport/`。
