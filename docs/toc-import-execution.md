# TOC 整书导入执行契约（session / chunk / 幂等）

> 长期维护文档。实现：
> - 表：`toc_import_sessions` / `toc_import_chunks`（`schema.ts` + `ddl.ts` + `migrations/v019`）；
> - 持久化：`apps/gateway/src/modules/library/persistence/toc-import-sessions.ts`；
> - 服务：`application/pdf-import/toc-import-prepare.ts`，端点 `POST /api/documents/:userId/prepare-toc-import`；
> - doctor 规则：`toc-import:*`（`packages/storage-sqlite/src/doctor.ts` §8b）。
>
> 标签含义：**Verified fact**（代码/实测支撑）/ **设计决策**（本轮选定，改需更新本文）/
> **Unresolved risk**（已知未解，不得据此自动决策）。

## 0. 一句话

- **D2A（本轮）只准备 session**：探页数 → 重跑 preview → 指纹核验 → 全绿 gate →
  单事务写入 session + 全 prepared chunk。不建 document，不调 converter/shred。
- **D2B 才能 claim/execute 一个 chunk**；每次执行前必须重验 chunkFingerprint；
  成功后才可原子更新 chunk 状态与教材 projection（D2B 实现，本文只定 gate）。

## 1. 为什么不能复用 `document_imports`（Verified fact + 设计决策）

`document_imports` 现状（`schema.ts:557`，`persistence/import-tasks.ts`）：

- 一行 = 一次单文件导入尝试 → 至多一个 `document_id`，无多课/多 chunk 表达；
- 无 `request_key` / 指纹 / 计划列；`id` 每次随机生成，重试即新行
  （“调用方重发同一输入即可”就是它的重跑语义）；
- 状态只有 processing/done/failed，没有 prepared/running；
- 删除生命周期把它定为**审计保留**（删文档不删任务行），语义与“可恢复的执行计划”相反。

设计决策：新建两张静态表（固定表名、行表达动态，符合 AGENTS.md §1.8），
`document_imports` 原样保留、互不干扰。

## 2. 数据模型（Verified fact：以 `schema.ts` / `ddl.ts` / v019+v020 为准）

`toc_import_sessions`：`id`（`tocimport_*`，服务端生成）、`user_id`、
`request_key`（§3）、`plan_fingerprint`、`pdf_sha256`、`page_count`、
`lesson_count`、`chunk_count`、`status`（prepared/running/completed/failed/cancelled/
`target_deleted`）、`doc_title`（展示）、`document_id`（v20，session 层 target，可空）、
`error`、`created_at/updated_at`；
`UNIQUE(user_id, request_key)`。

`toc_import_chunks`：`session_id`、`ordinal`（0-based 执行序）、`lesson_index`、
`lesson_title`（展示）、`physical_start/end`、`chunk_fingerprint`（§3）、
`status`（prepared/running/completed/failed）、`document_id`（**已废弃**，
invariant 恒 NULL，所有权只在 session 层，doctor 规则锁）、
`attempts`、`error`；主键 `(session_id, ordinal)` 即“同 session/ordinal 唯一”。

- one session → one document：`document_id` 只在 session 层；
  绑定唯一入口 `bindTocImportSessionDocument`（已绑定/终态/跨用户全拒绝）；
  chunk 永不拥有独立 document。
- 计划 immutable：本模块**不提供** entries/anchors 更新路径；
  改计划只能产生新 `request_key` → 新 session（设计决策）。
- 状态封闭枚举：TS 联合 + 读侧收窄（非法值回退 `prepared`，读侧永不抛）+
  doctor `toc-import:status` FAIL 规则锁。不加 FK（无 FK 架构，见 doctor §8b 注释）。
- 删除语义（D2A.1）：删 target document **同事务**置关联 session `target_deleted`
  （`document_id` 快照保留审计，永不再 resume；计划行不删）；
  删不相关 document 不影响任何 session；归属校验先行，无越权清理洞。
  用户放弃未完成 session 的显式取消接口归 D2B（`cancelled` 已预留）；
  孤儿 chunk（session 缺失）即数据异常，由 doctor 报 FAIL。

