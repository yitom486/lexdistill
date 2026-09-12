import { describe, expect, test, afterEach } from 'bun:test';
import {
  GATEWAY_INTERRUPTED_CODE,
  GATEWAY_INTERRUPTED_MESSAGE,
  GATEWAY_NO_RESPONSE_MESSAGE,
  GATEWAY_UNREACHABLE_CODE,
  GatewayRequestError,
  isGatewayNoResponseError,
  mapTransportInterruption,
  probeGatewayBootId,
  readGatewayErrorCode,
  readGatewayErrorDetails,
  readGatewayUserMessage,
} from '../gateway-error.js';

const FALLBACK = 'PDF 导入失败（HTTP 400）';

describe('readGatewayUserMessage', () => {
  test('嵌套信封优先：真实网关 400 不再变成 HTTP 400', () => {
    const payload = {
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        userMessage: '本书 371 页需 OCR（单次上限 30 页），请按课分段选页导入',
        category: 'VALIDATION',
        retryable: false,
      },
    };
    expect(readGatewayUserMessage(payload, FALLBACK)).toBe(
      '本书 371 页需 OCR（单次上限 30 页），请按课分段选页导入'
    );
    expect(readGatewayUserMessage(payload, FALLBACK)).not.toContain('HTTP 400');
  });

  test('旧顶层形状仍兼容', () => {
    expect(readGatewayUserMessage({ userMessage: '旧文案' }, FALLBACK)).toBe('旧文案');
  });

  test('无字段/空串/垃圾输入走 fallback', () => {
    expect(readGatewayUserMessage({ success: false, error: { code: 'E_X' } }, FALLBACK)).toBe(FALLBACK);
    expect(readGatewayUserMessage({ error: { userMessage: '   ' } }, FALLBACK)).toBe(FALLBACK);
    expect(readGatewayUserMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(readGatewayUserMessage('boom', FALLBACK)).toBe(FALLBACK);
  });

  test('嵌套优先于顶层', () => {
    const payload = { userMessage: '顶层旧文案', error: { userMessage: '嵌套新文案' } };
    expect(readGatewayUserMessage(payload, FALLBACK)).toBe('嵌套新文案');
  });

  test('code/details 读取器与缺席收敛', () => {
    const payload = {
      success: false,
      error: { code: 'E_INVALID_INPUT', userMessage: '超限', details: { suggestedEndPage: 30 } },
    };
    expect(readGatewayErrorCode(payload)).toBe('E_INVALID_INPUT');
    expect(readGatewayErrorDetails(payload)).toEqual({ suggestedEndPage: 30 });
    expect(readGatewayErrorCode({})).toBeUndefined();
    expect(readGatewayErrorDetails({})).toBeUndefined();
  });
});

describe('isGatewayNoResponseError（无响应转中文，不再 Failed to fetch）', () => {
  test('英文无响应失败全识别', () => {
    expect(isGatewayNoResponseError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isGatewayNoResponseError(new Error('Load failed'))).toBe(true);
    expect(isGatewayNoResponseError(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isGatewayNoResponseError('fetch failed')).toBe(true);
  });

  test('普通错误与网关信封不误判', () => {
    expect(isGatewayNoResponseError(new Error('boom'))).toBe(false);
    expect(isGatewayNoResponseError(null)).toBe(false);
    expect(isGatewayNoResponseError({ success: false, error: { userMessage: '超限' } })).toBe(false);
  });

  test('固定中文案含重启与页码指引', () => {
    expect(GATEWAY_NO_RESPONSE_MESSAGE).toContain('网关没有响应');
    expect(GATEWAY_NO_RESPONSE_MESSAGE).toContain('重启网关');
    expect(GATEWAY_NO_RESPONSE_MESSAGE).toContain('指定页码');
    expect(GATEWAY_NO_RESPONSE_MESSAGE).not.toContain('Failed to fetch');
  });
});

describe('probeGatewayBootId / mapTransportInterruption（重启中断显式化）', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubHealth(payload: unknown, status = 200): string[] {
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    return seen;
  }

  function stubDead(): void {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      void input;
      void init;
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
  }

  test('网关存活返回 bootId；不可达/非 ok/缺字段一律 null 且不抛', async () => {
    const seen = stubHealth({ status: 'ok', bootId: 'boot-1' });
    await expect(probeGatewayBootId('http://localhost:8080')).resolves.toBe('boot-1');
    expect(seen[0]).toContain('/api/health');

    stubHealth({ status: 'ok' });
    await expect(probeGatewayBootId('http://localhost:8080')).resolves.toBeNull();

    stubHealth({ status: 'ok', bootId: 'boot-1' }, 500);
    await expect(probeGatewayBootId('http://localhost:8080')).resolves.toBeNull();

    stubDead();
    await expect(probeGatewayBootId('http://localhost:8080')).resolves.toBeNull();
  });

  test('无响应失败 + 网关存活 → 中断错误；网关仍死 → 原样；业务错误透传', async () => {
    stubHealth({ status: 'ok', bootId: 'boot-2' });
    const interrupted = await mapTransportInterruption(
      'http://localhost:8080',
      new GatewayRequestError(GATEWAY_NO_RESPONSE_MESSAGE, { code: GATEWAY_UNREACHABLE_CODE })
    );
    expect(interrupted).toBeInstanceOf(GatewayRequestError);
    const err = interrupted as GatewayRequestError;
    expect(err.code).toBe(GATEWAY_INTERRUPTED_CODE);
    expect(err.message).toBe(GATEWAY_INTERRUPTED_MESSAGE);

    stubDead();
    const original = new GatewayRequestError(GATEWAY_NO_RESPONSE_MESSAGE, {
      code: GATEWAY_UNREACHABLE_CODE,
    });
    await expect(mapTransportInterruption('http://localhost:8080', original)).resolves.toBe(original);

    stubHealth({ status: 'ok', bootId: 'boot-3' });
    const business = new GatewayRequestError('范围非法', { code: 'E_INVALID_INPUT' });
    await expect(mapTransportInterruption('http://localhost:8080', business)).resolves.toBe(business);
  });
});
