import {
  ok,
  err,
  type Result,
  BusinessError,
} from '@study-studio/shared';
import { resolveAnkiEndpoint } from './anki-endpoint.js';

/**
 * M7-1 自 Gateway `flashcards/application/anki-connect.ts` 迁入（行为不变；
 * endpoint 解析改从本包 `./anki-endpoint.js` 导入，不再反向依赖 Gateway 持久层）。
 *
 * AnkiConnect 协议客户端（桌面 Anki 本地插件接口，协议 v6）。
 * 纯传输层：fetch 可注入（单测桩），endpoint 仅放行本机回环（防 SSRF）。
 * 不实现 Anki 服务端；Anki 未打开/未装插件时返回可重试的友好错误。
 */

export const ANKI_CONNECT_VERSION = 6;
const ANKI_CONNECT_TIMEOUT_MS = 15000;

export type FetchImpl = typeof fetch;

export interface AnkiConnectClient {
  endpoint: string;
  fetchImpl: FetchImpl;
}

export function createAnkiClient(
  endpoint?: string,
  fetchImpl: FetchImpl = fetch
): AnkiConnectClient {
  const envEndpoint =
    typeof process !== 'undefined' ? process.env['ANKI_CONNECT_URL'] : undefined;
  return { endpoint: resolveAnkiEndpoint(endpoint ?? envEndpoint), fetchImpl };
}

interface AnkiConnectEnvelope {
  result?: unknown;
  error?: unknown;
}

function unreachableError(): BusinessError {
  return new BusinessError(
    'E_ANKI_UNREACHABLE',
    '连不上本机 Anki：请确认 Anki 已打开并安装了 AnkiConnect 插件（默认端口 8765），稍后重试',
    'NETWORK',
    true
  );
}

async function ankiInvoke(
  client: AnkiConnectClient,
  action: string,
  params: Record<string, unknown> = {}
): Promise<Result<unknown, BusinessError>> {
  try {
    const response = await client.fetchImpl(client.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: ANKI_CONNECT_VERSION, params }),
      signal: AbortSignal.timeout(ANKI_CONNECT_TIMEOUT_MS),
    });
    if (!response.ok) return err(unreachableError());
    const envelope = (await response.json().catch(() => null)) as AnkiConnectEnvelope | null;
    if (!envelope || typeof envelope !== 'object') return err(unreachableError());
    if (envelope.error !== null && envelope.error !== undefined) {
      const detail = typeof envelope.error === 'string' ? envelope.error : '未知错误';
      if (/duplicate/i.test(detail)) {
        return err(
          new BusinessError(
            'E_ANKI_DUPLICATE',
            'Anki 里已有相同笔记，已跳过重复推送',
            'LEARNER_STATE',
            false
          )
        );
      }
      return err(
        new BusinessError(
          'E_ANKI_ACTION_FAILED',
          `Anki 返回错误（${action}）：${detail.slice(0, 160)}`,
          'TOOL_EXECUTION',
          false
        )
      );
    }
    return ok(envelope.result);
  } catch {
    // fetch 抛错（拒连/超时/中断）一律收敛为“连不上本机 Anki”，不向外泄漏底层异常。
    return err(unreachableError());
  }
}

/** 连通性探测（version 动作；AnkiConnect 未就绪即 E_ANKI_UNREACHABLE）。 */
export async function getAnkiVersion(
  client: AnkiConnectClient
): Promise<Result<number, BusinessError>> {
  const res = await ankiInvoke(client, 'version');
  if (!res.ok) return res as Result<number, BusinessError>;
  return typeof res.value === 'number'
    ? ok(res.value)
    : err(unreachableError());
}

export async function ensureAnkiDeck(
  client: AnkiConnectClient,
  deckName: string
): Promise<Result<void, BusinessError>> {
  const names = await ankiInvoke(client, 'deckNames');
  if (!names.ok) return names as Result<void, BusinessError>;
  if (Array.isArray(names.value) && names.value.includes(deckName)) return ok(undefined);
  const created = await ankiInvoke(client, 'createDeck', { deck: deckName });
  if (!created.ok) return created as Result<void, BusinessError>;
  return ok(undefined);
}

export interface AnkiModelSpec {
  modelName: string;
  fields: string[];
  css: string;
  front: string;
  back: string;
}

/** 模型不存在则按我方模板创建（含正反面/CSS；字段顺序即 inOrderFields）。 */
export async function ensureAnkiModel(
  client: AnkiConnectClient,
  spec: AnkiModelSpec
): Promise<Result<void, BusinessError>> {
  const names = await ankiInvoke(client, 'modelNames');
  if (!names.ok) return names as Result<void, BusinessError>;
  if (Array.isArray(names.value) && names.value.includes(spec.modelName)) return ok(undefined);
  const created = await ankiInvoke(client, 'createModel', {
    modelName: spec.modelName,
    inOrderFields: spec.fields,
    css: spec.css,
    isCloze: false,
    cardTemplates: [{ Name: 'Card 1', Front: spec.front, Back: spec.back }],
  });
  if (!created.ok) return created as Result<void, BusinessError>;
  return ok(undefined);
}

/** 媒体入库（base64；文件名白名单收敛，防路径穿越）。 */
export async function storeAnkiMedia(
  client: AnkiConnectClient,
  filename: string,
  base64Data: string
): Promise<Result<string, BusinessError>> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(filename)) {
    return err(
      new BusinessError('E_INVALID_INPUT', '媒体文件名不合法，已跳过音频推送', 'VALIDATION', false)
    );
  }
  const res = await ankiInvoke(client, 'storeMediaFile', { filename, data: base64Data });
  if (!res.ok) return res as Result<string, BusinessError>;
  return typeof res.value === 'string' ? ok(res.value) : ok(filename);
}

export interface AnkiNoteInput {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
}

/** 添加笔记（allowDuplicate=false；重复走 E_ANKI_DUPLICATE 友好短路）。 */
export async function addAnkiNote(
  client: AnkiConnectClient,
  note: AnkiNoteInput
): Promise<Result<number, BusinessError>> {
  const res = await ankiInvoke(client, 'addNote', {
    note: {
      deckName: note.deckName,
      modelName: note.modelName,
      fields: note.fields,
      tags: note.tags,
      options: { allowDuplicate: false, duplicateScope: 'deck' },
    },
  });
  if (!res.ok) return res as Result<number, BusinessError>;
  return typeof res.value === 'number'
    ? ok(res.value)
    : err(
        new BusinessError(
          'E_ANKI_ACTION_FAILED',
          'Anki 未返回笔记 id，请在 Anki 中确认是否已写入',
          'TOOL_EXECUTION',
          false
        )
      );
}