## 3. 幂等协议（Verified fact：单测锁定）

- `request_key = sha256({v:1, user, pdf: pdfSha256, plan: planFingerprint})`，
  服务端重算（`computeTocRequestKey`，纯函数）。覆盖 user + 当前 PDF + canonical plan，
  满足“至少覆盖”要求；换 PDF / entries / anchors / 顺序任一 → key 变化 → 不能复用。
- `chunkFingerprint = sha256({v:1, session: request_key, ordinal, lesson, from, to})`
  （`fingerprintTocChunk`，纯函数），D2B 执行前重验同一函数。
- 同 user + 同 key 重试 → 同一 session（`reused: true`），零新行（单测：行数不变、
  sessionId 一致、chunks 逐行一致）。
- 并发/近并发：UNIQUE 约束为底线；冲突走“查到即复用”（查到 + 计划一致才返回，
  不一致报 INTERNAL 不猜；查不到才抛源错）。单测以“预置同 key 行 + 直接双插约束”
  覆盖该路径（bun 单线程无法真并发，约束本身即证据）。
- 客户端指纹（preview 返回）与重算不一致 → `E_TOC_PLAN_STALE`，零 DB 写。

## 4. Prepare 语义（Verified fact）

端点只接受：PDF + confirmed entries + confirmed anchors + preview fingerprint + docTitle。
服务端：`[1]` 探页数 → 重跑 P5-A preview → 指纹核验 →
`unresolved=0`、`lessonsWithoutEnd=0`、非空计划、逐 chunk ≤30 页 →
单事务建 session + chunks。失败（stale/validation/任一 gate）零 session 零 chunk。
不调 OCR/Agent/render/convert/append/saveCanonicalAst/shred；不建 document
（单测：documents/textbook_lessons 行数不变）。

## 5. Session 生命周期（设计决策，D2B 落实；删除终态 D2A.1 已实现）

- `prepared`：D2A 终点；可被同 key 重试复用；可被用户放弃（D2B 取消接口 → `cancelled`）。
- `running`：D2B 成功 claim 第一个 chunk 后置位；执行中进程崩溃即停留 running，
  重试同 key 返回 session，D2B 按 chunk 状态续跑（prepared 重跑、completed 跳过）。
- `completed`：全部 chunk completed 后置位（D2B 原子更新）。
- `failed`：chunk 不可恢复失败或执行器异常时置位（D2B），`error` 记原因；
  用户改计划重提即新 session，旧 failed 行保留审计。
- `target_deleted`（D2A.1）：target document 被删时同事务置位，
  `document_id` 快照保留、`error` 记因，**永不再 resume**；
  doctor 对其豁免 orphan 检查（审计保留≠悬空）。
- 重试语义只有一种：**同 request_key 重发**（返回同一 session）；改任何输入即新 session，
  不存在“覆盖旧计划”操作。
- D2B 使用 target 的两步法（本轮已备好地基，执行归 D2B）：
  首个成功 chunk 在**同一事务**创建 document → 绑定 session（唯一入口，
  同 session 绑定第 2 个 document 直接拒绝）→ 写 AST/shred → 完成 chunk；
  后续 chunk 只更新**同一个** session target document（取 session.document_id，
  不接受客户端传 document）。

## 6. D2B 精确执行 gate（首 chunk 已实现并锁定）

端点 `POST /api/documents/:userId/toc-import-sessions/:sessionId/execute-first`
（实现 `toc-import-execute.ts` + 持久化 `commitTocFirstChunk`）：

1. 按 id 读 session 并验 owner（不存在/他人一律 `E_NOT_FOUND`，零写）；
2. 幂等快道：chunk0 已 completed 即读档返回（不探页数、不 convert、不 save）；
   否则要求 session `prepared` 且未绑定、chunk0 `prepared`（终态/运行中一律拒绝）；
3. `[1]` 探页数 → 重跑 preview → 指纹核验 → request_key/plan/chunk 行全比对；
4. chunk0 所属 lesson 单完整 chunk、range 1..30（多 chunk lesson 即停）；
5. 精确窗 convert（站外，零写）；结果非恰一课 → 只记 chunk attempts+错误码，
   session 保持 prepared（不置 failed）；
