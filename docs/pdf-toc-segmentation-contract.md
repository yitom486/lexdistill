# PDF 目录分段契约（TOC → 物理页 → lesson segment）

> 长期维护文档。实现：`apps/gateway/src/modules/library/application/pdf-import/toc-segment-preview.ts`
> （纯函数 `previewTocSegments`），单测：`apps/gateway/src/modules/library/__tests__/toc-segment-preview.test.ts`。
>
> 本文档每条结论带标签，含义：
> - **Verified fact**——已有代码/实测支撑，可直接依赖；
> - **Proposed rule**——当前 preview 采用的规则，合理但未经大规模真书验证，P5-B 可收紧；
> - **Unresolved risk**——已知但未解决的风险，不得据此做自动决策。

## 0. 定位（一句话）

本模块只是 **preview / planning**：回答“如果 anchors 可信，lesson 落在哪些物理页、
切成哪些 ≤30 页 chunk”。它**不获取 anchor、不调运行时、不写任何数据**。
真正获取 anchor 的策略留给 **P5-B**；**P5-C** 才可能把用户确认的 segment plan
交给导入链；任何 `unresolved` 条目**不得进入自动导入**。

## 1. 已验证的能力地图（Verified fact）

| 能力 | 来源 | 能否提供“已证实的 physical-page anchor” |
|---|---|---|
| PDF 总页数 `pageCount` | `processPdf(bytes,[1])` 轻探针即返回全书页数（`probePdfPageCount`，`apps/gateway/src/modules/library/application/pdf-import/pdf-import-service.ts:147`），P0.1a 起为开窗前置条件 | 否，只能做越界校验 |
| 内置目录 physicalPage | fork `extractEmbeddedOutline` + 网关校验（`readEmbeddedOutlineEntries`，同文件 `:229`）：title 非空、level≥1、`physicalPage` 落在 1..pageCount；truncated/空/抛错一律 null | **是，但只给“标题→物理页”**，不给“印刷页↔物理页”。要成为 anchor，还需人工把某印刷页码对应到该物理页（P5-B 或人工确认） |
| 原生文本条目 + 版式位置 | `extractTextWithPositions`（`pdf-runtime.ts:29`，可选；`layout-headings.ts:127` 缺席即降级） | 否，弱信号：只有文字与坐标，没有“这是第几印刷页”的断言 |
| OCR 页内文本 + 行级 spans | `processPdfWithOcr`（P3 基线消费 markdown + spans 做几何验证） | 否，弱信号：P3 只用它验证“标题—右侧页码同行”，从未抽取 folio（页眉页脚印刷页码） |
| 窗口与分段逻辑 | `rangePages`（同文件 `:137`）、`MAX_OCR_PAGES_PER_IMPORT = 30`（`:25`）、`MAX_PDF_PAGES = 400`（`:23`）、P0 分块分类 / CMD-08 首窗夹持 | 否，只约束“一次最多吃多少页”，不回答映射 |
| 受限页渲染 PNG | fork `renderPdfPages`（P4A-2，`toc-review-material.ts`） | 否，只给 P4B 的 Agent 看，不产生机器可用的页码对应 |

结论：**今天没有任何能力能全自动产出 printed↔physical anchor**（Verified fact）。
folio（页眉页脚印刷码）抽取、罗马数字页码识别、anchor 人工确认 UX 全部缺失，
归 P5-B。

## 2. 映射契约（`previewTocSegments`）

输入：`pageCount`；已确认 TOC entries（`title/printedPage/level/kind`，P4C 形状）；
显式 anchors `{ printedPage, physicalPage, evidence }`，
`evidence ∈ embedded-outline / human-confirmed / verified-folio`
（`verified-folio` 尚无生产者，类型先行）。

输出：每个 `kind=lesson` 的 `printedStart`、`physicalStart | null`、
`physicalEnd | null`、`status`、`reason`、`regionId`、`offsetUsed`；
`regions`（已验证区间）；`chunks`（≤30 页）；`diagnostics`（计数）。

### 2.1 输入校验（fail-closed，Verified fact 级别的严格性）

- `printedPage / physicalPage` 只接受正整数；anchor 两端必须落在 1..pageCount；
- anchors 按 printed 严格递增、按 physical 严格递增（重复/倒序/物理倒退 → 整单拒绝）；
- lesson 按 printed 严格递增（重复/倒序 → 整单拒绝）；
- 未知 `evidence` 字符串 → 整单拒绝（title/课号/模型置信度在类型层面就进不来）。

### 2.2 region 装配（Proposed rule）

- `offset = physical - printed`；**连续同 offset anchor（≥2 个）组成已验证区间**
  `[首printed, 尾printed]`；单点 anchor 不构成区间（无从验证）。
- 不同 offset 的 anchor 之间不断言任何全书常量（Verified fact：见 §3 失效 modes）。

### 2.3 逐课归属（Proposed rule）

