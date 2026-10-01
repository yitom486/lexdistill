# Database Architecture Map（P0 事实地图）

> 生成方式：逐表对照 `packages/storage-sqlite/src/ddl.ts`（建表 SSOT）、
> `packages/storage-sqlite/src/schema.ts`（drizzle 类型）、`modules/*/persistence/*.ts`（writer/reader），
> 行数为例行线上库（`study-studio.db`）快照。
> 旧事实地图不作为当前教材表规范。v37 的新教材内容表有文档及全局词汇外键，当前完整字段与生命周期见 [教材学习内容表](textbook-learning-tables.md)。
> 详见专题规范：[教材导入架构与数据表设计说明](./textbook-import-architecture.md)。
> 教材组的旧 AST/派生行说明已被 v37 内容表设计替代；其他章节仍是历史事实地图，行数不代表当前数据库快照。

## 0. 分类定义

| classification | 含义 | 删了能重建吗 |
|---|---|---|
| Canonical | 原始事实 / 用户资产，无上游，删了就没 | 否 |
| Event | 不可变行为记录，只增（upsert 状态机除外），是派生的源头 | 否（历史不可再生） |
| Derived | 由 Canonical/Event 计算/聚合而来，有明确上游 | 是 |
| Cache-Index | 可整体丢弃重建的索引/缓存 | 是，随时 |
| Config | 种子/开关/模板，随版本播种，只读或低频改 | 发版重播 |

**重建链**：Canonical/Event →（shred/聚合/索引）→ Derived/Cache-Index。
`textbook_fts`、`local_dictionary_fts` 坏了随时 `DROP+重建`，绝不反向当 truth source。
注意两张 FTS 都是 **contentful FTS5**（自带数据拷贝，非 `content=` 外挂）：textbook_fts 由内容事务手工同步，
local_dictionary_fts 由触发器增量同步（insert/delete，无 update 触发器）+ 启动计数比对重建。

## 1. 教材组（Textbook）

### textbook_import_events —— 导入诊断历史（v035）

- 固定表，按导入事件加行；sequence 自增，索引 `(user_id, trace_id, sequence)`。
- 列保存实际教材/job/目录节点/session/thread/attempt/call 关联、事件类型和时间；详情 JSON 按需读取。目录创建前允许关联身份为空。
- writer：Gateway 导入监视器；reader：桌面通过 Gateway 的任务查询及 SSE。用户和 trace 双重过滤。
- classification：Event；历史交互不能由教材重建。它不是内容 SSOT，不参与教材完成判断；记录失败与教材事务隔离并显示缺失。

### documents —— 教材元信息与章节列表

- 保存教材身份、标题、语种及来源；chapters_json 保存章节列表和系统内部的页码/状态，source_fingerprint 用于文件检测。
- 教材内容直接以七张内容表为事实源，不再保存同一教材的 AST 底稿副本；教材的 ast_json 为空。
- 模型不填写文档/章节身份、页码、内容 ID 或小目录覆盖；Gateway 绑定章节后执行分类内容工具。

### 七张教材学习内容表 —— Canonical

| 表 | 保存的内容 |
| --- | --- |
| global_vocabulary | 同一学习者跨教材的词汇、读音、首次释义和估计等级 |
| textbook_vocabulary | 本章与全局词汇的关联、语境释义、讲解和例句 |
| textbook_knowledge | 语法/发音/用法的标题、说明、接续、AI 补充和例句 |
| textbook_articles | 完整文章或会话及独立译文 |
| textbook_sentences | 独立句子、译文、讲解和可选说话人 |
| textbook_exercise_items | 题型、题干、文字选项、参考答案、解析和评分要点 |
| textbook_materials | 整理后的章节材料，支持查询和写入 |

完整字段、去重规则及工具参数见 [教材学习内容表](textbook-learning-tables.md)。

- 这些内容表是学习资产，不能作为缓存删除。已有内容仅在 v37 前向迁移时转换一次，旧五表随后删除。
- 全局词汇按用户、语种、词形和读音去重；已有词不覆盖。等级是模型估计，未知的旧词不猜等级。用户掌握度仍来自作答和复习记录。
- 删除教材会删除六张章节内容表的对应行；全局词汇继续保留。

