# Database Architecture Map（P0 事实地图）

> 生成方式：逐表对照 `packages/storage-sqlite/src/ddl.ts`（建表 SSOT）、
> `packages/storage-sqlite/src/schema.ts`（drizzle 类型）、`modules/*/persistence/*.ts`（writer/reader），
> 行数为例行线上库（`study-studio.db`）快照。
> 原则：**无 FOREIGN KEY**（全库 0 条约束），关系靠列名约定 + 应用层保证。
> 详见专题规范：[教材导入架构与数据表设计说明](./textbook-import-architecture.md)。
> 教材组已按 2026-09-30 批准的章节流水线更新；其他章节保留原事实地图口径。

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
注意两张 FTS 都是 **contentful FTS5**（自带数据拷贝，非 `content=` 外挂）：textbook_fts 由 shred 手工全量同步，
local_dictionary_fts 由触发器增量同步（insert/delete，无 update 触发器）+ 启动计数比对重建。

## 1. 教材组（Textbook）

### documents —— 一书一行，系统统一资源 ID
- PK `id`；归属 `user_id` + `source_kind`；当前教材从用户导入建立，不再补种旧教材。
- 底稿 `ast_json`（完整 TextbookAST，SSOT），保存已确认目录、文件指纹和模型整理的规范章节内容；`content` 是摘要，不是正文事实源。
- 描述：`title/language/topic/difficulty/source_url/source_publisher/exam_tag`
- writer：JSON 导入使用文档保存入口；PDF 流水线由 `toc-skeleton` 建底稿、`commitLessonKnowledge` 逐章事务更新。reader：教材读取、导入检测。
- lifecycle：建目录底稿 → 每章提交更新 AST 并同事务 shred → 全部课次实际 ready。删除/级联策略见 §5，不能从阶段进度推断内容已保存。
- classification：Canonical。source of truth：是（教材底稿）。rebuildable：否。

### textbook_lessons —— 课目录（Derived 查询面）
- PK `(document_id, lesson_id)`；`lesson_id` 是已确认目录的任务身份，不能从标题猜测；`lesson_number` 为课号，查询按 `sort_order`（最终 AST 数组位置）排序。
- `kind/parent_id/start_page/end_page` 保存目录层级和物理页范围；`status` 表示提取状态。
- v034：`content_json` 保存规范章节投影，`submission_id` 保存实际已提交尝试身份；`passage_md` 是整理后正文的文本投影，不能用它逆向猜角色。
- 来源：`documents.ast_json` 同事务全删全插；writer：`shredIntoTransaction`；reader：教材页、组卷、逐课导入检测。
- lifecycle：随 shred 重建；rebuildable：是（由 ast_json）。source of truth：否（真相在 ast_json）

### textbook_lines / textbook_vocab / textbook_grammar / textbook_exercises —— 行/词/文法/习题（Derived 查询面）
- PK `(document_id, lesson_id, ord)`；`ord` 为课内序号（0-based dense，但**代码不强制连续**，只靠 shred 全量重写保证）
- 来源：一律由 `documents.ast_json`（Canonical SSOT）同事务拆出；原书整理内容与 AI 补充内容都在规范底稿内，OCR 原文不作为正式正文落库。
- vocab 列：`surface/reading/pos/gloss_zh/pitch/example_ja/example_zh`
- grammar 列：`title/connection/explanation/examples_json`（v16，`[{japanese,chinese}]` 全量）
- v034：各类行新增 `source/toc_id/field_sources_json`；正文另有 `block_id/kind`，文法另有 `ai_explanation`，原书与 AI 讲解分别存储。
- exercises：七种题型，`answer_json/content_json` 保存选项 ID、排序或匹配答案和完整题目；`answer` 是查询用文本投影。新增 AI 习题不要求目录含练习项，但不能替代原书目录覆盖。
- vocab/grammar 查询行按 `ord` 定位；完整内容 ID、例句和来源保留在规范章节与 AST。派生时不截断长词或正文。
- lifecycle：随 shred 重建；rebuildable：是

