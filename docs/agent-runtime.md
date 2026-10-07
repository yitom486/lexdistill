# Lingua Studio - Agent 运行时架构规格说明书 (Agent Runtime Specification)

> **文档版本**：v1.0  
> **所属包定义**：`packages/agent-runtime`（`src/contracts` 接口抽象 ＋ `src/adapters` Codex/Responses 适配器）
> **核心原则**：核心领域与任何 AI SDK 物理隔离，Provider-Specific 代码 100% 封闭在 Adapter 内。

---

## 一、统一领域接口抽象 (`packages/agent-runtime/src/contracts`)

业务层只认识系统内部的核心抽象，绝不直接调用任何具体大模型厂商的 API。

```typescript
// 1. 统一 Adapter 契约
export interface AgentAdapter {
  readonly id: string;
  readonly name: string;

  createSession(params: CreateSessionParams): Promise<AgentSession>;
  resumeSession(sessionId: string): Promise<AgentSession>;
}

export interface CreateSessionParams {
  sessionId: string;
  userId: string;
  systemPrompt?: string;
  dynamicTools?: ToolDefinition[];
}

// 2. 统一 Session 契约
export interface AgentSession {
  readonly sessionId: string;

  /**
   * 发送消息并返回标准化事件流 (异步迭代器)
   */
  send(input: AgentInput): AsyncIterable<AgentEvent>;

  /**
   * 客户端或服务端工具执行完毕后，向 Agent 提交结果
   */
  submitToolResult(callId: string, result: unknown): Promise<void>;

  /**
   * 提交用户的授权审批决策
   */
  submitApproval(approvalId: string, approved: boolean): Promise<void>;

  /**
   * 打断当前生成轮次
   */
  interrupt(): Promise<void>;

  /**
   * 销毁并关闭会话
   */
  close(): Promise<void>;
}

// 3. 统一输入与不可变上下文快照
export interface AgentInput {
  message: string;
  contextSnapshot?: ContextSnapshot;
}

export interface ContextSnapshot {
  targetLanguage: 'ja' | 'en';
  learnerLevel: string;
  currentQuestion?: {
    id: string;
    content: string;
    correctAnswer: string;
    userAnswer?: string;
  };
  topWeaknesses?: string[];
  selectedWord?: string;
  metadata?: Record<string, unknown>;
}
```

---

## 二、标准化事件流定义 (`AgentEvent`)

外部 Provider 返回的各种异构流式协议，均由 Adapter 归一化为如下事件：

```typescript
export type AgentEvent =
  | { type: 'TEXT_DELTA'; delta: string }
  | { type: 'REASONING_STARTED' }
  | { type: 'REASONING_DELTA'; delta: string }
  | { type: 'REASONING_COMPLETED' }
  | { type: 'TOOL_CALL_REQUESTED'; callId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'TOOL_CALL_COMPLETED'; callId: string; result: unknown }
  | { type: 'APPROVAL_REQUESTED'; approvalId: string; action: string; description: string; riskLevel: string }
  | { type: 'ERROR'; error: { code: string; message: string; details?: unknown } }
  | { type: 'COMPLETED'; finalOutput?: string; tokenUsage?: { total: number } };
```

---

## 三、CodexAdapter 原生对接实现机制 (`packages/agent-runtime/src/adapters/codex`)

第一阶段首要集成的 Agent 引擎是 **Codex App Server**。我们坚决拒绝用阉割的通用协议折损 Codex 的原生威力，而是通过 `CodexAdapter` 深度映射其特有能力：

```
┌──────────────────────────────────────┐          ┌──────────────────────────────────────┐
│        Codex App Server 原生机制      │          │       Lingua Studio 统一抽象          │
├──────────────────────────────────────┤          ├──────────────────────────────────────┤
│ Thread                               │ ◄──────► │ AgentSession                         │
│ Turn                                 │ ◄──────► │ 单次 send() 轮次周期                  │
│ Item: type: "message"                │ ◄──────► │ AgentEvent.TEXT_DELTA                │
│ Item: type: "reasoning"              │ ◄──────► │ AgentEvent.REASONING_DELTA           │
│ Item: type: "dynamic_tool_call"      │ ◄──────► │ AgentEvent.TOOL_CALL_REQUESTED       │
│ Server-side Tool Approval Intercept  │ ◄──────► │ AgentEvent.APPROVAL_REQUESTED        │
│ Sandbox (文件与命令隔离沙箱)          │ ◄──────► │ 网关权限拦截与安全沙盒隔离           │
└──────────────────────────────────────┘          └──────────────────────────────────────┘
```