### knowledge_points —— 目录挂载蒸馏点（Derived，可悬空原文）
- PK `id`；`lesson_id` 锚目录节点（含章 kind）；`kind ∈ {concept}`（预留 vocab_ref/grammar_ref/rule）；`ord` 课内序
- `concept + explanation_md` 为蒸馏内容；`source_refs_json` 指回原文行 id 数组，**可空＝悬空知识点**（照常可学可考，复习/出题读这里不读原文）
- lifecycle：幂等投影、可重建；写入口收归领域命令（v30 只建表，写入 Tool 未接线）

### textbook_fts —— 全文索引（Cache-Index，contentful）
- FTS5 虚表（**contentful，自带拷贝**，手工同步）；`kind ∈ {vocab, line}`；`ref` 为对应内容的真实 ID
- lifecycle：内容写入同事务重建；坏了可 DROP 重建；rebuildable：是。绝不反向当 truth。

### document_structure —— 目录分类观测（Derived/观测）
- 一文档一行（PK `document_id`）；`headings_json` 输入候选 / `classes_json` 校验后输出 / `model/effort/dropped`
- writer：`saveDocumentStructure`（后跑覆盖先跑）；reader：导入页目录预览
- 目录候选仅为解析观测；已确认的章节列表以 documents.chapters_json 为准。

### document_imports —— 导入任务台账（Event）
- `status ∈ {processing, done, failed}`（非法值读侧回退 processing）；`document_id/lessons/error` 回填
- writer：`createImportTask / updateImportTask`；reader：`GET /imports/:id`
- **缺失**：无 stage/progress（整本 enrich 任务在进程内 Job 注册表，不落库）、无 `source_hash`、无 `parser_version`（P1 事项）

### reading_positions —— 阅读位置（Position，不是进度）
- PK `(user_id, document_id)`；`locator` 不透明 JSON（`{lessonId, offset/page}`，前端组装，**无 `locator_version`**，P1/P2 事项）
- writer：`saveReadingPosition`（upsert）；readers：教材页恢复、focus（最近 10 条）
- classification：Canonical（用户私约状态）/ Position。只回答"看到哪"，不代表完成/掌握。

### annotations —— 划线批注（Canonical 用户资产）
- PK `id`；`document_id/user_id/kind/quote/note/start_offset/end_offset/page_number/created_by/flashcard_id`
- **定位用 offsets + page，没有 locator JSON 列**（locator 统一要改表+阅读器，P2）
- writer：`saveAnnotation`；reader：批注列表、转卡（`flashcard_id` 回填）

## 2. 学习组（Learning）

### learner_language_profiles —— 按语种的学情档案（Canonical）
- PK `(user_id, language)`；目标/等级/连胜/总量。**这是权威，`learner_profiles` 主表是它的镜像**
- writer：`ensureLanguageProfile`（换行不覆盖）/ `updateLearnerProfile` / `recordDailyActivity`（连胜+总量）/ `setTrackLevel`

### learner_profiles —— 主表镜像（Derived）
- PK `user_id`；除 `displayName` 外其余字段是当前轨道行的镜像（`mirrorLanguageProfileToMain`）
- 读画像快照走它，但写权威在语种行。删了可由语种行重建。

### skill_metrics —— 技能掌握度（Derived）
- PK `(user_id, skill_id)`；`proficiency/total/correct/consecutive/status/dimension/language`
- 由每次作答派生（`proficiency=correct/total`，`consecutive>=2 → WEAKNESS`，`>=0.85 → STRENGTH`）；**无 model/算法列**（当前单 heuristic，别无写者）
- writer：`saveSkillMetric`（调用：kana/hangul/reading 记录、quiz 提交、工具）；reader：画像快照、路线证据、定级

