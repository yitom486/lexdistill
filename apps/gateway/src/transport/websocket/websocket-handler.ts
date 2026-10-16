import type { ServerWebSocket } from 'bun';
import { isOk, generateId } from '@lexdistill/shared';
import { WsEventTypes, type WsEnvelope } from '@lexdistill/protocol';
import type { GatewayServer } from '../../runtime/gateway-runtime.js';

export interface GatewayWsData {
  sessionId?: string | undefined;
}

/**
 * WS 协议收发（G2：由 index.ts 内联 handler 迁移而来，行为不变）。
 * 只做信封解析与事件转发，业务经 GatewayServer.handleClientMessage 调度。
 */
export function createWebsocketHandlers(server: GatewayServer) {
  return {
    open(_ws: ServerWebSocket<GatewayWsData>) {
      console.log(`[Gateway WS] Client connected`);
    },
    async message(ws: ServerWebSocket<GatewayWsData>, message: string | Buffer) {
      try {
        const raw = typeof message === 'string' ? message : message.toString();
        const envelope = JSON.parse(raw) as WsEnvelope;
        if (envelope.sessionId) {
          ws.data.sessionId = envelope.sessionId;
        }

        const isStreamingTurn =
          envelope.type === WsEventTypes.CLIENT_TURN_SEND ||
          envelope.type === WsEventTypes.CLIENT_QUEUE_START;
        const res = await server.handleClientMessage(envelope, (outEnv) => {
          if (outEnv.sessionId) {
            ws.data.sessionId = outEnv.sessionId;
          }
          ws.send(JSON.stringify(outEnv));
        });
        if (isOk(res)) {
          if (res.value.sessionId) {
            ws.data.sessionId = res.value.sessionId;
          }
          if (!isStreamingTurn) {
            ws.send(JSON.stringify(res.value));
          }
        } else {
          const errorEnvelope: WsEnvelope = {
            version: '1.0',
            id: generateId('err'),
            sessionId: envelope.sessionId,
            type: WsEventTypes.AGENT_ERROR,
            payload: {
              error: {
                code: res.error.code,
                userMessage: res.error.userMessage,
                category: res.error.category,
                retryable: res.error.retryable,
              },
            },
            timestamp: Date.now(),
          };
          ws.send(JSON.stringify(errorEnvelope));
        }
      } catch (e) {
        console.error('[Gateway WS] Failed to process message:', e);
        const errorEnvelope: WsEnvelope = {
          version: '1.0',
          id: generateId('err'),
          sessionId: 'ws_err',
          type: WsEventTypes.AGENT_ERROR,
          payload: {
            error: {
              code: 'E_WS_INTERNAL',
              userMessage: '系统通信遇到了微小波动，正在自动恢复…',
              category: 'NETWORK',
              retryable: true,
            },
          },
          timestamp: Date.now(),
        };
        ws.send(JSON.stringify(errorEnvelope));
      }
    },
    close(ws: ServerWebSocket<GatewayWsData>) {
      server.unregisterSessionEmit(ws.data.sessionId);
      console.log(`[Gateway WS] Client disconnected`);
    },
  };
}
