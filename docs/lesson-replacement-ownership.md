# Lesson replacement ownership 与 reconciliation shadow 设计（P1-C0.75 Task 5）

> 只读调查 + 设计，不实施。matcher（`lesson-reconciliation.ts`）未接入任何生产 identity assignment。

## 1. Canonical AST writer map（真实调用链，2026-09-10）

| writer | production reachable | new/existing | whole/append/partial | needs reconciliation | atomic now | failure behavior |
|---|---|---|---|---|---|---|
| `document-import-service.importDocument`（EPUB/TXT/MD/URL/PDF） | ✅ HTTP/tool | new doc | whole（新 AST） | 否（新 document，无旧 id） | ✅ `saveCanonicalAst` | err（任务 failed） |
| `pdf-import-service.importPdfDocument` | ⚠️ 仅测试调用（路由走前端 mutation→library-routes） | new doc | whole | 否 | ✅（dep 必需） | err |
| `appendPdfToDocument` + append 路由 | ✅ | existing doc | append（base 保留 + 新段） | 否（旧 id concat 保留） | ✅ `saveCanonicalAst` | err（回滚） |
| `library-routes` POST /api/documents/:userId | ✅（前端导入主路） | new/existing | whole（前端组装 AST） | **潜在是**（整体覆盖既有 doc 时） | ✅（教材分支） | err |
| `document-enrich-routes`（单次抽词） | ✅ | existing | partial enrich（课文内容改，序列一般不变） | 序列变化时是 | ✅ | err |
| `enrich-job-runner` persist/persistLesson | ✅（job） | existing | partial enrich | 序列变化时是 | ✅ | 记 failed，不中断 |
| `seed-bootstrap` INSERT | ✅（启动） | new（种子） | whole（静态） | 否 | ❌（raw SQL，前 drizzle 时期） | warn/跳过（启动后 shred 补） |
| `seed-repair.applySeedAstMigration` | ✅（运维/启动） | existing（种子白名单） | whole（方言迁移） | 否（只改文法键，序列不动） | ✅（同事务＋步后验证） | throw（整体失败） |
| `curriculum-content`（`{questions}`） | ✅ | — | 非教材形 | 否（无 lesson id） | N/A | — |

结论：**当前不存在“用户触发的 existing-document full reparse”入口**。
parser 升级没有批量 reparse 入口；AST overwrite 调用者全是 import/enrich/append/seed 四类，
其中只有 `library-routes` 的整体覆盖分支具备“旧 id 被整体替换”的形状（且前端当前只发新
document，多为新 id 场景）。

## 2. 未来唯一 replacement owner（verdict）

`library-routes` 的 documents 保存分支是唯一需要 reconciliation 的候选 owner：
它是唯一“外部组装 AST → 覆盖既有 document”的生产入口。其他路径要么新建（无旧 id），
要么保序（append/enrich/seed-repair 均已证明 id-preserving）。

接入形态（未来，不实施）：

```
old canonical AST（documents.ast_json 现状）
+ fresh provisional AST（重 parse 产物）
  ↓ reconcileLessons shadow（只记录，不赋值）
  ↓ future identity assignment（AUTO 才继承 old id）
  ↓ validate（含 lesson.id 唯一，zod 已锁）
  ↓ saveCanonicalAst（原子 AST + shred 写）
```

## 3. Shadow / real-pair capture（最小方案，不新建用户可达 API）

- 不新增任何 reparse 入口/按钮/路由（禁令：不为捕获发明用户功能）。
- 捕获点只挂在**已存在的整体覆盖写**上（即上表 `library-routes` 分支）：
  当请求携带的 AST 与库内既有 AST 的 `lessons[].id` 集合不一致时，把
  `{ documentId, oldIds, newProvisionalIds, at }` 以 `logger.warn`（运维日志，
  非用户文案）记录一行，绝不落库、不进 git、不含正文（只含 id 集合，避免教材
  文本外泄）。
- 该日志即未来 real old/new pair 的唯一来源；攒够真实样本后再评估 matcher
  线上阈值（fixture 的 0 FP 不得宣称为线上证明）。
- enrich/append/seed 路径不挂捕获（id-preserving，无 pair 价值）。