### mistakes —— 错题概念聚合（Canonical 可变状态；**不可从 attempts 完整重建**）
- PK `id`；`question_id/question/last_submission/last_grading/retry_count/consecutive_correct/is_resolved`
- 一题一行原地 UPDATE（`retryMistake`/`resolveMistake`），`consecutive>=2` 自动攻克；无删除
- **重建声明**：`retry_count / consecutive_correct` 是顺序相关的复合状态（重试穿插 resolve、手动攻克分支），理论可重放但无重放实现——按**不可重建**处理，误删即丢。事件侧 `quiz_attempts` / `practice_item_attempts` 只证明"发生过"，不保证还原聚合态。
- 事件侧在 `quiz_attempts` / `practice_item_attempts`，mistakes 是聚合概念。两者别混。

### flashcards —— SRS 正式卡（Canonical）
- PK `id`；`type/front/back/phonetic/audio_url/source_entry_id/tags/fsrs/studied_at`
- `studied_at` 只升不降（讲透门）；无删除 API；多入口复用 `saveCard`
- `source_entry_id → local_dictionary_entries.id`（去重）；被 `annotations.flashcard_id`、`card_drafts.flashcard_id` 反指

### card_drafts —— AI 提议草稿箱（Canonical/Staging）
- `status ∈ {pending, accepted, dismissed}`；同 `(user,lang,term_key,source_ref,pending)` 去重；终态不可改，保留行不删
- 链路：`propose → update（记 edited_fields）→ accept（事务建卡+天然讲透）/ dismiss`
- **原则：AI 建议 ≠ canonical，确认才入库**（`document_structure` 同理：观测 ≠ 目录真相）

### quiz_questions —— 题库池（Canonical + 池复用）
- PK `id`；`user_id='default_user'` 为公共池；`tested_skill_id/difficulty/extras_json`（仅 dictation 用 extras）
- writer：`saveQuestion(s)`（生成后持久化）+ 种子；reader：组卷装配（只读池不改池）
- 与 `textbook_exercise_items` 的分工：前者是学习任务中生成的试题；后者是持久化教材章节的习题，包含原书题和明确标记的 AI 补题，生命周期随教材。

### quiz_attempts / practice_item_attempts —— 作答事件（Event）
- 纯追加（attempts 按 `(run,item)` upsert 状态机 `DRAFT→SUBMITTED→GRADED`，批改后原子落 `quiz_attempts`/错题/打卡）
- writer：`recordQuizAttempt`、`submitPracticeItem`、`finalizePracticePlanRun`；readers：带路计数、路线证据、定级聚合
- **事件→派生方向代码里是对的**，勿反向依赖

### lesson_progress —— “技能讲透”打卡（用户触发的完成/解锁状态；表名误导，注意）
- PK `(user_id, skill_id)`；**列是 skill_id 不是 lesson_id**；唯一 writer `completeLesson`（验 `curriculum_lessons` 存在，幂等，有则返回）
- 真实语义：用户点了"学完了"→**解锁出题（讲义锁开门）**，掌握还需做题证据。**不是 append-only Event**（单行幂等、无事件流语义），是用户意图状态。本轮不 rename、不迁移，注释与本文档为准。
- readers：`completedMap`（拼课表完成态）、`collectEvidence.lessonsDone`（只开锁）
- classification：Canonical（用户意图状态，无上游派生）。rebuildable：否。

### unit_progress —— 路线单元达标结论（Derived）
- PK `(user_id, unit_id)`；`status` 恒 `'mastered'`；`evidence_json` 快照
- 唯一 writer `getCourseRoute`（`INSERT OR IGNORE`，达标补记，**永不收回**，stale 只提示复习）
- `unit_id` 指 `COURSE_UNITS` 路线单元（如 `ja-u-vowels`），不是课文 lesson、不是 skill

### study_activity_logs —— 每日打卡聚合（Derived 日聚合）
- 唯一 writer `recordDailyActivity`；一日一语种一行（唯一键）；各域调它累加（quiz/卡片/听力/错题攻克/阅读/假名）
- readers：每日任务、历史、带路计数、计划水合

### daily_study_plans —— 每日计划快照（Derived/Cache）
- 一日一语种冻结一行（`steps_json` + `completed_step_ids`）；信号（到期/薄弱/路线/教材）生成后冻结

### practice_collections / practice_items —— 练习会话快照（Event）
- 一次出题建一集合 + N 条目；只增；转卡不删原条
- `practice_items.passage_document_id` **当前恒 NULL**（预留列，无 writer 写非空——记录在此，勿当外键用）

