import { CodexAdapter } from '@study-studio/agent-runtime';
import { ToolLocations, type ToolRegistry } from '@study-studio/tool-core';
import { WsEventTypes, type WsEnvelope } from '@study-studio/protocol';
import { BusinessError, generateId, isOk } from '@study-studio/shared';

/**
 * Agent 装配契约（composition 层 DI 工厂）。
 *
 * GatewayServer 不再自己 `new CodexAdapter`：Adapter 的创建权收归装配根
 *（bootstrap/create-gateway.ts 显式注入默认工厂），Server 只声明“给我一个工厂”的类型口。
 * 本模块是无网关内部依赖的装配叶子（仅依赖跨包契约），runtime 引用它不形成倒挂
 *（见 module-boundaries G5；禁的是 runtime→bootstrap / modules→runtime）。
 *
 * 鸡蛋问题说明：executeTool 闭包调用时才读 toolRegistry，
 * 因此工厂在构造期即可创建 Adapter，不存在初始化顺序死锁（原 P6-3 语义保留）。
 */
export interface AgentFactoryDeps {
  toolRegistry: ToolRegistry;
  /** 回读当前 Turn 的 WS 下发器（调用时求值，不得在构造期快照）。 */
  getActiveTurnEmit: () => ((env: WsEnvelope) => void) | undefined;
  /** 转发 App Server 旁路通知（queue/changed、skills/changed、realtime.*）。 */
  onNotification: (method: string, params: unknown) => void;
}

export type AgentAdapterFactory = (deps: AgentFactoryDeps) => CodexAdapter;

/**
 * 生产默认工厂：把原来 GatewayServer 构造函数里的 `new CodexAdapter({...})`
 * 整段搬到这里，行为一字不变（含 Client Tools 经 WS 下发）。
 * 各领域模块仍经 ToolRegistry 按工具名订阅，不持有 Adapter 实例。
 */
export function createDefaultAgentAdapterFactory(): AgentAdapterFactory {
  return ({ toolRegistry, getActiveTurnEmit, onNotification }: AgentFactoryDeps) =>
    new CodexAdapter({
      executeTool: async (toolName, input, ctx) => {
        const tool = toolRegistry.get(toolName);
        if (!tool) {
          throw new BusinessError('E_TOOL_NOT_FOUND', `未注册工具：${toolName}`, 'TOOL_EXECUTION');
        }
        const res = await tool.execute(input as never, {
          userId: ctx.userId,
          sessionId: ctx.sessionId,
        });
        if (!isOk(res)) {
          throw res.error;
        }
        // Client Tools：进程内校验参数后，经 WS 下发前端执行
        const activeTurnEmit = getActiveTurnEmit();
        if (tool.location === ToolLocations.CLIENT && activeTurnEmit) {
          activeTurnEmit({
            version: '1.0',
            id: generateId('tool'),
            sessionId: ctx.sessionId,
            type: WsEventTypes.AGENT_TOOL_CALL,
            payload: {
              callId: generateId('call'),
              toolName: tool.name,
              args: res.value,
            },
            timestamp: Date.now(),
          });
        }
        return res.value;
      },
      onNotification,
    });
}
