# infrastructure/ — 基础设施（非领域）

| 路径 | 作用 |
|---|---|
| `drizzle-learner-repository.ts` | 门面：实现 `learner-core` Repository 契约，向各域 `persistence` 委托；保持 run 完成/统计写回的事务边界 |
| `sqlite-learner-repository.ts` | 旧兼容门面（deprecated），SSOT 为 Drizzle 实现 |
| `persistence/` | 共享基础：`repo-context`（RepoDeps）、`repo-utils`（日期/JSON/种子辅助）、`language`（语种归一；与 `services/learning-language-policy` 的去重待评审） |
| `@study-studio/storage-sqlite`（M4/D2 起，见 `packages/storage-sqlite/README.md`） | SQLite schema、连接、迁移、seed（整体迁入，未拆表；DB 文件位置与 ID 不变） |

约束：`persistence/` 不得反向依赖 `modules/*`；`storage-sqlite` 不得依赖 Gateway/领域模块/Agent/Web；门面是唯一的过渡期委托方。