### practice_plan_templates / practice_plan_runs —— 练习计划配置与执行（Config / Event）
- 模板长期配置（`revision+1`，删模板不影响已冻 runs）；runs 冻结快照（`IN_PROGRESS→COMPLETED` 单向，`finalize` 幂等）

### placement_exams —— 定级考记录（Event）
- 一考一行（`pending→passed/failed` 单向，蓝图开考冻结）；过线调 `setTrackLevel`；通过行仅当日豁免掉级

### curriculum_kana / curriculum_hangul / curriculum_lessons —— 公共课程底座（Config）
- 无 `user_id` 列；冷启动种子，升级覆盖；`curriculum_lessons.id == skill_id`（与 quiz `testedSkillId`、`lesson_progress.skill_id` 同一命名空间）
- 注意与教材章节的区别：**textbook = 内容来源（大家的日语第1课），curriculum = 教学路径（N5 第一阶段）**。AI 以后做"多教材拼一路"就靠这层隔离。

### kana_practice_states —— 假名逐项记忆状态（Derived）
- PK `(user_id, kana_id, script_type)`；每次作答原地更新 FSRS；供自适应队列（与聚合的 skill_metrics 分离）

### learning_content_templates —— 出题/讲解模板库（Config，93 行）
- 冷启动 `INSERT OR IGNORE`；运行只读

## 3. 词典组（Dictionary）

### local_dictionary_entries —— 词典主事实（Canonical，354877 行）
- PK `id`；`language/headword/reading/romanization/meanings_json/pronunciation_json/part_of_speech/source_id/source_label/license_note`
- 来源：种子数百行 + 按需包（OEWN/JMdict-e/Kengdic，包本体不预装，事务替换）；只收录自有或已授权再分发
- 被 `flashcards.source_entry_id`、`search_history.top_entry_id` 引用（逻辑）

### local_dictionary_fts —— 词典全文索引（Cache-Index，contentful）
- FTS5（contentful，自带拷贝）；**触发器增量同步（insert/delete，无 update 触发器）** + 启动计数比对重建；生产唯一读者是释义 `MATCH+bm25`
- 与 textbook_fts 的不对称：词典用触发器、教材由内容事务手工重建——两者都标 Cache-Index，坏了都可重建

### dictionary_sources —— 词典包目录/开关（Config）
- `enabled/priority` 即时影响查词过滤排序；`listDictionaryPackages` 以它判定 installed
- **种子 id 约定（2026-09-09 查明）**：source 行用语言后缀（`…-ja` / `…-ko` / `…-en`），
  但 N5/starter 种子写词条时用了未后缀的 `source_id`（且 starter 缺 `-en` 源行），
  致 172 词条悬空（doctor `dict:entry-source`）。查词 ranking 走 `entry.id` 前缀、未知来源默认放行，
  故查词不受影响，只坏署名/分组。修复只动未来种子路径（P1-A1 Task 4），历史数据等 repair 指令。
  ranking 是否改用 `source_id` 列：否——内存 `LocalDictionaryEntry` 无该字段，改要穿透所有读者，
  且种子 id 根本无冒号前缀（启停开关对种子本就恒放行）；列为 P2 提案，本轮不动。

### dictionary_term_meta —— 声调/词频覆盖层（Derived，124134 行）
- PK `(term, reading, source_id)`；Kanjium 声调 + Yomitan 词频；词条安装时回填 `pronunciation_json`

### encountered_terms —— 相遇词聚合（Derived）
- PK `(user_id, language, term_key)`；`exposure_count/first/last_seen/status/flashcard_id`
- `applyExposure` 幂等 upsert；**同课同天只记一次**（`encountered-terms.ts:402-412`，查 `term_occurrences` 当天 reading 记录去重，单课上限 50 词）

### term_occurrences —— 相遇审计（Event）
- 每次相遇一行，只插不改；与聚合表同事务双写
- 注意：`document_id` 存的是 `docRef = documentId/lessonId` 字符串（`encountered-terms.ts:402`），**不是 `documents.id` 外键**，doctor 不得按 FK 查它

