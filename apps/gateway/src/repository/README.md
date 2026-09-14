# repository/（旧位置，已清空）

G4 迁移：持久层实现已归位 **infrastructure/**（门面）与 **modules/*/persistence/**（各域 SQL）：

| 新位置 | 内容 |
|---|---|
| `infrastructure/drizzle-learner-repository.ts` | 门面：实现 `learner-core` Repository 契约，向各域 persistence 委托；保持事务边界 |
| `infrastructure/sqlite-learner-repository.ts` | 旧兼容门面（deprecated） |
| `infrastructure/persistence/` | 共享基础：repo-context、repo-utils、language（语种去重待评审，见迁移计划） |
| `@study-studio/storage-sqlite`（M4/D2 起） | schema、连接、迁移、seed（整体迁入，未拆表；前身 `infrastructure/db/`） |
| `modules/practice/persistence/` | practice-plan、practice、questions（题库读写与作答记录） |
| `modules/learning-progress/persistence/` | profile、profile-internals、mistakes、activity-plan、learning-records |
| `modules/review/persistence/` | cards（FSRS 闪卡） |
| `modules/library/persistence/` | documents-annotations |
| `modules/dictionary/persistence/` | dictionary |
| `modules/curriculum/persistence/` | curriculum-content（课程/篇目读写） |
| `modules/curriculum/infrastructure/` | news-rss、news-article-fetch（模块专属外部 IO） |

实现 `packages/learner-core` 定义的 Repository 契约，当前后端为 SQLite（Drizzle），
未来可换 PostgreSQL 而不改业务调用方。同一事务写 attempts/run 与学习进度的边界保持不变。
