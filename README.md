# LexDistill

> AI-native adaptive language learning studio for Japanese, English, and Korean.

仓库：<https://github.com/yitom486/lexdistill>

LexDistill 是一个面向多语种学习的自适应学习工作室：提供 FSRS 闪卡、靶向自适应出题、主观题多维批改、
错题本攻克流转、学情画像雷达。客户端只连接自研 Agent Gateway（HTTP + WebSocket），
学习资产以 SQLite（`learner-core` Repository）为唯一事实源，可整体换模型而不丢失。

**产品策略：桌面端是完整产品形态，提供本地学习数据与 Agent 辅导。**浏览器运行态用于共享界面的开发、预览和调试，不是必须独立发行的产品。Android 是后续轻量伴随端方向，首期不要求手机本地运行 Agent / ACP；远程 AI、离线与跨设备同步方案留待 Android 排期前决策。

顶层协作宪章见 [`AGENTS.md`](./AGENTS.md），所有参与者（人类与 AI Agent）必须遵守。

## 仓库结构

```text
apps/
  web/        React 19 + Vite + Tailwind 共享学习界面（浏览器开发/预览端口 3000，供桌面端复用）
  gateway/    Agent Gateway：唯一后端屏障 + 领域调度中枢（默认端口 8080）
  desktop/    Tauri v2 桌面壳（frontendDist 复用 web/dist，Gateway 以 sidecar 拉起）
packages/
  shared/         Result/BusinessError、ID/时间、logger 门面
  protocol/       WS 信封/事件 + Zod 契约（题目、批改、计划、阅读、词典…）
  learner-core/   纯领域规则：FSRS、日计划、练习计划、画像/错题生命周期
  agent-runtime/  Agent 统一入口：contracts（抽象契约）＋ ACP 适配层（唯一通路，运行时由 Gateway 池化选择）
  tool-core/      Tool 契约、权限分级、ToolRegistry
docs/           架构、协议、学习者模型、MVP 路线等正式文档
```

## 聊天界面（外部 SDK）

Agent 对话面板不在本仓实现：消息列表、输入区、顶栏状态、空态、会话历史与会话参数由
`@yitom/chat-ui`（当前 `0.1.21`）提供，本仓只保留业务槽位、消息适配与壳层。

```css
/* apps/web/src/index.css：形态与动效随包走 */
@import "@yitom/chat-ui/styles.css";
```

- 分工、插槽与升级流程：[`docs/chat-ui-integration.md`](./docs/chat-ui-integration.md)
- SDK 自身文档：<https://github.com/yitom486/montree-chat>

## 快速开始

前置：Bun（见 `bun.lock`）、Node 类型；桌面端另需 Rust 工具链（`cargo`）。

```bash
bun install
bun run dev:gateway   # Agent Gateway（http://localhost:8080，/ws）
bun run dev:web       # 学习客户端（http://localhost:3000）
bun run dev:desktop   # Tauri 桌面壳（自动拉起 Gateway sidecar）
```

常用命令：

```bash
bun run typecheck   # 全仓严格类型检查（tsc -b），提交前必须零报错
bun run test:all    # 唯一正式门禁：全 workspace 测试（显式排除 dist 编译产物）
bun --filter @lexdistill/web build   # Web 生产构建
bun run build:sidecar                  # 编译 Tauri Gateway sidecar
bun run release:sync -- 0.1.0          # 同步所有包、Tauri、Cargo 与 Changelog 版本
bun run release -- 0.1.0               # 校验、提交、打 tag 并推送，触发 GitHub 多平台发布
```

## 发布与自动更新

发布版本使用统一的 SemVer。`bun run release -- 0.1.0` 会先运行 `typecheck` 与 `test`，再同步根包、工作区包、Tauri 配置、Cargo manifest/lock 和 `CHANGELOG.md`，最后创建 `v0.1.0` 标签并推送到 `origin`。标签会触发 `.github/workflows/release.yml`，并为 Windows x64、Linux x64、macOS Intel 和 Apple Silicon 构建安装包及 Tauri updater artifact。

自动更新使用 GitHub Releases 的签名 updater。首次配置时生成 Tauri signing key，将公钥内容写入
`apps/desktop/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，并把私钥配置为 GitHub Actions secret：
`TAURI_SIGNING_PRIVATE_KEY`（如有密码，再配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。私钥只保存在本机的 `.release-secrets/` 或 GitHub secret 中，绝不提交到仓库。

桌面端启动时会静默检查更新并提示用户确认安装，设置页也提供手动检查入口。更新只替换应用包；Gateway SQLite 数据库位于系统应用数据目录，Zustand 偏好位于浏览器/Tauri 本地存储，均不会因升级被覆盖。数据库迁移遵循加法兼容策略，发布前仍建议使用设置页备份学习数据库。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `GATEWAY_PORT` | `8080` | Gateway 监听端口 |
| `STUDY_STUDIO_DB` | 仓库根 `lexdistill.db` | SQLite 库路径（桌面端由壳指向应用数据目录） |

## 脚本说明

仓库根 `scripts/` 为空目录，占位用，勿直接加零散脚本。真实脚本收归各包：

| 脚本 | 位置 | 用途 |
| --- | --- | --- |
| `sidecar:build` | `apps/gateway/scripts/build-sidecar.ts` | `Bun.build compile` 产出桌面端 Sidecar 到 `apps/desktop/src-tauri/binaries/`（gitignored；当前 Windows x64 文件约 111 MB，含 `bun:sqlite`；Android 不在现有构建目标内） |
| `dictionary:import:oewn` | `apps/gateway/src/scripts/import-oewn.ts` | Open English WordNet 离线导入（默认 dry-run，`--apply` 才写库） |
| live 私人教材验收 | `apps/gateway/src/scripts/live-corpus-map.ts` + `docs/pdf-live-corpus-playbook.md` | 本机 PDF 只读结构预览（需 `LEXDISTILL_LIVE_PDF`，不写库；未设变量只打印用法） |

## 文档索引

- 协作铁律：[`AGENTS.md`](./AGENTS.md)（业务↔厂商解耦、Gateway 边界、ContextSnapshot、Result 模式、测试标准）
- 系统架构：[`docs/architecture.md`](./docs/architecture.md)
- 聊天界面接入：[`docs/chat-ui-integration.md`](./docs/chat-ui-integration.md)
- 通信协议：[`docs/protocol.md`](./docs/protocol.md)
- Agent 运行时：[`docs/agent-runtime.md`](./docs/agent-runtime.md)
- 学习者模型：[`docs/learner-model.md`](./docs/learner-model.md)
- 产品章程与路线：[`docs/project-charter.md`](./docs/project-charter.md)、[`docs/mvp-roadmap.md`](./docs/mvp-roadmap.md)
- Gateway 领域迁移基线：[`docs/gateway-g0-baseline.md`](./docs/gateway-g0-baseline.md)

## About

LexDistill 将学习者模型、课程资产和 Agent 能力组合成一个可扩展的学习闭环：

- **Adaptive practice**：根据技能熟练度和近期错误动态安排练习；
- **Spaced repetition**：使用 FSRS 管理词汇、语法和混淆句型卡片；
- **AI tutoring**：通过 Agent Gateway 提供流式讲解、批改、诊断和练习生成；
- **Learner-first**：学习记录、错题、卡片和学情指标以 SQLite 为唯一事实源；
- **Provider-agnostic**：所有 Agent 运行时都经 ACP 协议接入 Gateway，换模型或换厂商不触碰业务代码；
- **桌面优先**：Tauri 桌面端是完整产品，复用 React 界面；Android 作为后续轻量伴随端评估，不要求本地 Agent。

GitHub 项目简介（About）：

> LexDistill — adaptive, AI-native language learning studio for Japanese, English and Korean. FSRS spaced repetition, targeted practice, learner modeling, and a provider-agnostic ACP Agent Gateway. Tauri desktop.

`.studio-internal/`（gitignored，不进公开仓库）为实现期内部沉淀：静态数据登记、
AI Native 运行时设计、目标语种 UI 壳层、词典选型与各阶段计划。

## 词典数据与署名

离线词典均为按需安装、不预装进 Git 或前端 bundle：

- 英语 Open English WordNet（CC BY 4.0，Princeton WordNet 署名保留）
- 日语 JMdict（EDRDG，CC BY-SA 4.0；OJAD 仅允许用户主动打开深链，禁止爬取）
- 韩语 Kengdic（CC BY-SA 3.0 / LGPL 2.0）

新增静态数据、演示数据或规则时，必须登记到
`.studio-internal/STATIC-DATA-INVENTORY.md`（AGENTS.md §5）。