### term_examples —— 例句缓存（Cache-Index）
- `UNIQUE(language, term_key, sentence)`；当前 `source` 只有 `'ai'`；**无 `source_id` 列、无 `user_id`**（公共资产）
- AI 按需生成 + 永久缓存（`INSERT OR IGNORE`，每词最多 2 条）

### dictionary_search_history —— 查词事件（Event）
- 只插 + 单 SQL 修剪（每用户每语种留 200 条，按 `rowid` 判新旧）；冷启动可倒回相遇词

### dictionary_media —— 媒体库索引（Canonical 索引，文件落盘）
- 内容寻址（`file_hash` 去重，`path` 相对根）；`source_id` 可存 `apkg:<deck>` 非 FK 字符串

## 4. 当前教材身份与顺序

教材身份为 documents.id，章节身份与展示顺序在 chapters_json 中由系统保存。标题按教材的实际章节标题展示。章节内容分别有 id 和本章同类 ord；模型只填写内容，不生成这些字段。文章与句子合并生成阅读段时，由系统重新计算连续顺序，避免两类内容各自从零开始导致冲突。
## 5. 已知一致性风险（doctor 覆盖项的依据）

1. **删文档留孤儿（已证实，已修）**：`deleteDocument` 曾只删 annotations + documents 本行。现随删集：六张章节内容表 + `knowledge_points` + FTS + reading_positions + document_structure + annotations（v30 起含知识点）。
2. **lesson_number 展示错位**（见 §4，数据问题非孤儿，doctor 不查，P1 修模型）。
3. ~~**term_map.entry_id 悬空**~~（v30 删除：表已 DROP；词典卸载不再有悬空行可言）。
4. **FTS stale**：textbook_fts 在内容事务中重建；若有人直写行表（运维脚本！）就会 stale。doctor 双向查。
5. **practice_items.passage_document_id 恒 NULL**：预留列，勿当关系用（doctor 跳过 NULL，只查非空悬空）。
6. **`term_occurrences.document_id` 是 docRef 字符串**：doctor 不得误报（规则写死排除）。
7. **skill_id 命名空间**：`curriculum_lessons.id == lesson_progress.skill_id == quiz testedSkillId`，靠字符串相等，无约束。拼错即静默失联，靠单测锁。

## 6. 删除/重建速查

> 首次 doctor 运行（2026-09-09，线上库）：5 errors / 1 warning，见 P1 Ready Report。
> 新增规则先加 `db-doctor.test.ts` 用例，再进 `doctor.ts`。

- 可删重建：`textbook_fts`、`local_dictionary_fts`（+影子表）、`knowledge_points`（由目录+AI 提取重投影）、`skill_metrics`（由 attempts 重算，算法固定时）、`unit_progress`（由证据重算）、`daily_study_plans`（每日重冻）、`term_examples`（调模型重生，慢但可）、`study_activity_logs`（由各域事件重放，工程量大但可能）
- 不可删：`documents`（教材元信息）、七张教材学习内容表、`learner_language_profiles`、`flashcards`、`card_drafts`、`mistakes`（复合状态不可重放，见 §2）、`quiz_attempts`、`practice_item_attempts`、`encountered_terms`（聚合可重算但 first_seen 语义丢失，算半可）、`annotations`、`reading_positions`、`learner_profiles`（可由语种行重建镜像，displayName 除外）

## 7. 系统表

### anki_card_formats —— Anki 卡片模板（Config）
- PK `id`；`entry_type/deck_name/model_name/fields_json/front_template/back_template/css/template_version/user_modified`
- writer：`ensureBuiltinCardFormats`（缺行补，未改旧版跟进；`user_modified=0` 才覆盖升级）、`saveCardFormat`（一律 `user_modified=1`）、`resetCardFormat`（仅内置可恢复）；readers：推送/导出/预览取渲染模板
- lifecycle：内置懒播种，用户改过永不被升级覆盖。classification：Config。rebuildable：是（发版重播，`user_modified=1` 的行除外——那是用户资产）

