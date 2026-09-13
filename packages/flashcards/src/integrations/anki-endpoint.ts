import { BusinessError } from '@study-studio/shared';

/**
 * M7-1 自 Gateway `flashcards/persistence/anki-settings.ts` 迁入（字节一致，行为不变）。
 *
 * AnkiConnect endpoint 常量与校验：仅放行 http(s) 本机回环（防 SSRF），
 * 环境变量覆盖须同样收敛。开关持久化仍归 Gateway。
 */

export const ANKI_CONNECT_DEFAULT_ENDPOINT = 'http://127.0.0.1:8765';

/** endpoint 解析与收窄（仅 http(s) 本机回环；环境变量覆盖须同样收敛）。 */
export function resolveAnkiEndpoint(raw: string | undefined): string {
  const candidate = (raw ?? '').trim() || ANKI_CONNECT_DEFAULT_ENDPOINT;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new BusinessError(
      'E_INVALID_INPUT',
      'AnkiConnect 地址不正确，形如 http://127.0.0.1:8765',
      'VALIDATION',
      false
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BusinessError(
      'E_INVALID_INPUT',
      'AnkiConnect 只允许 http(s) 本机地址',
      'VALIDATION',
      false
    );
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new BusinessError(
      'E_INVALID_INPUT',
      'AnkiConnect 只允许连接本机 Anki（localhost/127.0.0.1），不访问远程地址',
      'SECURITY',
      false
    );
  }
  return url.toString().replace(/\/$/, '');
}
