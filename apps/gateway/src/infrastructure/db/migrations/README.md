# Schema migrations

本目录是 **已发布** 的 SQLite 升级步骤。`ddl.ts` 的 `initSchema()` 仍负责新库一次建成最新结构；本目录负责把**旧库**一步步升到同一版本。`runMigrations()` 从 `index.ts` 的 `SCHEMA_MIGRATIONS` 调度。

## 职责

| 位置 | 职责 |
| --- | --- |
| `ddl.ts` `initSchema()` | 最新完整 `CREATE TABLE IF NOT EXISTS`（新安装） |
| `schema.ts` | Drizzle 类型，必须与最新 CREATE 对齐 |
| `migrations/vNNN-*.ts` | 从旧版升到新版的逐步 SQL |
| `schema_migrations` 表 | 某个用户库已经执行到哪个 version |
| `runMigrations()`（`ddl.ts`） | 按 version 只跑尚未登记的条目；v4/v5 登记修复留在调度器里 |

v1 没有文件：空库跑完 legacy DDL 后，`runMigrations` 写入 `legacy-baseline`。本目录从 **v2** 起。

## 规则（必须遵守）

1. **只向前**：禁止删除或改写已发布文件的 `version` / `name` / `sql`。修问题就加更高 version。
2. **三处对齐**：加列/加表时同时改 `initSchema` CREATE、`schema.ts`、以及本目录新文件。
3. **登记**：新文件命名 `vNNN-short-name.ts`（NNN 与 `version` 一致，`name` 为 kebab-case），并追加到 `index.ts` 的 `SCHEMA_MIGRATIONS` **末尾**。
4. **version 连续递增**，不得跳号、不得复用。下一条是 **v19**。
5. **一条迁移一个事务**：由 `runMigrations` 包裹；SQL 必须可在目标旧形状上成功执行。
6. **不在迁移里猜用户数据**（例如不要 `sort_order = lesson_number`）；只改结构，回填走专门的 apply。
7. **不要自动回滚**用户库；版本控制可以回退代码，已升级的数据库用前向迁移修复。

## 当前副本

已从历史 `ddl.ts` 内联数组复刻 **v2–v18**，运行时已改由本目录调度。
