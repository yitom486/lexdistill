import { eq } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import { ankiSettings } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import {
  ANKI_CONNECT_DEFAULT_ENDPOINT,
  resolveAnkiEndpoint,
} from '@study-studio/flashcards';

/**
 * AnkiConnect 推送开关持久化（默认关闭；读侧永不抛，损坏行回退默认）。
 * endpoint 常量与校验自 M7-1 起归 flashcards（协议层契约；C5 起实现内聚），
 * 此处只复用，不反向定义。
 */

export interface AnkiPushSettings {
  enabled: boolean;
  endpoint: string;
}

const SETTINGS_ID = 'default';

export async function getAnkiSettings(deps: RepoDeps): Promise<AnkiPushSettings> {
  try {
    const rows = await deps.db.select().from(ankiSettings).where(eq(ankiSettings.id, SETTINGS_ID));
    const row = rows[0];
    if (!row) return { enabled: false, endpoint: ANKI_CONNECT_DEFAULT_ENDPOINT };
    let endpoint = ANKI_CONNECT_DEFAULT_ENDPOINT;
    try {
      endpoint = resolveAnkiEndpoint(row.endpoint);
    } catch {
      endpoint = ANKI_CONNECT_DEFAULT_ENDPOINT;
    }
    return { enabled: row.enabled === 1, endpoint };
  } catch {
    return { enabled: false, endpoint: ANKI_CONNECT_DEFAULT_ENDPOINT };
  }
}

export async function saveAnkiSettings(
  deps: RepoDeps,
  patch: { enabled?: boolean; endpoint?: string }
): Promise<Result<AnkiPushSettings, BusinessError>> {
  try {
    const current = await getAnkiSettings(deps);
    const next: AnkiPushSettings = {
      enabled: patch.enabled ?? current.enabled,
      endpoint: current.endpoint,
    };
    if (patch.endpoint !== undefined) {
      try {
        next.endpoint = resolveAnkiEndpoint(patch.endpoint);
      } catch (e) {
        if (e instanceof BusinessError) return err(e);
        return err(translateToBusinessError(e, 'saveAnkiSettings'));
      }
    }
    const existing = await deps.db
      .select({ id: ankiSettings.id })
      .from(ankiSettings)
      .where(eq(ankiSettings.id, SETTINGS_ID));
    const values = {
      id: SETTINGS_ID,
      enabled: next.enabled ? 1 : 0,
      endpoint: next.endpoint,
      updatedAt: nowIso(),
    };
    if (existing.length > 0) {
      await deps.db.update(ankiSettings).set(values).where(eq(ankiSettings.id, SETTINGS_ID));
    } else {
      await deps.db.insert(ankiSettings).values(values);
    }
    return ok(next);
  } catch (e) {
    return err(translateToBusinessError(e, 'saveAnkiSettings'));
  }
}