1. 印刷页精确命中 anchor → `anchor-exact`（落在区间内则归属该区间，保证相邻 end 可算）；
2. 落在已验证区间内 → `verified-interval`；
3. 否则看印刷序相邻的上下 anchor：
   - 两侧 offset 一致 → 一致外推（单 anchor 全书时记 `single-anchor-extrapolation`）；
   - 两侧不一致 → `between-conflicting-offsets`，`unresolved`（歧义不猜）；
   - 无 anchor → `no-anchors`，`unresolved`；
4. 算出的物理页 `<1` / `>pageCount` → `unresolved`（`maps-before-page-1` / `maps-beyond-pagecount`），
   不截断、不钳制（钳制会伪造 lesson 边界，Verified fact 级别的禁止）。

### 2.4 segment end（Proposed rule，偏保守）

- `end` **仅当**本条与下一条同处**同一已验证区间**时 = 下一条 `physicalStart - 1`；
- 末课在已验证区间内 → 取区间物理尾（区间尾 anchor 的物理页，天然 ≤pageCount）；
- 其余（外推/下一条 unresolved/末课无区间）一律 `null`，`diagnostics.lessonsWithoutEnd` 计数。
- 含义：**只有被两个以上 anchor 夹住的 lesson 才有机器可信的 end**；单 anchor 书的
  lesson 只有 start，这是诚实而非缺陷（P5-B 补 anchor 后自然解决）。

### 2.5 chunk plan（Verified fact 级别的机械拆分）

- 只覆盖 `physicalStart/End` 双全且 `start ≤ end` 的 lesson；
- 从 start 起每 30 页一段，尾段可短（31→30+1，60→30+30，61→30+30+1）；
- 每段恒 ≤30 页（与 `MAX_OCR_PAGES_PER_IMPORT` 同值，直接引用常量，单测锁死）；
- chunk 只含 `lessonIndex/title/chunkIndex/physicalFrom/physicalTo`，不含任何内容字节。

## 3. 常量 offset 何时成立、何时失效

成立条件（必须同时满足，否则本模块按 §2.3 判 unresolved/分 region）：

- 该印刷区间内页码连续、无重启、无罗马数字混排；
- 无整页缺失/重复扫描错页（Verified fact：扫描错页会整体平移 offset，见 CMD-05 扫描样例语境）。

已知失效 modes（Unresolved risk，P5-B 必须逐个有对策）：

| 场景 | 后果 | 本模块行为 |
|---|---|---|
| 前言 / 目录自身占物理页（非零 offset，如 printed 1 → physical 6） | 全书恒定偏移 | 单 anchor 即可表达；属最安全的外推 |
| 前言用罗马页码（i, ii, …），正文从 1 重起 | 目录 printed 1 可能是第 N 个物理页 | 必须给正文起点 anchor，否则全书错位；模块不猜罗马码 |
| 章节/附录处页码重启 | offset 台阶跳变 | 两侧 anchor offset 不一致 → 中间条目 unresolved（已实现） |
| 附录独立编号（A-1…） | printed 非纯数字 | 输入校验直接拒绝（只收正整数），P5-B 需先定附录策略 |
| 缺页 / 扫描重复页 | offset 在缺页点漂移 | 无 anchor 覆盖漂移点即错；P5-B 需 folio 抽查 |
| folio 被裁边 / 污渍 OCR 错读 | P5-B 若用 folio 做 anchor 会引入错 anchor | anchor 一旦错，全区间错；P5-B 必须要求双源印证或人工确认 |

## 4. P5-B 前置条件（anchor 获取策略，**本轮不实现**）

1. folio 抽取器：对候选物理页做受限 OCR/原生文本，抽页眉页脚印刷码（含罗马数字归一化），
   输出 `{ physicalPage, folioPrinted, confidence }`（候选，非 anchor）；
2. anchor 提升规则：folio 候选 + embedded-outline 物理页 + 人工确认三源中至少两者印证，
   或单源 + 人工显式确认，方可写入 `verified-folio / embedded-outline / human-confirmed` anchor；
3. P5-B 必须复用本模块做回归：新增 anchor 来源只允许增加 mapped、**不允许**把已有
   unresolved 静默变 mapped（单测锁定今日快照）；
4. P5-C 交接 gate：`unresolvedCount > 0` 的 plan 禁止整书自动导入，只能逐课人工点选
   已确定 chunk；`lessonsWithoutEnd > 0` 必须向用户明示“这些课只有起点没有终点”。

## 5. 非目标（本轮明确不做）

真实导入、AST 写入、shred、DB migration、P5 映射之外的任何映射逻辑、
Web UI 改动（本轮禁止改 Web）、anchor 自动获取（P5-B）、plan 落库与执行（P5-C）。

---

## 6. P5-B：folio 候选抽取（candidate ≠ anchor）