### textbook_term_map —— 已退役（v30 `knowledge-points`，表已 DROP）
- v30 前它是教材词→词典标准条目的桥（best-effort，`entry_id` 可空）；退役原因：无用户面读者
- 映射计数职能由 shred 内存统计（`mappedEntries/unmapped`，同课同 kind 同面只计首条）延续，去重口径不变
- 后继：目录挂载蒸馏点见 `knowledge_points`（下）；词典精确匹配仍由 shred `findEntry` 在内存执行

### knowledge_points —— 目录挂载蒸馏点（Derived，可悬空原文）
- PK `id`；`lesson_id` 锚目录节点（含章 kind）；`kind ∈ {concept}`（预留 vocab_ref/grammar_ref/rule）；`ord` 课内序
- `concept + explanation_md` 为蒸馏内容；`source_refs_json` 指回原文行 id 数组，**可空＝悬空知识点**（照常可学可考，复习/出题读这里不读原文）
- lifecycle：幂等投影、可重建；写入口收归领域命令（v30 只建表，写入 Tool 未接线）

### textbook_fts —— 全文索引（Cache-Index，contentful）
- FTS5 虚表（**contentful，自带拷贝**，手工同步）；`kind ∈ {vocab, line}`；`ref = {lesson}#v{ord} / #d{ord}`
- lifecycle：shred 同事务重建；坏了可 DROP 重建；rebuildable：是。绝不反向当 truth。

### document_structure —— 目录分类观测（Derived/观测）
- 一文档一行（PK `document_id`）；`headings_json` 输入候选 / `classes_json` 校验后输出 / `model/effort/dropped`
- writer：`saveDocumentStructure`（后跑覆盖先跑）；reader：导入页目录预览
- **与 textbook_lessons 的关系**：observation vs canonical。目录真相以 lessons 为准，structure 只是 parser 中间结果。两者课数不一致时信 lessons。

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
- 与 `textbook_exercises` 的分工：前者是学习任务中生成的试题；后者是持久化教材章节的习题，包含原书题和明确标记的 AI 补题，生命周期随教材底稿。

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
- 注意与 `textbook_lessons` 的区别：**textbook = 内容来源（大家的日语第1课），curriculum = 教学路径（N5 第一阶段）**。AI 以后做"多教材拼一路"就靠这层隔离。

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
- 与 textbook_fts 的不对称：词典用触发器、教材用 shred 手工重建——两者都标 Cache-Index，坏了都可重建

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

## 4. lesson_number 调查结论（Task 4）

事实（线上 177 行 + 代码）：
- parser（`markdown-to-ast.ts:284`）：`lessonNumber: si + 1`——**切课顺序计数器**，与书无关
- shred：透传（非法回退 `stats.lessons + 1`，同样是计数器）
- UI：`TextbookCurriculum.tsx:413` 显示 `Lesson {n}`，`ListeningShadowingWorkbench.tsx:313` 显示`第 {n} 课`；课表按 AST 数组序渲染，**无排序**
- 线上实况：
  - 主书：復習A/B 占 n=24/25，**第11課 显示为 Lesson 26**（展示错误，真实存在）
  - 旧书：n=17/19 缺失（当年 TOC 串课掉的课，gap 是历史残留）；同一文档 57 课含两套"第1課"序列（接力追加跨书连号，n=25 起是第二本书）
  - 前言/CIP/出版说明被当成课（n=2–15 是杂页），`pdf-mtpsy4se` 更把"学生/会社员/練習A/問題"全当成课（18 课里一半是垃圾粒度）
- 回答：
  - lesson_number 当前 = **sort order + display number 二合一**，不是稳定 identity（identity 是 lesson_id）
  - 非数字 lesson 存法：硬塞连续整数，信息（"这是复习/附录/杂页"）**只留在 title 里**，结构化丢失
  - 排序错误风险：无（数组序即展示序，稳定但"稳定地错"）
  - 展示错误风险：**有，线上正在发生**（第11課→Lesson 26）
- P1 候选（本轮不动）：`lesson_id`（稳定身份，保持）+ `sort_order`（物理序，保持导入序）+ `lesson_label`（展示串，如"第11課"/"復習A"，parser 填，缺失回退 `第{n}課`）
- P1-B 落定（v17，已实施）：只加 `sort_order`，**不加 `lesson_label`**（raw title 已在 AST/DB；归一是廉价纯函数；持久化只增同步债）。
  `lesson_number` 正式定为 legacy compatibility；relay 保持 `maxNo+1`（Gate 0：不得改长度续排）；
  展示走 Gateway `displayTitle`（focus 计算）→ learner-core 只消费；`第11課→Lesson 26` 类文本已在 daily-plan 消除（UI 组件 debt 另记）。

