# `@study-studio/storage-sqlite` — SQLite 适配层（M4）

> D2 起家于 `apps/gateway/src/infrastructure/db/`（机械搬迁，SQL 与逻辑逐字节不变）。
> Gateway 保留数据库生命周期拥有（选库/装配/启停/health），本包只提供连接工厂与数据层实现。

# `db/` — Gateway 的 SQLite 基础设施

本目录负责 Gateway 的 SQLite 持久化底座：定义表结构、执行版本化迁移、提供 Drizzle 类型映射、在冷启动时补齐系统课程资产，以及为历史数据库提供只读诊断和受控修复工具。

它不承载具体业务流程。学习、词典、教材等模块应通过各自的 Repository / Service 使用这里创建的数据库实例，而不是在业务代码中随意拼接 SQL。

## 启动链路

`createDrizzleDb()` 是正常入口，调用顺序如下：

```text
createDrizzleDb(path | Database)
  ├─ 打开 bun:sqlite Database，并尝试启用 WAL 与 foreign_keys
  ├─ initSchema(sqlite)       // 建立基础表、运行版本化迁移、确保词典 FTS
  ├─ seedInitialData(sqlite)  // 幂等写入或补齐系统种子资产
  └─ drizzle(sqlite, schema)  // 返回带类型的 Drizzle 客户端
```

`':memory:'` 是默认值，主要便于单元测试；生产环境应传入实际 SQLite 文件路径或已打开的 `Database`。

## 目录文件

| 文件 | 职责 | 主要导出 / 使用说明 |
|---|---|---|
| `ddl.ts` | **最新库的完整建表 SSOT + 迁移调度**。`initSchema` 用静态 `CREATE TABLE` 一次建成最新结构；`runMigrations` 按 `schema_migrations` 只执行未应用版本；`ensureDictionaryFts` 确保词典 FTS。 | 新增表或列时必须同时改本文件的 CREATE、`schema.ts`，并在 `migrations/` 追加新版本。 |
| `migrations/` | **已发布的逐步升级 SQL**（v2 起；v1 为 legacy-baseline）。一文件一条，由 `index.ts` 汇总。 | 禁止改已发布文件的 version/name/sql。详见 `migrations/README.md`。 |
| `schema.ts` | Drizzle 的表与列类型定义。字段、默认值和表名必须与 `ddl.ts` 一字对应。 | 导出 `learnerProfiles`、`flashcards`、`documents`、`textbook*`、`localDictionaryEntries` 等所有 `sqliteTable` 定义，供 Repository 用 Drizzle builder 做类型安全 CRUD。它不负责建表。 |
| `index.ts` | 本包唯一公共出口（白名单制）与数据库实例工厂。 | `createDrizzleDb()` 创建 SQLite + Drizzle 实例并完成初始化/补种；`DrizzleDb`、`DrizzleInstance` 描述返回类型；同时 re-export schema、常用种子、`initSchema` 和 `seedInitialData`。连接工厂实现见 `connection.ts`。 |
| `seed-bootstrap.ts` | 把 `seeds/` 中的静态课程资产写进 SQLite 的唯一启动编排器。 | `seedInitialData(sqlite)`：以“空库首次写入”或 `INSERT OR IGNORE`“旧库增量补齐”的策略导入资产；`pitchMeaningToGlosses()`：把声调词表的“中文 (English)”标签转为通用词典使用的英文 gloss。课程资产可随版本更新，用户学习资产不可被它覆盖。 |
| `canonical-fingerprint.ts` | 确定性的 canonical JSON 与 SHA-256 指纹工具。 | `canonicalJson()` 会递归排序对象键、保留数组顺序；`fingerprintCanonical()` 用于判断种子教材的派生投影是否仍新鲜。调用方不得将时间戳、临时 id 等易变字段纳入输入。 |
| `lesson-ordering.ts` | 教材 shred 表中课次排序的专项校验与回填。`documents.ast_json` 是唯一事实源。 | `planLessonOrdering(db)` 只读比较 AST 中 lesson 顺序与 `textbook_lessons`；`applyLessonOrdering(db, plan)` 仅在计划完全可解析时写回 `sort_order`；`verifyDense()` 检查序号是否连续；`formatOrderingPlan()` 供 CLI/日志展示。遇到不一致不会猜测。 |
| `doctor.ts` | 数据完整性体检，设计为只读。 | `runDoctor(db)` 检查预期表覆盖、文档衍生表孤儿、词典来源、导入审计等不变量，返回结构化 `DoctorReport`；`formatDoctorReport()` 输出可读报告。适合先于任何修复操作执行。 |
| `repair-plan.ts` | 历史数据修复的 **dry-run** 规划器，不写库。 | `buildRepairPlan(db)` 找出可安全删除的衍生孤儿、需人工决定的导入记录、错误的种子 source id、可重建的教材 shred 候选；`formatRepairPlan()` 生成文本计划。 |
| `repair-apply.ts` | 与 `repair-plan.ts` 对应的受限写入操作。 | `applyOrphanCleanup(db)` 只清理 `REPAIR_ALLOWLIST` 中、父 `documents` 已不存在的衍生行，并以事务执行；`applySeedSourceFix(db)` 只修复种子词条白名单中的 source id；两个格式化函数用于报告。白名单外的数据仅报告、不自动删除。 |
| `README.md` | 本文件：目录边界、启动顺序、种子资产和维护约定。 | 修改数据库结构或增加种子时，应同步更新本说明。 |