实现：`apps/gateway/src/modules/library/application/pdf-import/toc-folio-candidates.ts`
（纯函数 `detectFolioCandidates` + 只读编排 `extractFolioCandidates`），
端点 `POST /api/documents/:userId/folio-candidates`（显式 `pages` 页号集），
单测：`apps/gateway/src/modules/library/__tests__/toc-folio-candidates.test.ts`
（含真机位：pdf-lib 自造单页 + pinned 测试运行时）。

### 6.1 一句话

本模块只回答“PDF 第 N 页的页眉/页脚位置可能看见了什么印刷页码”，
**不能**回答“这就是 anchor / 全书 offset / 该导哪一课”。
输出的 candidate 只是弱证据：P5-C 必须经**双源一致或人工明确确认**
（candidate ↔ 某个 printedPage 的对应关系），才能写入 P5-A anchor；
任何 candidate **不得**直接传入 `previewTocSegments` 的 `anchors` 参数
（形状上就不兼容：candidate 没有 printed↔physical 映射字段）。

### 6.2 能力证据（Verified fact vs proposed heuristic）

- **Verified fact**：fork 原生 `extractTextWithPositions` 可用（1.18.2 实测），
  返回逐条文本 + x/y/宽高（`pdf-runtime.ts:29`，`collectLayoutCandidates` 已消费）；
  OCR spans 与其**同坐标系**（P3 注释口径一致）。
- **Verified fact**：原生 y 轴**向上**（bottom-origin）。探针方法：
  pdf-lib 建页（612×792，origin 左下），页顶 y=750 写 `TOPMARK`、页底 y=50 写
  `BOTMARK`，`extractTextWithPositions` 回报 y=750 / y=50（见本文件单测
  `native y 轴向上`，fp 升级翻转即红）。因此 header = 高 y 边带，footer = 低 y 边带。
- **Verified fact**：OCR 仅在 native 缺失/无命中时对**相同选择页** fallback；
  所有 native/OCR/inspector 调用恒带非空页窗（单测锁定调用参数，绝无单参 `processPdf`）；
  OCR 上限 30 未动；不调 Agent/渲染/模型；不写 DB/AST/cache；日志只记计数。
- **Proposed heuristic**（合理但可调，全部有单测锁定当前行为）：
  1. 边带按本页 y 跨度的上下各 12% 划分（无页尺寸 API，只能相对；内容稀疏页<3 条直接无候选）；
  2. 同行按 y 容差合并后**整行恰好一个 token**才受理（目录行/表格行/正文行天然多词被弃）；
  3. 装饰符只剥两端（`-–—·•.。,、()（）[]`），行内连字符/空格不断言（如电话号码）；
  4. Arabic 只收 1–1500（年份 19xx–20xx 与超大号一并排除；千页以上巨著的真 folio 是已知误伤，见下）；
  5. Roman 只收严格罗马形并转大写原形，**类型层面就没有转数字的位置**；
  6. native 置信度 medium、OCR 一律 low，OCR span 置信度 <0.5 直接弃；
  7. 同页 header/footer 冲突并列保留、绝不仲裁；同位置同归一值去重。

### 6.3 仍是 unresolved 的风险（P5-C 不得依赖这些）

- 边带标签依赖“y-up 即视觉上下”：探针只证数值方向，**未证**“首个文本块即视觉页眉”
  （双栏/横排/旋转页可能错位；旋转/横向页面无真机覆盖）。
- 相对边带在内容稀疏页失效（<3 条即放弃，宁可漏检；封面/空白页天然无候选）。
- 原生条目粒度未知（行级假设）：若某版本切分为逐字条目，单数字 token 会误升 folio
  （当前以“单 token 行”近似，逐字粒度下此假设崩，单测未覆盖，fork 升级需重验）。
- 中央水印/印章数字若恰落边带且形如孤立小数字，仍可能误升（位置是唯一防线）。
- 1500 上限会误杀巨著真 folio；前言罗马码与正文阿拉伯码并存的书需要 P5-C 显式选边。
- 页码重启、漏扫页、扫描污渍：与 §3 同，candidate 只能“看见”，不能“断定”。

### 6.4 P5-C 前置条件（更新 §4）

1. P5-C 的确认 UX 必须展示每条 candidate 的 `raw / normalized / location / source /
   confidence`，并让用户显式把它**钉到某一个 printedPage**（或拒绝）；
2. 钉选规则：同一对应关系至少有两项独立证据（例如 native folio 与 OCR folio 在同页一致；
   folio 候选与 embedded-outline 物理页互相吻合；或其中一项加人工明确确认），
   方可生成 P5-A anchor（`embedded-outline / human-confirmed /
   verified-folio`）；单 OCR-low 候选**永不**自动成 anchor；
3. `unresolvedCount > 0` 的 plan 禁止整书自动导入（§4 原文继续有效）；
4. P5-C 若新增 anchor 来源，沿用 §4.3 回归铁律：只许增 mapped，不许静默转正。
