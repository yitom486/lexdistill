import { describe, expect, it } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import {
  createAnkiClient,
  getAnkiVersion,
  ensureAnkiDeck,
  ensureAnkiModel,
  storeAnkiMedia,
  addAnkiNote,
  resolveAnkiEndpoint,
} from '../index.js';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

type AnkiHandler = (params: Record<string, unknown>) => unknown;

/** AnkiConnect 桩：按 action 分发。 */
function makeStub(log: string[], handlers: Record<string, AnkiHandler>): typeof fetch {
  const impl = async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      action: string;
      params: Record<string, unknown>;
    };
    log.push(`anki:${body.action}`);
    const handler = handlers[body.action];
    if (!handler) return jsonResponse({ result: null, error: `unknown action ${body.action}` });
    return jsonResponse({ result: handler(body.params), error: null });
  };
  return impl as typeof fetch;
};

/** M7-1 自 Gateway `__tests__/anki-push.test.ts` 迁入（行为不变）。 */
describe('anki-connect transport', () => {
  it('version 正常返回', async () => {
    const log: string[] = [];
    const client = createAnkiClient(undefined, makeStub(log, { version: () => 6 }));
    const res = await getAnkiVersion(client);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) expect(res.value).toBe(6);
  });

  it('连不上（抛错/非200）收敛为 E_ANKI_UNREACHABLE（可重试）', async () => {
    const throwing = (() => {
      throw new Error('refused');
    }) as unknown as typeof fetch;
    const r1 = await getAnkiVersion(createAnkiClient(undefined, throwing));
    expect(isOk(r1)).toBe(false);
    if (!isOk(r1)) {
      expect(r1.error.code).toBe('E_ANKI_UNREACHABLE');
      expect(r1.error.retryable).toBe(true);
    }
    const bad = (async () => new Response('x', { status: 502 })) as unknown as typeof fetch;
    const r2 = await getAnkiVersion(createAnkiClient(undefined, bad));
    expect(isOk(r2)).toBe(false);
  });

  it('Anki duplicate 映射为 E_ANKI_DUPLICATE；其他错误带动作名', async () => {
    const dupFetch = (async () =>
      jsonResponse({ result: null, error: 'cannot create note because it is a duplicate' })) as unknown as typeof fetch;
    const r1 = await addAnkiNote(createAnkiClient(undefined, dupFetch), {
      deckName: 'D',
      modelName: 'M',
      fields: {},
      tags: [],
    });
    expect(isOk(r1)).toBe(false);
    if (!isOk(r1)) expect(r1.error.code).toBe('E_ANKI_DUPLICATE');
    const other = (async () =>
      jsonResponse({ result: null, error: 'boom' })) as unknown as typeof fetch;
    const r2 = await addAnkiNote(createAnkiClient(undefined, other), {
      deckName: 'D',
      modelName: 'M',
      fields: {},
      tags: [],
    });
    expect(isOk(r2)).toBe(false);
    if (!isOk(r2)) expect(r2.error.userMessage).toContain('addNote');
  });

  it('endpoint 仅放行本机回环（SSRF 守卫）', () => {
    expect(() => resolveAnkiEndpoint('http://example.com:8765')).toThrow();
    expect(() => resolveAnkiEndpoint('ftp://127.0.0.1/x')).toThrow();
    expect(resolveAnkiEndpoint(undefined)).toBe('http://127.0.0.1:8765');
    expect(resolveAnkiEndpoint('http://localhost:8765/')).toBe('http://localhost:8765');
  });

  it('牌组/模型已存在则跳过创建；缺失则按我方模板创建', async () => {
    const log: string[] = [];
    let createdModel: unknown;
    const stub = makeStub(log, {
      deckNames: () => ['LexDistill'],
      modelNames: () => [],
      createModel: (p) => {
        createdModel = p;
        return null;
      },
    });
    const client = createAnkiClient(undefined, stub);
    const d = await ensureAnkiDeck(client, 'LexDistill');
    expect(isOk(d)).toBe(true);
    expect(log.includes('anki:createDeck')).toBe(false);
    const m = await ensureAnkiModel(client, {
      modelName: 'LexDistill Basic',
      fields: ['Expression', 'Meaning'],
      css: '.card {}',
      front: 'F',
      back: 'B',
    });
    expect(isOk(m)).toBe(true);
    expect(log.includes('anki:createModel')).toBe(true);
    const spec = createdModel as { inOrderFields: string[]; cardTemplates: Array<{ Front: string }> };
    expect(spec.inOrderFields).toEqual(['Expression', 'Meaning']);
    expect(spec.cardTemplates[0]?.Front).toBe('F');
  });

  it('媒体文件名白名单（路径穿越拒绝且不发请求）', async () => {
    const log: string[] = [];
    const client = createAnkiClient(undefined, makeStub(log, { storeMediaFile: () => 'x' }));
    const res = await storeAnkiMedia(client, '../evil.mp3', 'AAA=');
    expect(isOk(res)).toBe(false);
    expect(log.length).toBe(0);
  });
});
