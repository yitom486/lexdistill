# Lingua Studio - 客户端与网关通信协议规范 (Protocol Specification)

> **文档版本**：v1.0  
> **通信介质**：WebSocket (主实时双向通道) + HTTP/JSON (基础资源与静态数据)  
> **数据格式**：UTF-8 JSON  
> **所属包定义**：`packages/protocol`

---

## 教材导入监视（2026-10-01）

所有接口位于本机 Gateway，桌面不直接读取 SQLite。目录定位、目录模型、独立目录保存及正文 job 使用 `traceId` 关联；PDF 目录请求使用 `X-Textbook-Trace`，正文启动体和快照保留 trace。

- `GET /api/documents/:userId/textbook-imports/:traceId?after=<sequence>`：分页元数据（最多 200 项）、cursor 和可选缺失警告。
- `GET .../:traceId/details/:sequence`：读取单项实际 payload。
- `GET .../:traceId/events`：`monitor.event` SSE（id=sequence）；初连 after、重连 Last-Event-ID，客户端按 sequence 去重；`monitor.warning` 报告记录不完整。
- `GET /api/documents/:userId/textbook-saved/:documentId/:nodeId`：`SavedTextbookContentSchema`，当前 AST 内容、节点标题/状态、祖先与子目录、派生行 counts 及 readAt；区别于历史候选和回执。

查询按用户与 trace 过滤；正文内容还核对文档归属。进度快照及取消同样核对 job.userId。详情采用 `packages/document-model` 的 ImportEvent 契约，不在每次进度快照复制长文本。

章节阶段使用 `TextbookLessonStageSchema`：`ocr/queued/extracting/validating/correcting/model_retrying/saving/storage_retrying/saved/failed`。首响应/无活动期限属于 `TextbookPipelineSettingsSchema`，模型超时中断当前尝试并拒绝迟到工具；临时数据库失败只重试已校验候选。工具执行上下文保留实际 `turnId/callId`，提交校验不替换错误身份。

## 一、协议信封规范 (Message Envelope)

所有通过 WebSocket 传输的消息均采用统一标准的信封（Envelope）包裹。

```typescript
export interface WsEnvelope<T = unknown> {
  version: '1.0';                  // 协议版本
  id: string;                      // 消息全局唯一标识符 (UUIDv4)
  sessionId: string;               // 学习会话 ID
  turnId?: string;                 // 对话/练习轮次 ID (可选)
  type: WsEventType;               // 强类型事件名称
  payload: T;                      // 实际业务载荷 (符合对应 Schema)
  timestamp: number;               // 毫秒级时间戳
  error?: WsErrorPayload;          // 错误信息 (发生异常时附带)
}

export interface WsErrorPayload {
  code: string;                    // 错误代码 (如 'E_INVALID_PAYLOAD', 'E_TIMEOUT')
  message: string;                 // 人类可读错误描述
  details?: unknown;               // 调试与上下文补充数据
}
```

---

## 二、事件全生命周期与方向定义

### 2.1 客户端 -> 网关 (Client-to-Gateway) 事件

| 事件名称 (`type`) | 触发场景 | 典型载荷 (`payload`) 结构 |
| :--- | :--- | :--- |
| `client.session.init` | 建立连接后初始化学习会话 | `{ userId: string, targetLanguage: 'ja' \| 'en', targetLevel: string }` |
| `client.turn.send` | 发起提问、请求 AI 出题或深度解析 | `{ input: string, contextSnapshot?: ContextSnapshot }` |
| `client.quiz.submit` | 提交题目作答 | `{ questionId: string, answer: string, timeSpentSeconds: number }` |
| `client.card.review` | 提交卡片复习评级 (FSRS) | `{ cardId: string, rating: 'AGAIN' \| 'HARD' \| 'GOOD' \| 'EASY' }` |
| `client.tool.result` | 客户端本地工具执行完成回传 | `{ callId: string, success: boolean, result: unknown, error?: string }` |
| `client.approval.respond`| 用户对敏感操作做出授权响应 | `{ approvalId: string, approved: boolean }` |
| `client.turn.interrupt` | 用户主动打断当前 Agent 流式输出 | `{ turnId: string }` |
| `client.ping` | 心跳保活探测 | `{ clientTimestamp: number }` |

### 2.2 网关 -> 客户端 (Gateway-to-Client) 事件