### 表模型速览

- 学习者资产：`learner_profiles` / `learner_language_profiles`、`skill_metrics`、`flashcards`、`quiz_attempts`、`mistakes`、学习计划及其运行记录。
- 公共课程资产：`curriculum_kana`、`curriculum_hangul`、`curriculum_lessons`、`learning_content_templates`、词典种子。
- 文档与教材：`documents.ast_json` 是教材原稿 SSOT；`textbook_lessons`（v30 起 kind/parent_id 支撑章层级）、`textbook_lines`、`textbook_vocab`、`textbook_grammar`、`textbook_exercises` 是由原稿拆出的查询层；`knowledge_points` 是目录挂载的蒸馏知识点（v30，可悬空原文）；相关 FTS 表用于全文检索。`seed_materialization` 只记录内置教材的派生状态（指纹与 materializer 版本），不保存用户文档。
- 导入审计：`document_imports` 记录单文档导入；`toc_import_sessions` 与 `toc_import_chunks` 记录整书目录导入的冻结计划、分块执行状态与最终目标文档。会话拥有 `document_id`；chunk 的历史 `document_id` 列必须保持 `NULL`，不能作为所有权来源。
- 用户学习痕迹：批注、阅读位置、导入任务、卡片、做题和错题记录都按用户与语种保存，不能用种子覆盖。

## `seeds/` — 静态课程资产来源

种子是仓库内可审计的静态数据来源；运行时不动态建表。`seedInitialData()` 将它们导入固定表，通常按“表为空时初始化”或“按稳定 id 增量补齐”执行。新增或调整静态内容时，还必须按仓库规则登记 `.studio-internal/STATIC-DATA-INVENTORY.md`。

