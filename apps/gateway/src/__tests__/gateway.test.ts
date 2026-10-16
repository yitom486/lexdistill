import { describe, expect, it } from 'bun:test';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { WsEventTypes, type WsEnvelope } from '@lexdistill/protocol';
import { isOk, isErr } from '@lexdistill/shared';

describe('Gateway Server - Pipeline & Session', () => {
  it('should initialize session on client.session.init', async () => {
    const gateway = new GatewayServer();
    const envelope: WsEnvelope = {
      version: '1.0',
      id: 'msg_init',
      sessionId: 'pending',
      type: WsEventTypes.CLIENT_SESSION_INIT,
      payload: {
        userId: 'user_007',
        targetLanguage: 'ja',
        targetLevel: 'N3',
      },
      timestamp: Date.now(),
    };

    const res = await gateway.handleClientMessage(envelope);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.type).toBe(WsEventTypes.AGENT_TURN_COMPLETED);
      expect(res.value.sessionId.startsWith('sess_')).toBe(true);
    }
  });

  it('should respond to ping with pong', async () => {
    const gateway = new GatewayServer();
    const envelope: WsEnvelope = {
      version: '1.0',
      id: 'msg_ping',
      sessionId: 'sess_1',
      type: WsEventTypes.CLIENT_PING,
      payload: {},
      timestamp: Date.now(),
    };

    const res = await gateway.handleClientMessage(envelope);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.type).toBe(WsEventTypes.GATEWAY_PONG);
    }
  });

  it('should return BusinessError on unsupported event', async () => {
    const gateway = new GatewayServer();
    const envelope: WsEnvelope = {
      version: '1.0',
      id: 'msg_unknown',
      sessionId: 'sess_1',
      // @ts-expect-error testing invalid type
      type: 'client.invalid.event',
      payload: {},
      timestamp: Date.now(),
    };

    const res = await gateway.handleClientMessage(envelope);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_UNSUPPORTED_EVENT');
      expect(res.error.userMessage).toContain('暂不支持');
    }
  });
});