### anki_settings —— AnkiConnect 推送开关（Config）
- 单行（`id='default'`）；`enabled` 默认关；`endpoint` 仅本机回环收窄；TTS 凭证永不落盘
- writer：`saveAnkiSettings`（不存在 INSERT 存在 UPDATE）；reader：推送前读开关。classification：Config。

### schema_migrations —— 迁移登记（Metadata）
- PK `version`；`(name, applied_at)`。`runMigrations` 按序执行 `migrations/index.ts` 中 `SCHEMA_MIGRATIONS` 缺失项，每条事务包裹。
- 只增不改；v1 为 legacy 基线。classification：Config/Metadata。rebuildable：否（删了会重跑迁移——幂等所以无害，但别手贱）。

## 8. 文档删除生命周期（P0.5 决议，代码见 `deleteDocument`）

| 表 | 删文档时 | 理由 |
|---|---|---|
| 六张章节内容表 | **随删**（同事务） | 内容归属当前教材 |
| global_vocabulary | **保留** | 跨教材复用的个人词汇资产 |
| knowledge_points | **随删**（同事务） | 目录挂载蒸馏点，源文档已删，留即孤儿 |
| textbook_fts | **随删**（同事务） | doc-scoped 索引 |
| document_structure | **随删**（同事务） | 1:1 观测，源没了观测无意义 |
| reading_positions | **随删**（同事务） | 私人游标，文档没了位置无意义 |
| annotations | **随删**（已有） | 用户资产但依附文档存在 |
| document_imports | **保留**（审计） | 任务历史；删了等于销毁"我导过什么"的证据。doctor 置 WARN 不置 FAIL（见 doctor 规则注释） |
| practice_items / quiz_attempts / practice_item_attempts | **保留**（历史） | 作答事件不可删；`passage_document_id` 悬空可接受（展示降级） |
| card_drafts（含 source_ref） | **保留** | 待办用户资产；`source_ref` 是出处文本（`doc/lesson` 或 skill），从不 JOIN documents，删文档不断链 |
| term_occurrences（含 docRef） | **保留** | 审计事件；`document_id` 列存 `doc/lesson` 字符串，doctor 永不按 FK 查 |
| flashcards / mistakes / skill_metrics | **保留** | 跨文档用户资产，与单文档无关 |

未决（需 schema 扩展，不擅自发明，候选记录）：
- document_imports 是否需要 `tombstone` 状态或 `deleted_document_title` 快照列：当前悬空 `document_id` 只能证明"导过删了的书"，标题不可考。候选：加 `document_title_snapshot` 列（P1-C 级别，本轮只记录）。
- `deleteDocument` 是否需要软删除（`deleted_at`）：当前硬删，误删不可回。候选，未决。

## 8. 真实库 migration/backfill/repair 操作顺序（rollout guardrail）
真实 hazard（2026-09-10 实测）：工作区加入 v17 后，遗留 `bun --watch` dev 进程随代码热加载
自动对真库执行了 schema migration（initSchema→runMigrations 常驻启动路径）。本次只加 nullable 列，
无数据事故，但 rollout 顺序错了就是事故。任何真实 SQLite migration/backfill/repair 必须按序：

1. 停止 Gateway 与所有 dev/watch writer（含 `--watch src/index.ts` 这类遗留进程）；
2. 确认端口（:8080 无监听）、进程（无 gateway cwd 的 bun）和 DB mtime 稳定；
3. 创建 SQLite-consistent snapshot（`VACUUM INTO`，不进 git，记录 SHA-256）；
4. `PRAGMA integrity_check` 必须 ok；
5. readonly dry-run（不信旧结果，重跑）；
6. 显式 `--apply`（preflight 有 unresolved 即整体拒绝，不做部分回填）；
7. `db-doctor`（目标 errors=0，已知 audit WARN 可保留）；
8. 再启动服务。

本轮不改 migration runner 行为，不新增 approval flag；顺序即 guardrail。

## 9. 内容身份

新内容 ID 由系统在当前教材和章节作用域内生成；重复调用不会重复入库。迁移保留可用的唯一 ID；旧模型在不同章节重复生成的 ID 由系统重新分配，确保每条内容仍独立保存。全文索引引用实际内容 ID，不再依赖旧的章节/序号拼接引用。