6. 单事务提交：重读（completed 即读档返回）→ 建文档 → canonical AST + shred →
   session 绑定并转 running → chunk completed；任一步失败整体回滚；
7. `chunk.document_id` 恒不写（废弃列，doctor 锁 NULL）；
8. 无 persistent running lease：并发重复计算允许，SQLite 写串行化 + 事务内重读
   保证至多 commit 一次，竞争方读到 completed 返回同一结果（单测锁定）；
9. 首 chunk 的课恒为追加序第 0 位（D2B 按 chunk 序 append 的 invariant，
   幂等读档据此定位；后续 chunk 执行时同样按序）。

### 6b. P5-D2C 后续 chunk 追加（已实现并锁定）

端点 `POST /api/documents/:userId/toc-import-sessions/:sessionId/execute-next`
（实现 `toc-import-execute-next.ts` + 持久化 `commitTocAppendChunk`）：

- 只执行“最小 prepared 即上一个 completed 的直接后继”；全 completed 即读档返回
  （零计算）；prepared 请走 execute-first，终态拒绝；legacy（无 AST 指纹）拒绝重备。
- AST 链：首 chunk 提交同事务记录 canonical AST SHA-256（v21）；
  每次 append 前重算当前 `ast_json` 比对，不一致（`E_TOC_AST_DRIFT`）即外部漂移、拒绝；
  成功后同事务更新指纹。legacy session 不得静默补写。
- append-only 合并：旧课数组逐字保留（id/顺序/内容），新课仅末尾，
  lesson.id 撞车即拒；合并后重校验；写合并 AST + 全量 shred 同一事务。
- chunk 废弃列恒不写；session 仍 running（无 prepared 剩余则 completed）；
  converter/形状失败只记 chunk 计数，target 与已完成 chunk 不动。
- 读档定位 invariant：首课=追加序第 0 位，后续按 chunk 序（D2B 按序执行的推论）。

## 7. Unresolved risk

- bun 单线程：真并发只靠 UNIQUE 约束，压力竞态未实测（WAL 下写串行化是 SQLite 保证，
  属 Verified fact；高并发重现属未覆盖）。
- chunk 窗转换的内容正确性仍依赖 P5-D1 的 convert 行为（0/多课即停，单测已锁）。
- 会话 GC：长期堆积的 prepared 僵尸 session 无 TTL（设计决策：审计优先；
  需要时由 D2B 加显式清理 API + doctor 年龄规则，不静默删除）。

## 8. P5-D2D 会话 UI 与只读状态（已实现并锁定）

- 只读端点 `GET /api/documents/:userId/toc-import-sessions/:sessionId`：
  纯 DB 读，白名单字段（sessionId/status/documentId/totalChunks/completedChunks/
  chunks[ordinal/lessonIndex/lessonTitle/range/status/attempts]/next），
  无 PDF/AST/folio/anchor/指纹原文；owner 不符即 `E_NOT_FOUND`。
- UI（`TocImportSessionPanel`，挂在 P4C 确认之后）：preview 全部可执行才显示准备；
  准备 Dialog 明示“只建计划不导内容”；同 key 重试显示 reused；
  会话块显示状态中性解释、完成数、目标、逐 chunk 行与服务端指定的 next；
  执行按钮只出现在 next 行（终态/长课/多段只有原因文案）；
  执行 Dialog 明示“仅导入这一课”；成功刷新 status 并显示 documentId；
  无 documentId 调 execute-first，否则 execute-next；pending 禁重复；
  失败只显 userMessage；取消零请求。
- 恢复语义：sessionId 只活在组件 state（无 localStorage）；
  刷新后用同一 PDF + 同一确认结果重走 preview + prepare，
  同 key 即回同一 session 并展示进度；plan 不同即新会话，不猜测复用。
- 禁止项（测试锁定）：无一键整书/连续/后台/重试按钮；
  无整书导入与 append UI；旧导入链路不动。