| 文件 | 内容与落库位置 | 主要导出 / 作用 |
|---|---|---|
| `kana-seed.ts` | 日语清音、浊音、半浊音、拗音等权威假名课程资产，包含行列、罗马字、助记、发音文本和学习引导。写入 `curriculum_kana`。 | `KANA_SEEDS` 是最终种子数组；内部 `example()` 统一例词形状，`buildKanaLearningGuide()` 从单个假名构建学习引导。前者用于五十音工作室和出题约束，后者避免每条重复手写讲解结构。 |
| `hangul-seed.ts` | 韩语谚文的子音、基本/复合母音和收音代表音等课程资产。写入 `curriculum_hangul`。 | `HANGUL_SEEDS`：含字母、名称、修正罗马字、位置、助记与 TTS 文本，供 Hangul Studio 查询和练习。 |
| `lesson-seed.ts` | “先讲后测”的日语语法讲义，如 `で/に`、目的地 `に`、`か`、`の`、`から`、自我介绍和 `たら`。写入 `curriculum_lessons`。 | `LESSON_SEEDS`；`LessonSeed`、`LessonSectionSeed`、`LessonExampleSeed` 描述讲义的章节、例句、易错点、最低等级和排序。Bootstrap 使用 UPSERT 覆盖公共讲义的版本更新。 |
| `content-template-seed.ts` | `learning.content` 的离线内容模板库：三语选择、填空、讲解、例句、听写、阅读和写作等结构化内容。写入 `learning_content_templates`。 | `LEARNING_CONTENT_TEMPLATE_SEEDS` 是工具无模型或降级时的内容 SSOT；`ContentTemplateAction` 限定可执行动作；`ContentTemplateSeed` 定义语种、题型、技能、难度和 JSON `payload`。工具读取表，不应在工具实现里堆硬编码题干。 |
| `reading-seed.ts` | AI 生成与新闻形态的示例阅读篇目及配套题目，覆盖 JA / EN / KO。写入 `documents`，题目保存在该文档的 `ast_json`。 | `INITIAL_READING_SEEDS: ReadingPassageSet[]`。首次写入全部篇目；旧库按稳定 id 补新篇目（例如后来增加的韩语篇）。它是冷启动离线阅读资产，不替代真实新闻抓取或用户导入。 |
| `learning-seed.ts` | 冷启动学习体验用的初始闪卡、题目、错题和画像指标，按 JA / EN / KO 分组。分别写入 `flashcards`、`quiz_questions`、`mistakes`、`skill_metrics`。 | `INITIAL_CARD_SEEDS`、`INITIAL_EN_CARD_SEEDS`、`INITIAL_*_QUESTION_SEEDS`、`INITIAL_MISTAKE_SEEDS`、`INITIAL_SKILL_METRIC_SEEDS`；相关 `*Seed` 接口定义每类数据形状。当前错题和技能指标数组可为空，表示不人为伪造用户学习历史。 |
| `starter-words-seed.ts` | 日、韩、英各 24 个开箱基础词，使用项目自撰中文释义。写入 `local_dictionary_entries`。 | `STARTER_WORD_SEEDS` 及 `STARTER_SOURCE_ID`、标签、许可常量；`StarterWordSeed` 定义词条字段。它让未安装外部词典的用户也可查词和练习。 |
| `n5-words-seed.ts` | 日语 N5 核心 100 词（汉字表记、标准读音、自撰释义），与 starter 包和外部词典并存。写入 `local_dictionary_entries`。 | `N5_WORD_SEEDS` 与独立 source/许可常量。独立来源可追溯、可开关，不能误与 starter 包混为一个 source。 |
| `seed-sources.ts` | 种子词典来源的共享契约，不是内容本身。写入/维护 `dictionary_sources`，并确保词条 `source_id` 正确关联。 | `seedSourceRowId(base, language)` 统一来源行 id；`seedSourceSpecs()` 返回四个来源规格；`ensureSeedDictionarySources()` 幂等创建来源行；`seedEntrySourceMap()` 供修复程序取得“词条 id → 正确来源”的白名单映射。 |
| `pitch-seed.ts` | 项目自有的日语声调最小对立词与教学提示；同时会作为普通本地词典条目导入。 | `PITCH_LEXICON`；`extractPitchQueryTokens()` 抽取查询词；`lookupPitchEntries()` 查匹配条目；`formatPitchLexiconCoachReply()` 组织讲解文本；`tryPitchLexiconCoachReply()` 在用户请求可由本地词表回答时返回回复，否则返回 `null`。不抓取或写入 OJAD 内容。 |

## `seedInitialData()` 实际做什么

该函数每次通过 `createDrizzleDb()` 打开数据库时运行，因此必须保持幂等。当前顺序为：

1. 将旧的 `learner_profiles` 语种信息补镜像到 `learner_language_profiles`（只补不存在的语种行）。
2. 初始化或更新五十音学习引导；空库初始化谚文表。
3. 初始化/补齐阅读文档。
4. 当对应语种卡池或题池为空时，写入冷启动闪卡和题目；错题、技能指标仅在种子数组非空且目标表为空时写入。
5. 用 `INSERT OR IGNORE` 补齐 `learning_content_templates`，因此不会覆盖已有模板记录。
6. 将项目自有声调词、starter 词包、N5 词包写入本地词典，并先确保对应 `dictionary_sources` 存在。
7. 用 UPSERT 更新公共语法讲义；讲义是可版本化的课程资产，不是用户内容。

每个种子分段都有独立错误隔离：某一类资产写入失败会记录启动日志，但不阻止其他种子和数据库实例创建。业务代码不应通过重复调用 seed 来“修复”用户数据；应先运行 `doctor` / `repair-plan`，再执行范围受控的 `repair-apply`。

### 教材内容来源

教材只通过用户显式导入创建；启动时不补入教材示例。旧教材补种、物化门控、旧 AST 迁移及对应状态脚本已删除。当前 PDF 检测仅按文件 SHA-256 匹配，并查询真实保存的逐课资产。

## 维护约定

