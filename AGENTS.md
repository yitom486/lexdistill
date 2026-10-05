# Lingua Studio — 协作与工程原则

对外产品名为 **Lingua Studio**；Study Studio 保留为内部工程代号。当前产品只交付 Tauri 桌面端。

## 协作原则

- 用户决定产品方向、架构边界和数据处理。重大改动先说明并取得批准；已授权的工作直接完成，不反复确认，不擅自扩大范围。
- 只改当前任务需要的内容，保留用户和其他人的工作；修改运行中的服务前说明影响。
- 用户禁止系统权限确认时，不申请提权、不绕过限制；受限部分如实报告。
- 每次回复先用 `Natural English:` 表达用户意图，再用中文回答；保留技术名称，沟通简明直接。

## 工程原则

1. **简单优先**：选择满足当前需求的最直接方案。复用现有能力和成熟组件，不重复造轮子，不为假设中的未来增加层次、框架或兼容分支。
2. **职责清楚**：界面负责交互，后端负责业务，外部系统接入封装在边界内。抽象服务于真实复用，业务代码不依赖具体模型厂商。
3. **一份事实、一套逻辑**：业务规则、校验和持久化由明确的所有者维护，各入口复用同一实现。学习资产由应用持久保存，不依赖模型历史。
4. **依赖正式交付**：成熟组件需要改动时，先明确范围，再在原组件中维护、测试和发布；应用通过固定版本升级使用，不依赖开发机私有路径、未发布改动或手工安装。
5. **换机仍然可用**：交付完整安装产物，明确运行前提。用干净环境验证安装后的真实功能，不把开发环境能运行当成交付完成。
6. **数据正确优先**：结构变更可追溯，写入有校验、事务和幂等保护；失败不污染数据，重试不重复执行已完成工作。旧能力只按用户批准的范围退役。
7. **边界可信**：外部输入先校验，类型保持准确，权限与任务归属由系统确认；保护凭据，不伪造身份、业务事实或成功结果。
8. **资源有始有终**：进程、会话和临时文件有明确所有者；任务有时间与资源边界，取消真正停止执行，收尾完成后再释放资源，不遗留后台任务。
9. **用户设置生效**：资源使用与任务难度匹配，尊重用户的选择和成本控制，不静默改变配置。故障给出可读错误，不用降级或假进度掩盖失败。
10. **用证据验收**：遵循项目统一门禁，测试真实业务边界和失败场景；区分受控测试、真实运行与交付验证，明确已完成、未验证和受限事项。

具体接口、表结构、参数、操作命令和排障记录放在对应代码、测试或专项文档中。只查阅当前任务需要的资料，不把实现细节和历史计划堆进工程原则。

---

## 6. 前端现代基建与组件选型铁律 (UI & State Infrastructure Invariants)

### 6.1 杜绝自建简陋玩具轮子 (Zero Hand-Rolled UI Toys)
- **全面对齐现代成熟组件生态**：禁止在业务组件中手写缺乏无障碍（WAI-ARIA）支持的简陋弹窗、原生丑陋 `<select>` 下拉框或生硬的进度条。
- **shadcn/ui (Base UI / Radix) 规范化**：
  - 基础交互组件全面依托 **shadcn/ui** 架构体系（支持并拥抱最新基于 **Base UI** 或 Radix Primitives 的现代化实现）；
  - 核心控件（`Select`、`Dialog`、`Popover`、`Tabs`、`Slider`、`Tooltip`、`Badge`）统一收归在 `apps/web/src/components/ui/`，具备完善的键盘导航、Focus Trap 与自动防滚动击穿。

### 6.2 Magic UI 增强优先原则 (Magic UI First Principle)
- **同根同源与交互升维**：Magic UI 与 shadcn 属于同一技术生态与设计哲学（React + Tailwind + Headless Primitives）。
- **适用场景优先采纳 Magic UI**：凡在涉及学习者仪式感、正向心理反馈（Delight UX）、高质感数据看板与发音纠音视觉呈现的场景，**优先采纳 Magic UI 改造或增强后的组件**（如 `BorderBeam` 流光边框、`BentoGrid` 学情仪表盘、`NumberTicker` 翻牌数字、`AnimatedBeam` 知识图谱连线、`ShimmerButton` 微光按钮等）。

