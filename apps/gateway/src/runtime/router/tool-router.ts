import {
  type ToolRegistry,
  type ToolExecutionContext,
} from '@study-studio/tool-core';
import {
  ok,
  err,
  type Result,
  BusinessError,
} from '@study-studio/shared';

export interface ClientToolDispatcher {
  dispatchClientTool(callId: string, toolName: string, args: unknown): Promise<Result<unknown, BusinessError>>;
}

export class ToolRouter {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly clientDispatcher?: ClientToolDispatcher
  ) {}

  public async routeAndExecute(
    toolName: string,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<Result<unknown, BusinessError>> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return err(
        new BusinessError('E_TOOL_UNKNOWN', `未知工具调用 [${toolName}]`, 'TOOL_EXECUTION')
      );
    }

    // 1. 服务端本地工具
    if (tool.location === 'SERVER') {
      return this.registry.execute(toolName, args, context);
    }

    // 2. 客户端工具 (通过 WebSocket 下发至 Web 客户端执行)
    if (tool.location === 'CLIENT') {
      if (!this.clientDispatcher) {
        return err(
          new BusinessError(
            'E_CLIENT_DISPATCHER_UNAVAILABLE',
            '当前未连接客户端，无法执行客户端操作。',
            'TOOL_EXECUTION'
          )
        );
      }
      return this.clientDispatcher.dispatchClientTool('call_' + Date.now(), toolName, args);
    }

    // 3. 外部工具 (MCP)
    return err(
      new BusinessError('E_MCP_NOT_IMPLEMENTED', '外部 MCP 工具通道正在准备中。', 'TOOL_EXECUTION')
    );
  }
}
