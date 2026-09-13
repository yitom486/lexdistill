import { describe, expect, it } from 'bun:test';
import { isOk, isErr, BusinessError } from '@study-studio/shared';
import {
  pushCardToAnki,
  type AnkiPushPorts,
  type AnkiPushRequest,
  type FetchImpl,
} from '../index.js';
import { getBuiltinCardFormat, type AnkiCardFormat } from '@study-studio/flashcard-core';

/**
 * M7-7 推送用例测试（port 桩 + AnkiConnect fetch 桩，不碰业务库/TTS 实现）。
 * 锁：未启用不发请求、SSRF 守卫、重复/不可达错误行为。
 */
function builtin(): AnkiCardFormat {
  const format = getBuiltinCardFormat('study-basic');
  if (!format) throw new Error('missing builtin study-basic');
  return format;
}

function ankiStub(log: string[]): FetchImpl {
  const impl = async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string };
    log.push(`anki:${body.action}`);
    const result = (v: unknown) =>
      new Response(JSON.stringify({ result: v, error: null }), { status: 200 });
    switch (body.action) {
      case 'version':
        return result(6);
      case 'deckNames':
        return result([]);
      case 'createDeck':
        return result(1);
      case 'modelNames':
        return result([]);
      case 'createModel':
        return result(null);
      case 'addNote':
        return result(42);
      default:
        return result(null);
    }
  };
  return impl as FetchImpl;
}

interface PortsKnobs {
  enabled?: boolean;
  endpoint?: string;
  card?: boolean;
  tts?: 'ok' | 'fail';
}

function stubPorts(log: string[], knobs: PortsKnobs = {}): AnkiPushPorts {
  return {
    getSettings: async () => ({
      enabled: knobs.enabled ?? true,
      endpoint: knobs.endpoint ?? 'http://127.0.0.1:8765',
    }),
    loadCard: async ({ cardId }) => {
      if (knobs.card === false || cardId === 'missing') return undefined;
      return {
        id: cardId,
        front: '食べる',
        back: 'to eat',
        phonetic: 'たべる',
        language: 'ja',
        sourceEntryId: null,
      };
    },
    loadFormat: async () => builtin(),
    resolveSource: async (card) => ({
      source: { headword: card.front, meanings: [card.back] },
    }),
    synthesizeTts: async () => {
      if (knobs.tts === 'fail') {
        return {
          ok: false as const,
          error: new BusinessError('E_TTS_FAILED', '合成失败', 'TOOL_EXECUTION', false),
        };
      }
      return { ok: true as const, value: { bytes: 4, contentType: 'audio/mpeg', audio: new Uint8Array([1, 2, 3, 4]) } };
    },
  };
}

const REQ: AnkiPushRequest = { userId: 'u1', cardId: 'c1' };

describe('pushCardToAnki', () => {
  it('未启用 → E_ANKI_DISABLED 且不发任何网络请求', async () => {
    const log: string[] = [];
    const res = await pushCardToAnki(stubPorts(log, { enabled: false }), ankiStub(log), REQ);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('E_ANKI_DISABLED');
    expect(log).toEqual([]);
  });

  it('卡片不存在 → E_NOT_FOUND', async () => {
    const log: string[] = [];
    const res = await pushCardToAnki(stubPorts(log, { card: false }), ankiStub(log), REQ);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('E_NOT_FOUND');
  });

  it('成功推送（无 TTS）：建牌组建模型 addNote，音频留空明示', async () => {
    const log: string[] = [];
    const res = await pushCardToAnki(stubPorts(log), ankiStub(log), REQ);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.noteId).toBe(42);
    expect(res.value.audioStored).toBe(false);
    expect(res.value.audioSkippedReason).toContain('TTS');
    expect(log).toContain('anki:createDeck');
    expect(log).toContain('anki:addNote');
  });

  it('TTS 失败降级：跳过音频但推送成功', async () => {
    const log: string[] = [];
    const res = await pushCardToAnki(
      stubPorts(log, { tts: 'fail' }),
      ankiStub(log),
      { ...REQ, tts: { provider: 'x' } }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.noteId).toBe(42);
    expect(res.value.audioStored).toBe(false);
    expect(res.value.audioSkippedReason).toContain('TTS 合成失败');
  });

  it('Anki 不可达 → E_ANKI_UNREACHABLE（可重试）', async () => {
    const log: string[] = [];
    const down = (() => {
      throw new Error('refused');
    }) as unknown as FetchImpl;
    const res = await pushCardToAnki(stubPorts(log), down, REQ);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_ANKI_UNREACHABLE');
      expect(res.error.retryable).toBe(true);
    }
  });

  it('非本机端点 → 拒绝（SSRF 守卫，不发请求）', async () => {
    const log: string[] = [];
    const res = await pushCardToAnki(
      stubPorts(log, { endpoint: 'http://example.com:8765' }),
      ankiStub(log),
      REQ
    );
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('E_INVALID_INPUT');
    expect(log).toEqual([]);
  });
});
