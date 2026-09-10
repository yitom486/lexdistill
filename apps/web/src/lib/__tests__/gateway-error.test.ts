import { describe, expect, test } from 'bun:test';
import { readGatewayErrorCode, readGatewayErrorDetails, readGatewayUserMessage } from '../gateway-error.js';

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