### 3.1 核心对接关键流程
1. **Thread 绑定**：
   - 学习会话创建时，`CodexAdapter` 调用 Codex App Server 的 `createThread` 接口建立专属线程上下文；
   - 用户做题过程的多轮答疑均挂载在同一 Thread 下，保持上下文记忆连贯。
2. **动态工具注入 (Dynamic Tools)**：
   - `CodexAdapter` 在发起 Turn 时，将网关 Tool Registry 中的出题、批改、词典 Schema 转换为 Codex 原生的 `dynamic_tools` 声明；
   - Codex App Server 直接感知系统工具并按需发起 `tool_call`，完全绕过手工拼装 prompt 的不确定性。
3. **安全沙箱与审批拦截 (Approvals)**：
   - 当 Agent 产生潜在破坏性动作时（如请求删除某一分类下的所有错题），触发 Codex 原生审批流；
   - `CodexAdapter` 拦截该事件并生成内部 `APPROVAL_REQUESTED`，经 Gateway 转发至前端弹出弹窗供用户确认。

---

## 四、未来 Adapter 扩展体系

本架构预留了无缝横向扩展能力，新增任何模型仅需实现 `AgentAdapter` 接口，领域业务代码零修改：

1. **`ResponsesAdapter` (轻量快模)**：
   - 针对“这个生词怎么读”、“单选客观题快速解析”等低复杂度场景；
   - 直接调用单次轻量大模型 API，成本更低，首字输出延迟小于 200ms。
2. **`ACPAdapter` (兼容第三方 Agent 协议，可选)**：
   - 接入兼容 Agent Client Protocol (ACP) 的外部智能体；实现必须封闭在独立 Adapter 包内，经 Gateway 路由选用。
   - **不得**用 ACP 阉割或替代 Codex App Server 原生通路；学习闭环默认仍走 Codex 原生 Tool。
   - 工具调用优先映射为本系统 `tool-core` 原生执行；**禁止**把本域 Server Tools 无故改道 MCP 多跳一次。
3. **`LocalModelAdapter` (离线大模型)**：
   - 基于本地 Ollama / Llama.cpp 运行的模型，供用户在无网环境下进行离线词汇复习与批改。

### 工具通道优先级 (与 AGENTS.md 1.6 对齐)
1. **最高优先**：引擎原生 dynamic tool / function call → Gateway `ToolRouter` → `tool-core` 注册工具。
2. **最低优先 / 可选**：MCP，仅用于 Anki、Notion 等外部异构系统，不得成为学习域默认总线。

### 新工具上线门禁（强制）
任何新 Tool 在 `registerGatewayTools`（或各域 `registerXTools`）注册上线前，必须配齐以下测试，缺一不可：
1. **schema 拒绝测试**：`safeParse` 非法输入（空必填、越界枚举、超长/超量）必须失败；
2. **真仓储 round-trip**：`new XxxTool(new DrizzleLearnerRepository(':memory:')).execute()` 落库可回读；
3. **元数据锁定**：`name/location/permission` 断言（CLIENT 工具还要断言网关侧无副作用、只回显）；
4. **降级语义**（如有）：缺 adapter / 缺登录时必须显式报错（`E_*_NO_ADAPTER`），禁止静默编造。
5. **选型登记**：需进入回合子集或固定任务的工具，必须在 `runtime/router/tool-catalog.ts` 登记（hint 表或 `TASK_TOOL_PRESETS`），不得只在前端 `agentOptions.tools` 写字面量；教材 MCP 服务器形状/命名改动必须走 `modules/library/mcp/textbook-mcp-catalog.ts` 并同步其测试。
参考样例：`apps/gateway/src/__tests__/ui-command-tools.test.ts`（Client Tool）、`apps/gateway/src/modules/library/__tests__/knowledge-points.test.ts`（Server Tool + 真仓储）。