| 事件名称 (`type`) | 触发场景 | 典型载荷 (`payload`) 结构 |
| :--- | :--- | :--- |
| `agent.turn.start` | 新一轮思考/出题/批改轮次开始 | `{ turnId: string, intent: 'GENERATE_QUIZ' \| 'GRADE' \| 'EXPLAIN' }` |
| `agent.text.delta` | AI 流式文本增量块 (批改解析、建议) | `{ turnId: string, delta: string }` |
| `agent.tool.call` | 网关指令客户端执行本地 Client Tool | `{ callId: string, toolName: string, args: Record<string, unknown> }` |
| `agent.approval.request`| 触发敏感权限申请，等待用户在 UI 确认 | `{ approvalId: string, action: string, description: string, risk: string }` |
| `agent.turn.completed` | 轮次全部完成（包含最终评分卡/试题） | `{ turnId: string, finalData?: unknown, usage?: { tokens: number } }` |
| `agent.error` | 生成或执行中发生异常 | `{ code: string, message: string, retryable: boolean }` |
| `learner.profile.updated`| 学习者优势或薄弱项指标发生变动 | `{ updatedMetrics: SkillMetric[], snapshot: LearnerProfileSnapshot }` |
| `learner.mistake.added` | 新错题已自动入库通知 | `{ mistake: MistakeEntry }` |
| `gateway.pong` | 心跳保活响应 | `{ serverTimestamp: number }` |

---

## 三、核心业务载荷规范 (Payload Schemas)

### 3.1 客户端做题提交与批改响应载荷
```typescript
// 1. client.quiz.submit 载荷
export interface ClientQuizSubmitPayload {
  questionId: string;
  userSubmission: string;          // 选项键名如 "B" 或主观翻译文本
  timeSpentMs: number;
}

// 2. agent.turn.completed (当属于批改时) 附带的最终结构化评分卡
export interface QuizGradingResultPayload {
  questionId: string;
  isCorrect: boolean;
  score: number;                   // 0 ~ 100
  correctAnswer: string;
  explanation: string;
  errorDiagnosis?: {
    category: 'PARTICLE' | 'TENSE' | 'WORD_CHOICE' | 'SYNTAX' | 'COLLOCATION' | 'OTHER';
    description: string;
    motherTongueInterference?: string;
  };
  refinementSuggestion?: string;   // 地道表达提升
  mistakeRecorded: boolean;        // 是否已被持久化进错题本
}
```

### 3.2 AI 靶向出题载荷
```typescript
// 针对弱项出题的返回载荷 (包含在 agent.turn.completed 中)
export interface GeneratedQuestionPayload {
  id: string;
  type: 'MULTIPLE_CHOICE' | 'FILL_IN_BLANK' | 'TRANSLATION';
  prompt: string;                  // 题目指示
  content: string;                 // 题干主句
  options?: string[];              // 选择题选项
  correctAnswer: string;           // 标准答案
  acceptableVariants?: string[];   // 允许的变体答案
  testedSkillId: string;           // 考查的薄弱技能标签
  explanation: string;             // 语法剖析
}
```

---

## 四、错误码与异常恢复机制

### 4.1 标准错误代码表

| 错误代码 | 含义 | 客户端推荐处置策略 |
| :--- | :--- | :--- |
| `E_AUTH_FAILED` | 会话未通过认证或无效 | 重新发起会话初始化握手 |
| `E_INVALID_PAYLOAD` | 载荷未通过 Zod 校验 | 检查客户端序列化逻辑，打断轮次 |
| `E_TOOL_TIMEOUT` | Client Tool 未在超时时间内返回 | 网关取消等待，标记工具调用超时 |
| `E_AGENT_BUSY` | 当前 Session 已有正在运行的 Turn | 提示用户“AI 正在思考中，请稍候” |
| `E_PROVIDER_DOWN` | 底层 Agent / Codex 服务无响应 | 启用降级模式（如使用离线标准规则比对） |

### 4.2 丢包与网络重连机制
1. **客户端心跳**：每隔 15 秒发送一次 `client.ping`，若超过 30 秒未收到 `gateway.pong`，判定连接假死。
2. **断线恢复**：
   - 客户端重连成功后，发送带有原 `sessionId` 的 `client.session.init`。
   - 网关维护近期未完结 Turn 的事件缓冲区（Event Buffer），按需执行事件补发。
