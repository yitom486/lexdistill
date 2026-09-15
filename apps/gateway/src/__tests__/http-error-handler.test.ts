import { describe, it, expect } from 'bun:test';
import { app } from '../index.js';
import { mapCategoryToHttpStatus, type StandardErrorPayload } from '../errors/http-error-handler.js';
import { BusinessError } from '@study-studio/shared';

describe('Gateway Unified HTTP Error Handler', () => {
  it('should map categories to standard HTTP status codes correctly', () => {
    expect(mapCategoryToHttpStatus('VALIDATION')).toBe(400);
    expect(mapCategoryToHttpStatus('SECURITY')).toBe(403);
    expect(mapCategoryToHttpStatus('LEARNER_STATE')).toBe(404);
    expect(mapCategoryToHttpStatus('ROUTING')).toBe(404);
    expect(mapCategoryToHttpStatus('TOOL_EXECUTION')).toBe(422);
    expect(mapCategoryToHttpStatus('AGENT_RUNTIME')).toBe(502);
    expect(mapCategoryToHttpStatus('NETWORK')).toBe(504);
    expect(mapCategoryToHttpStatus('DATABASE')).toBe(500);
    expect(mapCategoryToHttpStatus('INTERNAL')).toBe(500);
  });

  it('should return 404 with structured BusinessError on non-existent route', async () => {
    const res = await app.request('/api/some-non-existent-route');
    expect(res.status).toBe(404);
    const body = (await res.json()) as StandardErrorPayload;
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('E_NOT_FOUND');
    expect(body.error.category).toBe('ROUTING');
    expect(body.error.userMessage).toContain('不存在');
  });

  it('should handle unhandled route errors gracefully via formatBusinessErrorResponse on error', async () => {
    const { Hono } = await import('hono');
    const { formatBusinessErrorResponse } = await import('../errors/http-error-handler.js');
    const testApp = new Hono()
      .onError((err, c) => formatBusinessErrorResponse(c, err, 'TEST_CRASH'))
      .get('/api/test-crash', () => {
        throw new Error('Database connection failed: SQLITE_BUSY');
      });

    const res = await testApp.request('/api/test-crash');
    expect(res.status).toBe(500);
    const body = (await res.json()) as StandardErrorPayload;
    expect(body.success).toBe(false);
    expect(body.error.userMessage).toBeDefined();
    // 严禁暴露 raw SQLITE 堆栈给用户
    expect(body.error.userMessage).not.toContain('SQLITE_BUSY');
  });
});
