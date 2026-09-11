# TOC 整书导入执行契约（session / chunk / 幂等）

> 长期维护文档。实现：
> - 表：`toc_import_sessions` / `toc_import_chunks`（`schema.ts` + `ddl.ts` + `migrations/v019`）；
> - 持久化：`apps/gateway/src/modules/library/persistence/toc-import-sessions.ts`；
> - 服务：`application/pdf-import/toc-import-prepare.ts`，端点 `POST /api/documents/:userId/prepare-toc-import`；
> - doctor 规则：`toc-import:*`（`infrastructure/db/doctor.ts` §8b）。
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

## 2. 数据模型（Verified fact：以 `schema.ts` / `ddl.ts` / v019 为准）

`toc_import_sessions`：`id`（`tocimport_*`，服务端生成）、`user_id`、
`request_key`（§3）、`plan_fingerprint`、`pdf_sha256`、`page_count`、
`lesson_count`、`chunk_count`、`status`（prepared/running/completed/failed/cancelled）、
`doc_title`（展示）、`error`、`created_at/updated_at`；
`UNIQUE(user_id, request_key)`。

`toc_import_chunks`：`session_id`、`ordinal`（0-based 执行序）、`lesson_index`、
`lesson_title`（展示）、`physical_start/end`、`chunk_fingerprint`（§3）、
`status`（prepared/running/completed/failed）、`document_id`（D2A 恒 NULL）、
`attempts`、`error`；主键 `(session_id, ordinal)` 即“同 session/ordinal 唯一”。

- 计划 immutable：本模块**不提供** entries/anchors/status 更新路径；
  改计划只能产生新 `request_key` → 新 session（设计决策）。
- 状态封闭枚举：TS 联合 + 读侧收窄（非法值回退 `prepared`，读侧永不抛）+
  doctor `toc-import:status` FAIL 规则锁。不加 FK（无 FK 架构，见 doctor §8b 注释）。
- 删除语义：删 document **不碰** session/chunk（计划审计，随 `document_imports`
  同例保留）；D2A 不提供删除 API；用户放弃未完成 session 的显式取消接口归 D2B
  （`cancelled` 枚举已预留）；孤儿 chunk（session 缺失）即数据异常，由 doctor 报 FAIL。

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

## 5. Session 生命周期（设计决策，D2B 落实）

- `prepared`：D2A 终点；可被同 key 重试复用；可被用户放弃（D2B 取消接口 → `cancelled`）。
- `running`：D2B 成功 claim 第一个 chunk 后置位；执行中进程崩溃即停留 running，
  重试同 key 返回 session，D2B 按 chunk 状态续跑（prepared 重跑、completed 跳过）。
- `completed`：全部 chunk completed 后置位（D2B 原子更新）。
- `failed`：chunk 不可恢复失败或执行器异常时置位（D2B），`error` 记原因；
  用户改计划重提即新 session，旧 failed 行保留审计。
- 重试语义只有一种：**同 request_key 重发**（返回同一 session）；改任何输入即新 session，
  不存在“覆盖旧计划”操作。

## 6. D2B 精确执行 gate（D2B 实现时逐项打勾）

1. 按 `(user, request_key)` 读 session；`cancelled/failed` 拒绝执行；
2. 按 `(session, ordinal)` 取 chunk；非 `prepared` 拒绝重复执行；
3. 重算 `chunkFingerprint` 并与行比对，不一致拒绝（计划漂移）；
4. 重跑 P5-A preview 确认该课仍 mapped 且 range 与 chunk 一致；
5. 仅执行该 chunk 的物理窗 convert；结果非恰一课即 chunk 置 `failed` 并停；
6. `saveCanonicalAst` + chunk 置 `completed` + `document_id` 回填**同一事务**；
7. 任一步失败：chunk 置 `failed`（+ attempts++ + error），session 不置 completed，
   已有 document/shred 行保持最近一次成功事务的完整状态（无半写）；
8. 本文档 §5 的 `completed` 判定与放弃语义由 D2B 测试锁定。

## 7. Unresolved risk

- bun 单线程：真并发只靠 UNIQUE 约束，压力竞态未实测（WAL 下写串行化是 SQLite 保证，
  属 Verified fact；高并发重现属未覆盖）。
- chunk 窗转换的内容正确性仍依赖 P5-D1 的 convert 行为（0/多课即停，单测已锁）。
- 会话 GC：长期堆积的 prepared 僵尸 session 无 TTL（设计决策：审计优先；
  需要时由 D2B 加显式清理 API + doctor 年龄规则，不静默删除）。
