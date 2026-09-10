# 本机私人教材 OCR 验收剧本（live corpus playbook）

> 真机验收用，不进 CI。语料位置见仓库规则 `.cursor/rules/local-textbook-corpus.mdc`，
> 本文档不写文件名、不贴课文。整本导入是用户稍后手工做的事，不是本剧本的完成条件。

## 前置

- 网关可启动（`bun run dev:gateway` 或桌面 sidecar）。
- OCR 运行时就绪：首次扫描页导入会自动下载运行时（约 80MB，一次性）。
  测试目录变量（`STUDY_STUDIO_TEST_RUNTIME_DIR`）只给自动化测试用，验收走产品缺省目录。

## 步骤（可独立执行）

1. **map 前 30 页**（只读结构预览，不写库）：
   ```powershell
   $env:STUDY_STUDIO_LIVE_PDF = '<本机 PDF 绝对路径>'
   bun src/scripts/live-corpus-map.ts   # 在 apps/gateway 下执行
   ```
   确认输出：`pageCount`、需 OCR 页数、标题候选（text + page）与目录条目摘要。
   未设变量时探针只打印用法并 exit 0（CI 安全）。
2. **标噪声**：在导入页对 map 出的标题跑 AI 分类，把封面/目次/前言标为 noise
   （观测随确认存档，可回查）。
3. **选范围导入**：导入页点「全部页」或「指定页码」。扫描书单次 OCR ≤ 30 页，页数多时请用「指定页码」分段，再「接力到已有书」。
   网关控制台默认会打 `[pdf-map] 结构预览完成` / `[pdf-import] 转换完成`（课标题列表，无课文正文）。
4. **同一 document 用 append 接力**后续课（续排号），不要每段建新书。

## 期望

- 课 title 含「第N課」课号；会話/練習A/目次不成课；復習单独成课。
- append 后全书课数连续，sort 连续。
- 导入/OCR 行为口径以仓库 fixture（CMD-02/03 单测）为准，真书只做验收抽查，
  不为个例放宽切课正则或 OCR 上限。

## 失败记录规范

- 只记录：页码 + 标题候选文本（一行一条）。
- 禁止粘贴课文正文；禁止截图/拷贝页面进仓库、`fixtures/` 或测试断言。
- 修完先跑 `git status`，与本剧本无关的脏项不得提交。
