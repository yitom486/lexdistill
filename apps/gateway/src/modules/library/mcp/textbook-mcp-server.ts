/**
 * 教材 MCP 服务（标准 @modelcontextprotocol/sdk，不自写协议）。
 *
 * 挂载：Hono `POST|GET|DELETE /mcp/textbook/:taskToken/w/:workerIndex`，
 * 每个任务每个 Worker 一个独立端点 + 独立 McpServer/transport 实例。
 * 任务结束即删实例，其后请求 404；取消即撤销作用域，残留调用被拒绝。
 *
 * 工具清单只映射正文六类内容工具；模型侧看到的工具名以 MCP 声明为准
 *（`write_grammar` 等），与原生 `library.*` 名称解耦。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  TextbookContentOperationSchemas,
  type TextbookContentKind,
} from '@lexdistill/document-model';
import { BusinessError, err, translateToBusinessError, type Result } from '@lexdistill/shared';
import type { BufferedContentReceipt } from '../tools/lesson-content-buffer.js';
import { McpChapterScope, type McpChapterAssignment } from './textbook-mcp-scope.js';
import type { ContentRepository } from '../ports.js';

const TOOL_NAMES: Record<TextbookContentKind, string> = {
  grammar: 'write_grammar',
  vocabulary: 'write_vocabulary',
  exercises: 'write_exercises',
  articles: 'write_articles',
  sentences: 'write_sentences',
  material: 'write_material',
};

const TOOL_DESCRIPTIONS: Record<TextbookContentKind, string> = {
  grammar: '提交本章知识点、用法或发音知识（title/explanation/examples）。只填写内容。',
  vocabulary: '提交本章词汇（word/reading/meaning/level 等；可选 usage 本课用法、contextNote 本课取义说明）。只填写内容。',
  exercises: '提交本章练习（type/prompt/answer 等）。只填写内容，新增练习标注 source=AI。',
  articles: '提交本章完整文章或会话（text/translation）。若内容为会话对白，正文按每行「说话人：台词」标准格式保留角色名（如「ミラー：...」），译文按对应的「说话人：译文」逐行对齐，以便系统进行角色切片与双角色朗读。没有文章不用调用。',
  sentences: '提交本章可独立学习的句子或单句对白。若为对话，可填写 speaker（说话人姓名或身份）。没有句子不用调用。',
  material: '提交本章的一份整理材料（text）。没有材料不用调用。',
};

type RpcId = string | number;

export interface McpTextbookEndpointDeps {
  repo: ContentRepository;
  onToolCall?: (info: { taskToken: string; workerIndex: number; tool: string; lessonId: string }) => void;
}

interface WorkerEndpoint {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  /** 当前章节作用域；只在 ask 间隙切换。 */
  current: McpChapterScope | null;
  assignment: McpChapterAssignment | null;
}

interface TaskEntry {
  userId: string;
  documentId: string;
  workers: WorkerEndpoint[];
  revoked: boolean;
}

/** 任务级 MCP 注册表：端点隔离＋作用域切换＋任务结束清理。 */
export class TextbookMcpRegistry {
  private readonly tasks = new Map<string, TaskEntry>();

  constructor(private readonly deps: McpTextbookEndpointDeps) {}

  /** 建任务：生成不可猜 token 与每 Worker 独立端点。返回各 Worker 的相对路径。 */
  createTask(userId: string, documentId: string, workerCount: number): { taskToken: string; workerPaths: string[] } {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const taskToken = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const workers: WorkerEndpoint[] = [];
    const workerPaths: string[] = [];
    for (let index = 0; index < workerCount; index++) {
      const server = new McpServer({ name: 'lingua-textbook', version: '1.0.0' });
      // 有状态会话：同一 Worker 的多次 MCP 请求共用一个 transport，必须启用
      // sessionIdGenerator，否则无状态复用会导致消息 ID 碰撞，客户端建连后
      // 拿不到稳定会话，tools/list 永远到不了。
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      const entry: WorkerEndpoint = { server, transport, current: null, assignment: null };
      this.registerTools(entry, taskToken, index);
      workers.push(entry);
      workerPaths.push(`/mcp/textbook/${taskToken}/w/${index}`);
    }
    this.tasks.set(taskToken, { userId, documentId, workers, revoked: false });
    void serverConnectAll(workers);
    return { taskToken, workerPaths };
  }

  /** ask 间隙把某 Worker 切到新章节作用域；旧作用域同时撤销。 */
  setChapter(taskToken: string, workerIndex: number, assignment: McpChapterAssignment): McpChapterScope | undefined {
    const task = this.tasks.get(taskToken);
    if (!task || task.revoked) return undefined;
    if (assignment.userId !== task.userId || assignment.documentId !== task.documentId) return undefined;
    const worker = task.workers[workerIndex];
    if (!worker) return undefined;
    worker.current?.revoke();
    const scope = new McpChapterScope(this.deps.repo, assignment);
    worker.current = scope;
    worker.assignment = assignment;
    return scope;
  }