- 新表或新列：同时修改 `ddl.ts`（最新 CREATE）、`schema.ts` 与 `migrations/vNNN-*.ts`；迁移必须登记为可重放版本，不能在导入某本教材时临时 `CREATE TABLE`。
- 当前已发布迁移到 v30；新增迁移必须在 `migrations/index.ts` 末尾登记。已发布迁移的 version、name 与 SQL 都不可改写。
- 教材：始终先更新 `documents.ast_json`（原稿），再在同一事务重建 `textbook_*`；不要直接手改 shred 表使其与 AST 分叉。
- 整书目录导入：准备阶段只能写不可变 session / chunk 计划；首个成功 chunk 在同一事务创建并绑定 session 的目标文档。删除目标文档后，将 session 置为 `target_deleted` 并保留审计行，不恢复或复用它。
- 种子：使用稳定 id，明确是“首次初始化”“增量补齐”还是“公共资产可覆盖更新”；不得覆盖用户卡片、练习历史、错题或学习画像。
- 诊断与修复：先执行只读 `runDoctor()` / `buildRepairPlan()`，再有针对性地调用 apply 函数。`applyOrphanCleanup()` 只可删除白名单中的派生孤儿。
- SQL：普通 CRUD 优先 Drizzle；仅 DDL/迁移、FTS `MATCH` 查询和已验证的大批量热点使用原生 SQL，并在代码旁说明原因。

---

## 依赖策略（D3 叶子规则，2026-09-14 修订）

- 基座：`shared`、`protocol`、`document-model`、`drizzle-orm`（外加 `bun:sqlite` / `node:` 运行时）。
- 例外：允许依赖经白名单明确列出的**纯叶子领域包**（定义：仅依赖 shared、
  无存储/网络/Agent、无厂商 SDK，且禁反向依赖本包——由该包自身的相对内聚测试锁定）。
  当前许可其二：`flashcards`（adapter 持久化的正是其语义：Anki 端点常量与校验、
  内置模板种子与模板校验、模板类型；实测其依赖仅 shared，无循环可能）；
  `content`（**仅文档种类纯表面**：`DOCUMENT_SOURCE_KINDS` 值＋`DocumentSourceKind`
  类型，供 import-tasks 校验落库值；禁引 content 其他符号，由边界测试符号级锁定）；
  `learner-core`（course-route 的 `resolveCourseRoute` 值＋两类型；
  kana-practice-state 仅 `import type` 三类型；禁其他，符号级测试分别锁定）；
  `learning`（practice-plan 的 validate/freeze/parse 三纯函数；禁其他，
  符号级测试锁定）。四者均无存储/网络/Agent、无反向依赖（各包内聚测试为证）。
- 禁止：Gateway、ports、编排、上层、Agent、Web。新增叶子依赖必须同步更新
  10 号卡＋本 README＋边界测试三处，缺一视为未完成。

---

## 附：`migrations/` 维护约（随包搬迁，原文合并）

本目录是 **已发布** 的 SQLite 升级步骤。`ddl.ts` 的 `initSchema()` 仍负责新库一次建成最新结构；本目录负责把**旧库**一步步升到同一版本。`runMigrations()` 从包入口 `index.ts` 的 `SCHEMA_MIGRATIONS` 调度。

| 位置 | 职责 |
| --- | --- |
| `ddl.ts` `initSchema()` | 最新完整 `CREATE TABLE IF NOT EXISTS`（新安装） |
| `schema.ts` | Drizzle 类型，必须与最新 CREATE 对齐 |
| `migrations/vNNN-*.ts` | 从旧版升到新版的逐步 SQL |
| `schema_migrations` 表 | 某个用户库已经执行到哪个 version |
| `runMigrations()`（`ddl.ts`） | 按 version 只跑尚未登记的条目；v4/v5 登记修复留在调度器里 |

v1 没有文件：空库跑完 legacy DDL 后，`runMigrations` 写入 `legacy-baseline`。本目录从 **v2** 起。

规则（必须遵守）：只向前（禁改已发布 `version` / `name` / `sql`，修问题加更高 version）；三处对齐（`initSchema` CREATE ＋ `schema.ts` ＋ 本目录新文件）；新文件命名 `vNNN-short-name.ts` 并追加到 `SCHEMA_MIGRATIONS` **末尾**；version 连续递增，下一条是 **v23**；一条迁移一个事务；不在迁移里猜用户数据；不要自动回滚用户库。

当前副本已从历史 `ddl.ts` 内联数组复刻 **v2–v22**，运行时改由本目录调度。

---

## 搬迁注记（M4/D2，文档 truth 订正）

- 本包由 `apps/gateway/src/infrastructure/db/` 机械搬迁而来，SQL 与逻辑逐字节不变；
  `connection.ts` 为原 `db/index.ts` 的工厂部分分拆，其余文件原样平移。
- 订正两处过期文档（SQL 未动）：本 README“已发布迁移到 v20”→ v22；
  migrations 约“下一条是 v19”→ v23、“复刻 v2–v18”→ v2–v22。
- 原 `db/README.md`（含工作区 owner 未提交的 98 行版本）已 verbatim 并入本文件上半部分。
