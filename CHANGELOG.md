# Changelog

All notable changes to LexDistill are documented here. Release notes are reused by the GitHub Release workflow.

## [0.2.1] - 2026-10-18

### 修复

- 桌面构建：`beforeBuildCommand` 改用 `--filter` 调用 Gateway sidecar 脚本。Tauri 在 `apps/desktop` 下执行该命令，原先的根级脚本名找不到，导致四个平台构建全部失败。
- 发布矩阵移除 macOS Intel：PDF 运行时清单没有 `darwin-x64` 构件，该平台不在交付目标内（见 `docs/pdf-bundled-runtime.md`）。
- 运行时目录补齐 `opencode-v2`（`@yitom/acp-client` 0.1.12 起提供）：前端目录、网关目录与相关断言对齐。
- 测试门禁：默认单测超时提到 20s，避免机器负载下 5s 超时误报。

## [0.2.0] - 2026-10-18

### 聊天界面统一

- 消息列表、输入区、顶栏状态、空态、会话历史、会话参数全部改由外部 SDK `@yitom/chat-ui` 提供（0.1.17 → 0.1.21），本仓只保留业务槽位与消息适配。
- 题目导师并入同一渲染栈：删除第二套手写气泡、滚动与流式实现，导师专属内容改走尾部插槽（工具证据、来源徽标、离线重发、逐条朗读、追问）。
- 桌面宿主外链改走系统浏览器，避免 webview 就地导航。
- 表单与状态表达统一：状态胶囊四档语义、单选式会话参数、通用空态与会话历史弹层。

### 平台与外壳

- 全面更名为 LexDistill：包名、桌面壳、sidecar、持久化路径与全套图标。
- 主题切换改为双帧同步，消除切换撕裂；桌面顶栏固定在所有浮层之上。

### 架构

- Agent 通路收敛为 ACP-only：移除 Codex 专用分支与死通道，网关按运行时池选择，批改与出题不再分叉。
- 界面拆分：Settings、Dictionary、MistakeSprint、TodayPlan、阅读、韩语、教材等工作台拆为独立模块；语义 CSS token 与 Base UI 原语落地。

### 依赖

- `@yitom/chat-core` / `@yitom/chat-session` / `@yitom/chat-ui` 0.1.21，`@yitom/acp-client` ^0.1.12。

## [0.1.2] - 2026-09-08

### Changed

- fix(desktop): reliably launch packaged gateway
- feat(shred): 教材拆行入库+四路写回即拆
- feat(layout): 版式信号接入标题分类
- feat(structure): mini模型标题分类分流+存档

## [0.1.1] - 2026-09-08

### Changed

- fix(desktop): use dynamic gateway ports and expose updater
- feat(db): v14教材shred表结构
- ci(release): publish stable Linux bundles
- ci(release): refresh platform runners and AppImage setup

## [0.1.0] - 2026-09-08

The first public desktop release of LexDistill.

### Added

- Japanese, English, and Korean learning tracks with a learner profile and daily goals.
- Japanese kana studio with hiragana/katakana practice, romaji input, confusion-aware repetition, and AI tutoring context.
- Adaptive practice, multi-dimensional grading, mistake sprints, learner radar, FSRS spaced repetition, and card drafting.
- Reading, writing, listening, pitch-accent, textbook, dictionary, and Anki workflows.
- AI tutoring through the provider-agnostic Agent Gateway with WebSocket streaming and offline fallbacks.
- TTS voice preferences, optional neural voice providers, and on-demand licensed offline dictionary packages.
- Tauri desktop packaging for Windows, macOS, and Linux with a local Gateway sidecar.
- Signed GitHub Releases with automatic update checks and updater artifacts.

### Data safety

- Learning data is stored in the application data directory, separate from the installed application bundle.
- Updates replace the application bundle only; user profiles, study records, cards, mistakes, preferences, and databases are retained.
- Database migrations are additive and the desktop settings panel provides a database backup action.
