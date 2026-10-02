import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { SaveTextbookOutlineResultSchema } from '@study-studio/document-model';
import { createApp } from '../../../../gateway/src/transport/http/create-app.js';
import { DrizzleLearnerRepository } from '../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import {
  GatewayRequestError, GATEWAY_REQUEST_FAILED_CODE, GATEWAY_UNREACHABLE_CODE,
  mapGatewayTransportFailure,
} from '../gateway-error.js';

const origin = 'http://localhost:3000';
const userId = 'cors-test-owner';
const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Textbook-Trace': 'cors-test-trace' };

function startGateway() {
  const repo = new DrizzleLearnerRepository(':memory:');
  // 只访问健康、输入校验和目录保存，不启动 Agent；完整应用仍使用生产路由顺序和 CORS。
  const app = createApp({ repo, server: {} as never, port: 0 });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => app.fetch(request) });
  return { repo, server, baseUrl: `http://127.0.0.1:${server.port}` };
}

async function preflight(baseUrl: string, operation: string, requestedHeaders = 'content-type,x-textbook-trace,authorization') {
  const response = await fetch(`${baseUrl}/api/documents/${userId}/${operation}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': requestedHeaders,
    },
  });
  expect(response.status).toBe(204);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('Access-Control-Allow-Methods')?.split(',')).toContain('POST');
  const allowed = response.headers.get('Access-Control-Allow-Headers')?.toLowerCase().split(',') ?? [];
  // Bun fetch 不执行 WebView 的 CORS 限制，必须显式验证预检许可才发后续 POST。
  for (const header of requestedHeaders.split(',')) expect(allowed).toContain(header);
}

describe('桌面教材请求跨端口：完整 Gateway CORS → 路由 → SQLite', () => {
  it('三条目录请求允许监视头，校验失败仍有可读 HTTP 回执，保存真正落库并记录 trace', async () => {
    const env = startGateway();
    try {
      for (const operation of ['map-pdf', 'extract-toc-llm', 'textbook-outline']) {
        await preflight(env.baseUrl, operation);
        const response = await fetch(`${env.baseUrl}/api/documents/${userId}/${operation}`, {
          method: 'POST', headers, body: '{}',
        });
        expect(response.status).toBe(400);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(await response.json()).toMatchObject({ success: false, error: { code: 'E_INVALID_INPUT' } });
      }
      const response = await fetch(`${env.baseUrl}/api/documents/${userId}/textbook-outline`, {
        method: 'POST', headers,
        body: JSON.stringify({
          title: '跨端口目录保存测试', language: 'ja',
          filePath: fileURLToPath(new URL('../../../../gateway/src/modules/library/__tests__/fixtures/smoke-native-2lessons.pdf', import.meta.url)),
          tocEntries: [{ id: 'cors-lesson', title: '第一课', level: 'lesson', startPage: 1 }],
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      const saved = SaveTextbookOutlineResultSchema.parse(await response.json());
      const slots = await env.repo.listTextbookLessonSlots(saved.documentId);
      expect(slots.ok && slots.value.map(slot => slot.lessonId)).toEqual(['cors-lesson']);
      const events = await env.repo.listImportEvents({ userId, traceId: headers['X-Textbook-Trace'], after: 0, limit: 200 });
      expect(events.ok && events.value.map(event => event.name)).toEqual([
        'map-pdf_started', 'map-pdf_result', 'extract-toc-llm_started', 'extract-toc-llm_result',
        'textbook-outline_started', 'textbook-outline_result', 'textbook-outline_started', 'textbook-outline_result',
      ]);
    } finally {
      await env.server.stop(true);
      env.repo.getRawDb().close();
    }
  });

  it('TTS 专属预检继续允许服务凭证头，普通目录路由不放开任意请求头', async () => {
    const env = startGateway();
    try {
      const response = await fetch(`${env.baseUrl}/api/tts-studio/generate`, {
        method: 'OPTIONS', headers: {
          Origin: origin, 'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-api-key',
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('x-api-key');
      const directory = await fetch(`${env.baseUrl}/api/documents/${userId}/map-pdf`, {
        method: 'OPTIONS', headers: {
          Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-api-key',
        },
      });
      expect(directory.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).not.toContain('x-api-key');
    } finally {
      await env.server.stop(true);
      env.repo.getRawDb().close();
    }
  });

  it('实际网关健康与关闭结果进入客户端诊断，不把存活误报为解析崩溃或重启', async () => {
    const env = startGateway();
    try {
      const health: unknown = await (await fetch(`${env.baseUrl}/api/health`)).json();
      if (typeof health !== 'object' || health === null || !('bootId' in health) || typeof health.bootId !== 'string') {
        throw new Error('实际网关健康响应缺少 bootId');
      }
      // WebView 的 fetch 失败不暴露原因；只替代此错误，健康检查使用实际 HTTP。
      const failed = await mapGatewayTransportFailure(env.baseUrl, new TypeError('Failed to fetch'));
      expect(failed).toBeInstanceOf(GatewayRequestError);
      if (!(failed instanceof GatewayRequestError)) throw new Error('没有生成安全的客户端错误');
      expect(failed.code).toBe(GATEWAY_REQUEST_FAILED_CODE);
      expect(failed.message).toContain('教材请求未能完成');
      expect(failed.message).not.toMatch(/重启|整本解析|Failed to fetch/);
      expect(failed.details).toEqual({ health: { reachable: true, bootId: health.bootId } });

      await env.server.stop(true);
      let transportError: unknown;
      try { await fetch(`${env.baseUrl}/api/health`); } catch (error) { transportError = error; }
      expect(transportError).toBeDefined();
      // Bun 的连接异常形状与 WebView 不同；确认端口已关闭后使用 WebView 的失败形状。
      const unavailable = await mapGatewayTransportFailure(env.baseUrl, new TypeError('Failed to fetch'));
      expect(unavailable).toBeInstanceOf(GatewayRequestError);
      if (!(unavailable instanceof GatewayRequestError)) throw new Error('没有生成安全的连接错误');
      expect(unavailable.code).toBe(GATEWAY_UNREACHABLE_CODE);
      expect(unavailable.message).toContain('无法连接本机网关');
      expect(unavailable.details).toEqual({ health: { reachable: false } });
    } finally {
      await env.server.stop(true);
      env.repo.getRawDb().close();
    }
  });
});