  /** 测试/诊断接缝：取某 Worker 当前作用域（生产按 ask 间隙推进）。 */
  getScope(taskToken: string, workerIndex: number): McpChapterScope | undefined {
    const task = this.tasks.get(taskToken);
    const worker = task && !task.revoked ? task.workers[workerIndex] : undefined;
    return worker?.current ?? undefined;
  }

  revokeTask(taskToken: string): void {
    const task = this.tasks.get(taskToken);
    if (!task) return;
    task.revoked = true;
    for (const worker of task.workers) worker.current?.revoke();
    this.tasks.delete(taskToken);
  }

  /** Hono 入口：按路径定位端点实例并委托 SDK transport。 */
  async handleRequest(taskToken: string, workerIndex: number, req: Request): Promise<Response> {
    const task = this.tasks.get(taskToken);
    const worker = task && !task.revoked ? task.workers[workerIndex] : undefined;
    if (!worker) return Response.json({ error: '未知的教材任务端点' }, { status: 404 });
    try {
      return await worker.transport.handleRequest(req);
    } catch (cause) {
      const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'TOOL_EXECUTION', fallbackMessage: '教材工具服务异常' });
      return Response.json({ error: error.userMessage, code: error.code }, { status: 500 });
    }
  }

  private registerTools(entry: WorkerEndpoint, taskToken: string, workerIndex: number): void {
    for (const kind of Object.keys(TOOL_NAMES) as TextbookContentKind[]) {
      // 操作 schema 带 superRefine（ZodEffects）：取内层 object 的 shape 做模型可见声明，
      // 跨包实例时避免 instanceof z.ZodEffects 失效；完整校验仍在 handler 内用原 schema 执行。
      const operation = TextbookContentOperationSchemas[kind];
      const inner =
        '_def' in operation &&
        (operation._def as { typeName?: string }).typeName === 'ZodEffects' &&
        'innerType' in operation &&
        typeof (operation as { innerType?: unknown }).innerType === 'function'
          ? (operation as { innerType: () => unknown }).innerType()
          : operation;
      const shape = (inner as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
      entry.server.registerTool(
        TOOL_NAMES[kind],
        { description: TOOL_DESCRIPTIONS[kind], inputSchema: shape },
        async (args: Record<string, unknown>, extra?: { requestId?: unknown; signal?: AbortSignal }) => {
          const outcome = await this.executeTool(taskToken, workerIndex, kind, args, extra);
          if (!outcome.ok) {
            return { content: [{ type: 'text' as const, text: outcome.error.userMessage }], isError: true };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(outcome.value) }] };
        },
      );
    }
  }

  private async executeTool(
    taskToken: string,
    workerIndex: number,
    kind: TextbookContentKind,
    args: Record<string, unknown>,
    extra?: { requestId?: unknown; signal?: AbortSignal },
  ): Promise<Result<BufferedContentReceipt, BusinessError>> {
    const task = this.tasks.get(taskToken);
    const worker = task && !task.revoked ? task.workers[workerIndex] : undefined;
    // 入场瞬间捕获不可变快照；其后切换/撤销不再影响本次判定。
    const snapshot = worker?.current?.snapshot();
    const scope = worker?.current;
    if (!task || !worker || !scope || !snapshot) {
      return err(new BusinessError('E_SUBMISSION_SCOPE_INVALID', '本次课程处理已经结束，迟到调用已拒绝', 'VALIDATION'));
    }
    if (extra?.signal?.aborted) {
      return err(new BusinessError('E_CANCELLED', '本次课程处理已经结束，迟到调用已拒绝', 'VALIDATION'));
    }
    if (!scope.isCurrent(snapshot)) {
      return err(new BusinessError('E_SUBMISSION_SCOPE_INVALID', '本次课程处理已经结束，迟到调用已拒绝', 'VALIDATION'));
    }
    const rpcId = typeof extra?.requestId === 'string' || typeof extra?.requestId === 'number' ? (extra.requestId as RpcId) : null;
    const result = await scope.submission.execute(kind, args, rpcId);
    if (!result.ok) return result;
    // 执行收尾复核：处理期间被撤销/切换，本次结果作废（不污染）。
    if (!scope.isCurrent(snapshot)) {
      return err(new BusinessError('E_SUBMISSION_SCOPE_INVALID', '本次课程处理已经结束，迟到调用已拒绝', 'VALIDATION'));
    }
    this.deps.onToolCall?.({ taskToken, workerIndex, tool: TOOL_NAMES[kind], lessonId: scope.assignment.lessonId });
    return result;
  }
}

async function serverConnectAll(workers: WorkerEndpoint[]): Promise<void> {
  for (const worker of workers) {
    try {
      await worker.server.connect(worker.transport);
    } catch {
      // 连接失败在首次 handleRequest 时按端点错误返回，不提前抛。
    }
  }
}