## 5. 已知一致性风险（doctor 覆盖项的依据）

1. **删文档留孤儿（已证实，已修）**：`deleteDocument` 曾只删 annotations + documents 本行。现随删集：shred 五表 + `knowledge_points` + FTS + reading_positions + document_structure + annotations（v30 起含知识点）。
2. **lesson_number 展示错位**（见 §4，数据问题非孤儿，doctor 不查，P1 修模型）。
3. ~~**term_map.entry_id 悬空**~~（v30 删除：表已 DROP；词典卸载不再有悬空行可言）。
4. **FTS stale**：textbook_fts 只在 shred 重建；若有人直写行表（运维脚本！）就会 stale。doctor 双向查。
5. **practice_items.passage_document_id 恒 NULL**：预留列，勿当关系用（doctor 跳过 NULL，只查非空悬空）。
6. **`term_occurrences.document_id` 是 docRef 字符串**：doctor 不得误报（规则写死排除）。
7. **skill_id 命名空间**：`curriculum_lessons.id == lesson_progress.skill_id == quiz testedSkillId`，靠字符串相等，无约束。拼错即静默失联，靠单测锁。

## 6. 删除/重建速查

> 首次 doctor 运行（2026-09-09，线上库）：5 errors / 1 warning，见 P1 Ready Report。
> 新增规则先加 `db-doctor.test.ts` 用例，再进 `doctor.ts`。

- 可删重建：`textbook_fts`、`local_dictionary_fts`（+影子表）、`textbook_lines/vocab/grammar/exercises/lessons`（由 ast_json 经 shred）、`knowledge_points`（由目录+AI 提取重投影）、`skill_metrics`（由 attempts 重算，算法固定时）、`unit_progress`（由证据重算）、`daily_study_plans`（每日重冻）、`term_examples`（调模型重生，慢但可）、`study_activity_logs`（由各域事件重放，工程量大但可能）
- 不可删：`documents`（底稿）、`learner_language_profiles`、`flashcards`、`card_drafts`、`mistakes`（复合状态不可重放，见 §2）、`quiz_attempts`、`practice_item_attempts`、`encountered_terms`（聚合可重算但 first_seen 语义丢失，算半可）、`annotations`、`reading_positions`、`learner_profiles`（可由语种行重建镜像，displayName 除外）

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
| textbook_lessons / lines / vocab / grammar / exercises | **随删**（同事务） | doc-scoped Derived，源 AST 已删，留即孤儿 |
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

## 9. Identity scope 结论（P1-C2-A / P1-D0 决议，不改 schema）

### Durable identity：lesson.id
- 当前作为 durable lesson reference 使用（`reading_positions.locator.lessonId`、
  `sourceRef/docRef` 的 lesson 段、quiz/enrich 请求）。
- positional 生成是已知债（P1-C 系列跟踪），但引用关系本身以 opaque 字符串成立；
  reconciliation（shadow-ready）是未来的对齐手段，不是本轮改动。

### Generation-local identity：vocab.id / grammar.id
- 形如 `${lessonId}-v/g${kept序号}`，只在同一次 parse+enrich generation 内有效；
- re-enrich / 列表顺序变化即整体重编（实测，见 `vocab-grammar-identity.test.ts`）；
- **禁止未来 durable consumer 未经重新设计直接依赖这些 id**（它们跨代必变）。
- v30 起 term_map 表已退役，映射计数只在 shred 内存统计；目录挂载蒸馏点见 knowledge_points。

### Projection locator（同代定位，不跨代）
- textbook vocab/grammar 当前定位方式：
  `document + lesson + kind + ord/ref`（`ref = lesson#v{ord}/#d{ord}`），
  仅在同一 canonical generation 内有效，由 shred 同事务全量重建保证一致。
- exercise.id 无生成器（种子手写或 null），不纳入 identity 体系。
