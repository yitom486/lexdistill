# 聊天界面接入（@yitom/chat-ui）

聊天面板由外部 SDK 渲染，应用只保留壳层与业务语义。改这一块前先读本文。

## 版本

- `apps/web` 固定 `@yitom/chat-core` / `@yitom/chat-session` / `@yitom/chat-ui` **0.1.18**，`apps/gateway` 固定 `@yitom/acp-client` **^0.1.12**。
- 六包必须同版本；不同版本会让 branded 类型出现多份实例。升级见文末流程。

## 分工

| 层 | 归属 | 文件 |
|---|---|---|
| 消息渲染、时间线编排、历史窗口、贴底跟滚、回到底部、运行状态行、审批卡 | `@yitom/chat-ui` 的 `ChatMessageList` | 包内 |
| 输入区形态、自增高、IME 守卫、Enter 发送、发送/停止按钮 | `@yitom/chat-ui` 的 `ChatComposer` | 包内 |
| 顶栏骨架、状态胶囊（连接/就绪/请求中/回退/失败） | `@yitom/chat-ui` 的 `ChatPanelHeader` + `ChatStatusBadge` | 包内 |
| 消息结构转换（扁平聚合消息 → thought / tool / agent 时间线消息） | 应用适配层 | `agent-chat/chat-message-adapter.ts` |
| 逐条朗读、来源标签 | 应用插槽 | `agent-chat/ChatMessageList.tsx` 的 `renderMessageFooter` |
| 排队条 | 应用 | 同上（列表上方固定条） |
| 空态卡片 | `@yitom/chat-ui` 的 `ChatEmptyState` | 包内（文案由 `getTutorTrackCopy` 注入） |
| 会话历史弹层（列表 + 新建 + 压缩/分叉/归档） | `@yitom/chat-ui` 的 `ChatHistoryMenu` | 包内；`ChatHistoryPopover.tsx` 只接 toast/音效/开关 |
| 参数弹层、运行时与模型选择、加入下一轮队列 | 应用 | `ComposerSettingsPopover` / `ChatComposer.tsx` 的槽位 |
| 回合、排队、审批策略、运行时能力门控 | 应用 | `use-chat-turn.ts` |

**不要再自建滚动容器、气泡壳或输入条**：形态与键盘语义在包里，自维护版本会和包的布局互相打架。宿主只决定"谁连接、发什么、怎么排队"。

## 插槽

`renderMessageFooter(message)` 在每条气泡下方追加宿主内容。`message.id` 与原始消息 id 一致，所以宿主用 `Map` 回查即可拿到 `source`、`streaming` 等包不关心的字段；返回 `null` 该条不占位。该插槽是 0.1.15 新增，0.1.14 没有。

## 皮肤与动效（形态归包、配色归本仓）

0.1.16 起 `@yitom/chat-ui` 自带 `styles.css`，宿主引入一次即可，**不要再往仓里复制皮肤**：

```css
@import "@yitom/chat-ui/styles.css";
```

里面包含：`fade-slide-in` / `beui-message-in` / `bui-fade-up` / `bui-shimmer-text` / `agent-pixel-pulse`
五个关键帧、九格像素加载器规则、`.markdown-preview.agent-md` 正文排版、动效节奏 token
（`--chat-motion-enter|thinking|shimmer|pixel`）。规则包在 `@layer components`，本仓的 Tailwind utilities 永远优先。

本仓仍需负责的只有两件事：

1. **配色变量**：包的过程态把颜色写在**内联 style** 里，读 shadcn 变量名（`--foreground`、`--muted-foreground`、`--border`、`--card` …）。`index.css` 末尾用 `:root` / `.dark` 两组别名映射到 `--ink` / `--ink-soft` / `--line` / `--paper-soft`。缺这层时内联渐变取不到值，配合 `text-transparent` 会让「工作中」这类标签**直接消失**（0.1.16 已给渐变加 `currentColor` 兜底，但语义色仍要对上主题）。
2. **Tailwind 扫描**：`@source "../node_modules/@yitom/chat-ui/dist";` 不扫描 dist 会丢掉工具卡/状态/按钮的 Tailwind 类。
   `@theme inline` 已把 shadcn 语义 token（`background`/`foreground`/`card`/`muted`/`border`/`ring` …）映射到本仓 token；新增映射时 `:root` 与 `.dark` 都要给值。

要改正文密度或字体时，在本仓样式里写同名选择器覆盖即可（`@layer components` 之上）。

## 升级流程

1. 在 `D:\project\js\montree-chat` 改代码、升六包版本、本地 `bun run typecheck && bun run test && bun run build`。
2. 提交 master，打标签 `pkg-v0.1.15` 并推标签；`publish.yml` 会逐包 `npm publish`，已存在版本自动跳过（幂等）。**若标签推送没触发工作流，删掉标签重推即可**（`git push origin :refs/tags/<tag>` 再推一次）。
3. 回来改 `apps/web/package.json` 的版本号，`bun pm cache rm && bun install`（不清理缓存时 bun 可能仍解析到旧版本）。
   工作流打印 `+ @yitom/xxx@<版本>` 只代表 npm 已接受；registry 元数据经 CDN，通常要 1–3 分钟才可见。这期间 `bun install` 会报 `No version matching ... (but package exists)`，等元数据更新后重试即可，不是版本号写错。
4. 验证：`bun test apps/web/src/components/agent-chat`、`bun run --filter @lexdistill/web build`，并确认构建产物 CSS 里存在 `agent-md`、`agent-pixel-pulse`、`chat-shimmer-text`。

## 未完成

`ai-tutor`（`TutorComposer` / `TutorMessageList` / `AiTutorDrawer`）与 `WordTutorPanel` 仍是第二、第三套手写渲染，尚未迁到同一渲染栈。