### 6.3 严格区分两类状态架构 (Server State vs Client Persist State)
- **服务端/网关异步状态 (Server State) 归 TanStack Query**：
  - 教材课文树、用户学情画像、熟练度指标、错题本查询与自适应做题评测，统一使用 **TanStack Query (`@tanstack/react-query`)** 的 `useQuery` / `useMutation`；
  - 严格依托 QueryClient 进行缓存控制、后台自动重试与变更失效（`invalidateQueries`），**严禁手写 `useEffect` + `useState(loading)` 自建请求轮子**。
- **客户端偏好与本地状态 (Client State) 归 Zustand + `persist`**：
  - TTS 语音参数（男女声、语速、音色、自定义外挂端点）、主题明暗（Light/Dark）、盲听遮罩开关、假名注音开关、UI 导航状态，以及**阅读双栏宽度比（splitPaneRatio）**等布局偏好，统一使用 **Zustand 并启用 `persist` 中间件**；
  - 彻底杜绝在各个组件中到处分散编写 `localStorage.getItem/setItem` 胶水代码，保证多组件、跨标签页与未来 Tauri 桌面端的响应式自动持久化。

### 6.4 颜色、主题与动效统一使用 CSS token (Theme & Motion Tokens)
- **组件颜色只消费语义 token**：`apps/web` 的 TSX、inline style、SVG、Canvas 与第三方可视化配置中，禁止新增颜色字面量（HEX、RGB/HSL/OKLCH、CSS 命名色）或直接 Tailwind 调色板色值。颜色在 `apps/web/src/index.css` 定义为语义 CSS custom property，并在 `:root` 与 `.dark` 中分别给出亮色、暗色值；组件通过语义工具类或 `var(--...)` 使用。
- **非 CSS 绘制通过共享 token 读取器取值**：Canvas、Confetti 等 API 若要求具体颜色字符串，必须在触发绘制时通过 `apps/web/src/lib/css-tokens.ts` 读取当前主题下计算后的 CSS token，确保主题切换后跟随亮暗值。
- **视觉动画时间统一由 token 管理**：主题过渡使用 `--theme-transition-duration` 与 `--theme-transition-timing-function`；其他动画的时长、延迟和过渡节奏定义为 `--motion-*` token。TSX 不写数字时长；Framer Motion 等 JavaScript 动画 API 通过 `css-tokens.ts` 读取 token，CSS/Tailwind 动画直接引用 token。主题切换和 `prefers-reduced-motion` 遵循同一套全局变量。
- **区分视觉动效与业务时间**：录音时长、请求超时、轮询间隔、toast 展示时长等业务或提示行为继续由对应业务配置管理，不塞进视觉动效 token。
- **验收口径**：新增或修改 UI 动效时，检查 TSX 中无颜色字面量和数字动画时长；检查每个新增语义颜色在 `:root` 与 `.dark` 均有定义，并确认 Canvas/第三方绘制从当前主题读取颜色。

---

### 6.5 严禁在屎山代码上雕花与反上帝组件铁律 (Zero Polishing on Shit & Anti-God-Components)
- **单文件规模与单一职责硬指标**：
  - 单个 UI 组件文件（`.tsx`）代码规模原则上控制在 **300 行以内**，绝对禁止编写 500+ 行的“巨无霸/上帝组件”（God Component）；
  - 复杂交互流程（如教材导入、多步向导、题目批改等）必须严格遵循**分治架构**：
    1. 步进拆分：每个 Step 单独拆成独立子组件（如 `StepFileSelect`、`StepTocProbe`、`StepTocConfirm`、`StepPipelineProgress`）；
    2. 逻辑外置：多状态联动、API 调用与突变统一抽离到自定义 Hook（如 `useTextbookImportFlow`），UI 组件内只保留纯 JSX 视图与事件分发；
    3. 纯展示组件（Presentational）与容器组件（Container）解耦，禁止在展示层混入任何复杂的数据解析或猜测算法。
- **杜绝“屎上雕花”（No Patching on Broken Foundations）**：
  - 发现已有组件架构失范、逻辑冗余、状态混乱时，**坚决禁止通过新增一堆临时 `useState`、补丁式 `useEffect` 或局部正则去“雕花修补”**；
  - 必须对混乱代码大刀阔斧重构解耦，将其拆解为结构清晰的原子模块；凡是因“图省事”在巨型组件上继续堆砌面条代码的，一律视为严重架构违规。

---
