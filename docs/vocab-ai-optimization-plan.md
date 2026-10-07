# 词汇＋AI 优化计划（worktree：study-studio-vocab-ai）

> 状态：P0 已合入 master（`9afe1353`、`7865222e`、`b4193af0`）。
> 约束：WRITE 类工具必须明示才给；固定任务走 `task` id；改动按批提交并 ff 到 master。

## P0 已完成（中央目录＋task 闭环）
- `runtime/router/tool-catalog.ts`：Gateway 工具选型唯一 owner（基线/意图/提示词表＋`TASK_TOOL_PRESETS`＋`resolveSessionTools`/`resolveTaskTools`）。
- `modules/library/mcp/textbook-mcp-catalog.ts`：教材 MCP 服务器唯一 owner（六写入工具＋`buildTextbookWorkerMcpServer`）。
- `turn-handlers`：`task`＞`tools`＞提示词；升级判定用同一份请求集。
- `useWordTutor`：首个 `task: 'vocabulary.explain'` 发送方。
- 文档：`agent-runtime.md` 门禁第 5 条＋路由 README＋PDF 流程 MCP 归属。

## P1 主聊默认 vocab 读工具（本轮）
- `READ_BY_INTENT.FREE_COACH` 加 `vocabulary.learning.context`（只读；`submit` 仍需“生成讲解”类明示）。
- 测试：主聊默认含 context、不含 submit；WRITE 误开断言。
- 验收：`tool-catalog`＋`turn-tools`＋`session-tools`＋`boundaries` 全绿。

## P2 教材行学习 UI 接线（已完成）
- `WordChatThread` 纯展示线程抽出（`WordAiPanel` 改调，行为不变）；`TextbookWordAiPanel` 教材行面板（行 ID 进指令经 `textbookVocabularyId` 绑定，存后刷词汇库＋词表）。
- `StructuredVocabularyList` 加 `enableAi`（默认关，导入预览不受影响）；`TextbookCurriculum` 学习路径开启。
- 验收：dom 测试（默认无入口→展开→收起）。

## P3 Hub 锁态 409 对齐（对方地盘，只 review 不动手）
- `DailyWordStudyHub` 课程单元扩展返回 400 而非 409，锁 banner 失效；文件在对方手里，等它改。

## P4 E2E 真机验证（等用户）
- 用户重启网关（新代码）＋确认 luna；一次生成 run，验保存→渲染。

## P5 MCP 外部真通道（已关闭：无需求，不做）
- 立项分析结论：全仓零 `EXTERNAL` 注册工具（仅 `permissions` 定义＋`ToolRouter` stub 分支）；Anki 经 SERVER 工具 `flashcards.anki_push` 直连本机 AnkiConnect，已覆盖；Notion 等无需求方。
- 按简单优先＋`agent-runtime.md`（禁 Server Tools 无故改道 MCP），stub 保留，待真实外部系统出现再立项。
